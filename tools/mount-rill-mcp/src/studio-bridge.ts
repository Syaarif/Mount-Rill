import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_STUDIO_AGE_MS = 15_000;
const BRIDGE_PORT = 38_741;
const BRIDGE_HOST = "127.0.0.1";
const ALLOWED_PROPERTIES = new Set([
  "Anchored",
  "BackgroundTransparency",
  "CanCollide",
  "Color",
  "Enabled",
  "Health",
  "LayoutOrder",
  "Material",
  "MaxHealth",
  "Name",
  "Playing",
  "Position",
  "PrimaryPart",
  "Size",
  "SoundId",
  "Transparency",
  "Value",
  "Visible",
  "Volume",
  "WalkSpeed",
]);

const propertyMapSchema = z.record(z.string().max(64), z.unknown()).refine((properties) =>
  Object.keys(properties).every((key) => ALLOWED_PROPERTIES.has(key)),
);

const instanceSchema = z
  .object({
    id: z.number().int().nonnegative().max(100_000),
    parentId: z.number().int().nonnegative().max(100_000).nullable(),
    name: z.string().min(1).max(120),
    className: z.string().min(1).max(100),
    path: z.string().min(1).max(1024),
    properties: propertyMapSchema,
  })
  .strict();

const snapshotSchema = z
  .object({
    protocolVersion: z.literal(1),
    sentAt: z.number().int().nonnegative(),
    studio: z
      .object({
        name: z.string().min(1).max(128),
        gameId: z.string().max(32),
        placeId: z.string().max(32),
        isRunning: z.boolean(),
      })
      .strict(),
    hierarchy: z.array(instanceSchema).max(1500),
    selection: z.array(instanceSchema).max(100),
    logsAvailable: z.boolean(),
    logsError: z.string().max(300).optional(),
    logs: z
      .array(
        z
          .object({
            message: z.string().max(2000),
            messageType: z.string().max(64),
            timestamp: z.number().finite(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

export type StudioInstance = z.infer<typeof instanceSchema>;
export type StudioSnapshot = z.infer<typeof snapshotSchema>;

function response(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(body));
}

function validAuthorization(value: string | undefined, expected: Buffer): boolean {
  if (!value?.startsWith("Bearer ")) {
    return false;
  }
  const supplied = Buffer.from(value.slice("Bearer ".length));
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function readBoundedBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    request.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error("Request body exceeds the 2 MiB bridge limit."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.once("end", () => resolve(Buffer.concat(chunks)));
    request.once("error", reject);
    request.setTimeout(5000, () => {
      reject(new Error("Studio bridge request timed out."));
      request.destroy();
    });
  });
}

function validateHierarchy(snapshot: StudioSnapshot): void {
  const hierarchyIds = new Set<number>();
  const depths = new Map<number, number>();
  for (const instance of snapshot.hierarchy) {
    if (hierarchyIds.has(instance.id)) {
      throw new Error("Studio snapshot contains duplicate instance IDs.");
    }
    if (instance.parentId !== null && !hierarchyIds.has(instance.parentId)) {
      throw new Error("Studio snapshot contains an invalid parent reference.");
    }
    hierarchyIds.add(instance.id);
    const depth = instance.parentId === null ? 0 : (depths.get(instance.parentId) ?? 0) + 1;
    if (depth > 16) {
      throw new Error("Studio hierarchy exceeds the 16-level bridge limit.");
    }
    depths.set(instance.id, depth);
    for (const value of Object.values(instance.properties)) {
      if (
        value !== null &&
        typeof value !== "string" &&
        typeof value !== "boolean" &&
        !(typeof value === "number" && Number.isFinite(value)) &&
        !isSimplePropertyValue(value)
      ) {
        throw new Error("Studio snapshot contains an unsupported property value.");
      }
    }
  }
  for (const instance of snapshot.selection) {
    if (!hierarchyIds.has(instance.id)) {
      throw new Error("Studio selection references an instance outside the snapshot.");
    }
    for (const value of Object.values(instance.properties)) {
      if (
        value !== null &&
        typeof value !== "string" &&
        typeof value !== "boolean" &&
        !(typeof value === "number" && Number.isFinite(value)) &&
        !isSimplePropertyValue(value)
      ) {
        throw new Error("Studio selection contains an unsupported property value.");
      }
    }
  }
}

function isSimplePropertyValue(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return (
    keys.length > 0 &&
    keys.length <= 6 &&
    keys.every((key) =>
      ["x", "y", "z", "r", "g", "b", "xScale", "xOffset", "yScale", "yOffset"].includes(key),
    ) &&
    Object.values(record).every(
      (item) =>
        typeof item === "number" ||
        typeof item === "boolean" ||
        (typeof item === "string" && item.length <= 64),
    )
  );
}

export class StudioBridge {
  private readonly server: Server;
  private readonly token: Buffer;
  private readonly port: number;
  private snapshot: StudioSnapshot | undefined;
  private lastSeenAt: number | undefined;

  private constructor(token: string, port: number) {
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
      throw new Error("Studio bridge token must be 32-128 URL-safe characters.");
    }
    this.token = Buffer.from(token);
    this.port = port;
    this.server = createServer((request, res) => {
      void this.handleRequest(request, res);
    });
    this.server.requestTimeout = 5000;
    this.server.headersTimeout = 5000;
    this.server.maxHeadersCount = 20;
  }

  static async start(token: string, port = BRIDGE_PORT): Promise<StudioBridge> {
    const bridge = new StudioBridge(token, port);
    await new Promise<void>((resolve, reject) => {
      bridge.server.once("error", reject);
      bridge.server.listen(port, BRIDGE_HOST, () => {
        bridge.server.removeListener("error", reject);
        resolve();
      });
    });
    return bridge;
  }

  getStatus(): {
    enabled: true;
    connected: boolean;
    host: typeof BRIDGE_HOST;
    port: number;
    lastSeenAt?: string;
    ageMs?: number;
    studio?: StudioSnapshot["studio"];
    hierarchyInstances?: number;
    selectedInstances?: number;
    logEntries?: number;
    logsAvailable?: boolean;
    logsError?: string;
  } {
    const address = this.server.address();
    const boundPort = address && typeof address === "object" ? address.port : this.port;
    if (!this.snapshot || this.lastSeenAt === undefined) {
      return { enabled: true, connected: false, host: BRIDGE_HOST, port: boundPort };
    }
    const ageMs = Date.now() - this.lastSeenAt;
    return {
      enabled: true,
      connected: ageMs <= MAX_STUDIO_AGE_MS,
      host: BRIDGE_HOST,
      port: boundPort,
      lastSeenAt: new Date(this.lastSeenAt).toISOString(),
      ageMs,
      studio: this.snapshot.studio,
      hierarchyInstances: this.snapshot.hierarchy.length,
      selectedInstances: this.snapshot.selection.length,
      logEntries: this.snapshot.logs.length,
      logsAvailable: this.snapshot.logsAvailable,
      ...(this.snapshot.logsError ? { logsError: this.snapshot.logsError } : {}),
    };
  }

  getSnapshot(): StudioSnapshot {
    const status = this.getStatus();
    if (!status.connected || !this.snapshot) {
      throw new Error(
        "Studio Bridge has no fresh plugin snapshot. Install/enable the local plugin, enter the bridge token, and connect it in Studio.",
      );
    }
    return this.snapshot;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private async handleRequest(request: IncomingMessage, res: ServerResponse): Promise<void> {
    const address = request.socket.remoteAddress;
    const serverAddress = this.server.address();
    const boundPort = serverAddress && typeof serverAddress === "object" ? serverAddress.port : this.port;
    if (
      address !== BRIDGE_HOST ||
      request.headers.host !== `${BRIDGE_HOST}:${boundPort}` ||
      request.method !== "POST" ||
      request.url !== "/bridge/snapshot"
    ) {
      response(res, 404, { error: "Not found." });
      return;
    }
    if (!validAuthorization(request.headers.authorization, this.token)) {
      response(res, 401, { error: "Unauthorized." });
      return;
    }
    if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
      response(res, 415, { error: "Content-Type must be application/json." });
      return;
    }

    try {
      const body = await readBoundedBody(request);
      const parsed: unknown = JSON.parse(body.toString("utf8"));
      const snapshot = snapshotSchema.parse(parsed);
      validateHierarchy(snapshot);
      this.snapshot = snapshot;
      this.lastSeenAt = Date.now();
      response(res, 200, { accepted: true });
    } catch (error) {
      if (!res.headersSent && !res.destroyed) {
        response(res, 400, { error: error instanceof Error ? error.message : "Invalid Studio snapshot." });
      }
    }
  }
}

export async function startStudioBridgeFromEnvironment(): Promise<StudioBridge | undefined> {
  const token = process.env.MOUNT_RILL_STUDIO_BRIDGE_TOKEN;
  if (!token) {
    return undefined;
  }
  return StudioBridge.start(token);
}
