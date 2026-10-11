import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { errorMessage, ProjectTools } from "./project.js";
import { startStudioBridgeFromEnvironment, type StudioBridge } from "./studio-bridge.js";

const workspaceRoot = process.env.MOUNT_RILL_WORKSPACE ?? process.cwd();
const project = new ProjectTools(workspaceRoot);
const server = new McpServer({ name: "mount-rill", version: "0.1.0" });
let studioBridge: StudioBridge | undefined;
const readOnlyAnnotations = { readOnlyHint: true, destructiveHint: false };

async function executeRead(operation: () => unknown | Promise<unknown>) {
  try {
    const result = await operation();
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return {
      content: [{ type: "text" as const, text: `Error: ${errorMessage(error)}` }],
      isError: true,
    };
  }
}

server.registerTool(
  "get_project_info",
  {
    description: "Return the Mount Rill project name, workspace-relative Rojo source mappings, and visible file count.",
    inputSchema: z.object({}).strict(),
    annotations: readOnlyAnnotations,
  },
  async () => executeRead(() => project.getProjectInfo()),
);

server.registerTool(
  "get_project_tree",
  {
    description: "List workspace-relative project files and directories. Hidden, generated, and sensitive paths are omitted.",
    inputSchema: z.object({ path: z.string().optional() }).strict(),
    annotations: readOnlyAnnotations,
  },
  async ({ path }) => executeRead(() => project.getProjectTree(path)),
);

server.registerTool(
  "search_project_code",
  {
    description: "Search literal text in supported text/source files without executing code or regular expressions.",
    inputSchema: z
      .object({
        query: z.string().min(1).max(200),
        caseSensitive: z.boolean().optional(),
      })
      .strict(),
    annotations: readOnlyAnnotations,
  },
  async ({ query, caseSensitive }) =>
    executeRead(() => project.searchProjectCode(query, caseSensitive ?? false)),
);

server.registerTool(
  "read_project_file",
  {
    description: "Read a bounded UTF-8 text file inside the configured workspace, excluding sensitive paths.",
    inputSchema: z.object({ path: z.string().min(1).max(1024) }).strict(),
    annotations: readOnlyAnnotations,
  },
  async ({ path }) => executeRead(() => project.readProjectFile(path)),
);

server.registerTool(
  "get_rojo_status",
  {
    description: "Run only the fixed `rojo --version` command and return its version.",
    inputSchema: z.object({}).strict(),
    annotations: readOnlyAnnotations,
  },
  async () => executeRead(() => project.getRojoStatus()),
);

server.registerTool(
  "validate_rojo_config",
  {
    description: "Validate default.project.json mappings and run only `rojo sourcemap default.project.json`.",
    inputSchema: z.object({}).strict(),
    annotations: readOnlyAnnotations,
  },
  async () => executeRead(() => project.validateRojoConfig()),
);

function requireStudioBridge(): StudioBridge {
  if (!studioBridge) {
    throw new Error(
      "Studio Bridge is not enabled. Configure MOUNT_RILL_STUDIO_BRIDGE_TOKEN and restart the MCP server.",
    );
  }
  return studioBridge;
}

type HierarchyNode = {
  id: number;
  name: string;
  className: string;
  path: string;
  properties: Record<string, unknown>;
  children: HierarchyNode[];
};

function buildHierarchyTree(instances: ReturnType<StudioBridge["getSnapshot"]>["hierarchy"]) {
  const nodes = instances.map((instance) => ({
    id: instance.id,
    name: instance.name,
    className: instance.className,
    path: instance.path,
    properties: instance.properties,
    children: [],
  })) as HierarchyNode[];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const roots: typeof nodes = [];
  for (const instance of instances) {
    const node = byId.get(instance.id);
    if (!node) continue;
    if (instance.parentId === null) {
      roots.push(node);
    } else {
      byId.get(instance.parentId)?.children.push(node);
    }
  }
  return roots;
}

server.registerTool(
  "get_studio_status",
  {
    description: "Report whether an authenticated local Studio plugin has sent a fresh read-only snapshot.",
    inputSchema: z.object({}).strict(),
    annotations: readOnlyAnnotations,
  },
  async () =>
    executeRead(() =>
      studioBridge
        ? studioBridge.getStatus()
        : {
            enabled: false,
            connected: false,
            reason: "MOUNT_RILL_STUDIO_BRIDGE_TOKEN is not configured.",
          },
    ),
);

server.registerTool(
  "get_game_hierarchy",
  {
    description: "Return the bounded, allowlisted hierarchy snapshot from the connected Roblox Studio plugin.",
    inputSchema: z.object({}).strict(),
    annotations: readOnlyAnnotations,
  },
  async () => executeRead(() => buildHierarchyTree(requireStudioBridge().getSnapshot().hierarchy)),
);

server.registerTool(
  "inspect_instance",
  {
    description: "Inspect allowlisted properties for instances matching an exact Studio full path.",
    inputSchema: z.object({ path: z.string().min(1).max(1024) }).strict(),
    annotations: readOnlyAnnotations,
  },
  async ({ path }) =>
    executeRead(() => {
      const matches = requireStudioBridge()
        .getSnapshot()
        .hierarchy.filter((instance) => instance.path === path);
      if (matches.length === 0) {
        throw new Error(`No Studio instance matches the exact path: ${path}`);
      }
      return matches.slice(0, 20);
    }),
);

server.registerTool(
  "search_studio_instances",
  {
    description: "Search the connected Studio snapshot by literal instance name, class, or full path.",
    inputSchema: z
      .object({
        query: z.string().min(1).max(200),
        caseSensitive: z.boolean().optional(),
      })
      .strict(),
    annotations: readOnlyAnnotations,
  },
  async ({ query, caseSensitive }) =>
    executeRead(() => {
      const snapshot = requireStudioBridge().getSnapshot();
      const needle = caseSensitive ? query : query.toLocaleLowerCase();
      return snapshot.hierarchy
        .filter((instance) => {
          const haystack = `${instance.name}\n${instance.className}\n${instance.path}`;
          return (caseSensitive ? haystack : haystack.toLocaleLowerCase()).includes(needle);
        })
        .slice(0, 100);
    }),
);

server.registerTool(
  "get_selection",
  {
    description: "Return the current Studio selection with allowlisted instance properties.",
    inputSchema: z.object({}).strict(),
    annotations: readOnlyAnnotations,
  },
  async () => executeRead(() => requireStudioBridge().getSnapshot().selection),
);

server.registerTool(
  "get_studio_logs",
  {
    description: "Return recent Output log entries from the connected Studio snapshot, if the plugin API permits them.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(100).optional() }).strict(),
    annotations: readOnlyAnnotations,
  },
  async ({ limit }) =>
    executeRead(() => {
      const snapshot = requireStudioBridge().getSnapshot();
      if (!snapshot.logsAvailable) {
        throw new Error(`Studio log access is unavailable: ${snapshot.logsError ?? "no reason provided"}`);
      }
      return {
        available: true,
        entries: snapshot.logs.slice(-(limit ?? 50)),
      };
    }),
);

const transport = new StdioServerTransport();
async function main(): Promise<void> {
  studioBridge = await startStudioBridgeFromEnvironment();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error(`Mount Rill MCP failed to start: ${errorMessage(error)}`);
  process.exitCode = 1;
});
