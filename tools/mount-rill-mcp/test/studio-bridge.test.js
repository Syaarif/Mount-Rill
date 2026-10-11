import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import test from "node:test";
import { StudioBridge } from "../dist/studio-bridge.js";

const token = "mountRillTestToken_0123456789abcdef";

function postSnapshot(port, body, authorization = `Bearer ${token}`) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        path: "/bridge/snapshot",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authorization,
        },
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(responseBody) }));
      },
    );
    request.on("error", reject);
    request.end(JSON.stringify(body));
  });
}

function validSnapshot() {
  const workspace = {
    id: 1,
    parentId: null,
    name: "Workspace",
    className: "Workspace",
    path: "Workspace",
    properties: {},
  };
  const part = {
    id: 2,
    parentId: 1,
    name: "TrailPart",
    className: "Part",
    path: "Workspace.TrailPart",
    properties: {
      Anchored: true,
      Position: { x: 1, y: 2, z: 3 },
      Size: { xScale: 0, xOffset: 4, yScale: 0, yOffset: 2 },
    },
  };
  return {
    protocolVersion: 1,
    sentAt: Date.now(),
    studio: { name: "Mount Rill", gameId: "10", placeId: "20", isRunning: false },
    hierarchy: [workspace, part],
    selection: [part],
    logsAvailable: true,
    logs: [{ message: "Output sample", messageType: "MessageOutput", timestamp: Date.now() / 1000 }],
  };
}

test("Studio bridge binds to loopback, requires a token, and accepts bounded snapshots", async (t) => {
  const bridge = await StudioBridge.start(token, 0);
  t.after(() => bridge.close());
  const status = bridge.getStatus();
  assert.equal(status.connected, false);
  assert.equal(status.host, "127.0.0.1");

  const port = status.port;
  const unauthenticated = await postSnapshot(port, validSnapshot(), "Bearer invalid");
  assert.equal(unauthenticated.status, 401);
  assert.throws(() => bridge.getSnapshot(), /no fresh plugin snapshot/i);

  const accepted = await postSnapshot(port, validSnapshot());
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.accepted, true);
  assert.equal(bridge.getStatus().connected, true);
  assert.equal(bridge.getSnapshot().hierarchy.length, 2);
  assert.equal(bridge.getSnapshot().selection[0].name, "TrailPart");
});

test("Studio bridge rejects invalid hierarchy references and non-allowlisted properties", async (t) => {
  const bridge = await StudioBridge.start(token, 0);
  t.after(() => bridge.close());

  const badParent = validSnapshot();
  badParent.hierarchy[1].parentId = 999;
  const parentResponse = await postSnapshot(bridge.getStatus().port, badParent);
  assert.equal(parentResponse.status, 400);
  assert.match(parentResponse.body.error, /invalid parent/i);

  const badProperty = validSnapshot();
  badProperty.hierarchy[1].properties.Source = "print('not allowed')";
  const propertyResponse = await postSnapshot(bridge.getStatus().port, badProperty);
  assert.equal(propertyResponse.status, 400);
  assert.equal(bridge.getStatus().connected, false);
});

test("Studio bridge refuses short tokens", async () => {
  await assert.rejects(() => StudioBridge.start("short", 0), /32-128 URL-safe characters/);
});
