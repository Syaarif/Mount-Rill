import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/server";
import { ProjectTools } from "../dist/project.js";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(testDirectory, "..");
const workspaceDirectory = path.resolve(packageDirectory, "..", "..");

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "mount-rill-mcp-test-"));
  await mkdir(path.join(root, "ReplicatedStorage", "Shared"), { recursive: true });
  await writeFile(
    path.join(root, "default.project.json"),
    JSON.stringify({
      name: "Fixture",
      tree: {
        $className: "DataModel",
        ReplicatedStorage: { Shared: { $path: "ReplicatedStorage/Shared" } },
      },
    }),
  );
  await writeFile(path.join(root, "ReplicatedStorage", "Shared", "Config.luau"), 'return { value = "Mount Rill" }\n');
  return root;
}

test("read, search, and tree APIs operate on project-relative text safely", async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = new ProjectTools(root);

  const file = project.readProjectFile("ReplicatedStorage\\Shared\\Config.luau");
  assert.equal(file.path, "ReplicatedStorage/Shared/Config.luau");
  assert.match(file.content, /Mount Rill/);

  const search = project.searchProjectCode("[");
  assert.equal(search.matches.length, 0);
  assert.equal(project.searchProjectCode("mount rill").matches.length, 1);

  const tree = project.getProjectTree();
  assert.ok(tree.entries.some((entry) => entry.path === "default.project.json"));
  assert.ok(tree.entries.some((entry) => entry.path === "ReplicatedStorage/Shared/Config.luau"));
});

test("rejects traversal, absolute paths, hidden files, and known secret files", async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, ".env"), "secret");
  await mkdir(path.join(root, ".config"));
  await writeFile(path.join(root, ".config", "credentials.json"), '{"token":"secret"}');
  const project = new ProjectTools(root);

  for (const unsafePath of ["../outside.txt", "C:\\outside.txt", "\\\\server\\share\\x", ".env", ".config/credentials.json"]) {
    assert.throws(() => project.readProjectFile(unsafePath), /workspace-relative|Access denied|path segments/i);
  }
  assert.ok(project.getProjectTree().entries.every((entry) => !entry.path.startsWith(".")));
});

test("blocks a junction or symbolic link that resolves outside the workspace", async (t) => {
  const root = await createFixture();
  const outside = await mkdtemp(path.join(os.tmpdir(), "mount-rill-mcp-outside-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });
  await writeFile(path.join(outside, "outside.luau"), "private");
  try {
    await symlink(outside, path.join(root, "linked-outside"), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) {
      t.skip(`This environment does not permit creating a test junction: ${error.code}`);
      return;
    }
    throw error;
  }

  const project = new ProjectTools(root);
  assert.throws(() => project.readProjectFile("linked-outside/outside.luau"), /outside the allowed workspace/i);
  assert.ok(project.getProjectTree().entries.every((entry) => !entry.path.startsWith("linked-outside")));
});

test("validates Rojo mappings with only fixed arguments", async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const project = new ProjectTools(root, async (args, cwd, timeoutMs) => {
    calls.push({ args, cwd, timeoutMs });
    if (args[0] === "--version") {
      return { stdout: "Rojo 7.7.0\n", stderr: "" };
    }
    return {
      stdout: JSON.stringify({
        name: "Fixture",
        filePaths: ["default.project.json"],
        children: [{ filePaths: ["ReplicatedStorage/Shared/Config.luau"] }],
      }),
      stderr: "",
    };
  });

  assert.deepEqual(await project.getRojoStatus(), {
    available: true,
    version: "Rojo 7.7.0",
    configFile: "default.project.json",
  });
  const validation = await project.validateRojoConfig();
  assert.equal(validation.valid, true);
  assert.equal(validation.mappedSources, 2);
  assert.deepEqual(calls.map((call) => call.args), [["--version"], ["sourcemap", "default.project.json"]]);
  assert.ok(calls.every((call) => call.cwd === root && call.timeoutMs > 0));
});

test("rejects a Rojo mapping that escapes the workspace without invoking Rojo", async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, "default.project.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.tree.Escaped = { $path: "../outside" };
  await writeFile(configPath, JSON.stringify(config));
  let commandCalls = 0;
  const project = new ProjectTools(root, async () => {
    commandCalls += 1;
    return { stdout: "", stderr: "" };
  });

  const validation = await project.validateRojoConfig();
  assert.equal(validation.valid, false);
  assert.match(validation.issues.join(" "), /path segments|does not exist/i);
  assert.equal(commandCalls, 0);
});

test("serves read-only tools through an MCP stdio connection", async (t) => {
  const projectRoot = workspaceDirectory;
  const serverPath = path.join(packageDirectory, "dist", "index.js");
  const child = spawn(process.execPath, [serverPath], {
    cwd: projectRoot,
    env: { ...process.env, MOUNT_RILL_WORKSPACE: projectRoot },
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => child.kill());

  let buffered = "";
  const pending = new Map();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffered += chunk;
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.id !== undefined) {
        const resolve = pending.get(message.id);
        if (resolve) {
          pending.delete(message.id);
          resolve(message);
        }
      }
    }
  });
  child.stderr.setEncoding("utf8");
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const request = (id, method, params) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP request ${method} timed out. stderr=${stderr}`));
      }, 5000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  const notify = (method, params = {}) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  };

  const initialized = await request(1, "initialize", {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "mount-rill-test-client", version: "1.0.0" },
  });
  assert.ok(initialized.result?.serverInfo);
  notify("notifications/initialized");

  const listed = await request(2, "tools/list", {});
  const toolNames = listed.result.tools.map((tool) => tool.name);
  assert.deepEqual(toolNames.sort(), [
    "get_game_hierarchy",
    "get_project_info",
    "get_project_tree",
    "get_rojo_status",
    "get_selection",
    "get_studio_logs",
    "get_studio_status",
    "inspect_instance",
    "read_project_file",
    "search_project_code",
    "search_studio_instances",
    "validate_rojo_config",
  ]);

  const info = await request(3, "tools/call", { name: "get_project_info", arguments: {} });
  const projectInfo = JSON.parse(info.result.content[0].text);
  assert.equal(projectInfo.name, "Mount Rill");
  assert.equal(info.result.isError, undefined);

  const tree = await request(4, "tools/call", { name: "get_project_tree", arguments: {} });
  assert.ok(JSON.parse(tree.result.content[0].text).entries.some((entry) => entry.path === "default.project.json"));

  const search = await request(5, "tools/call", {
    name: "search_project_code",
    arguments: { query: "SprintRequested" },
  });
  assert.ok(JSON.parse(search.result.content[0].text).matches.length > 0);

  const config = await request(6, "tools/call", {
    name: "read_project_file",
    arguments: { path: "default.project.json" },
  });
  assert.match(JSON.parse(config.result.content[0].text).content, /Mount Rill/);

  const rojoStatus = await request(7, "tools/call", { name: "get_rojo_status", arguments: {} });
  const rojoStatusResult = JSON.parse(rojoStatus.result.content[0].text);
  assert.equal(rojoStatusResult.available, true);
  assert.match(rojoStatusResult.version, /Rojo 7\.7\.0/);

  const rojoValidation = await request(8, "tools/call", {
    name: "validate_rojo_config",
    arguments: {},
  });
  const rojoValidationResult = JSON.parse(rojoValidation.result.content[0].text);
  assert.equal(rojoValidationResult.valid, true);
  assert.ok(rojoValidationResult.mappedSources >= 18);

  const traversal = await request(9, "tools/call", {
    name: "read_project_file",
    arguments: { path: "../outside.txt" },
  });
  assert.equal(traversal.result.isError, true);
  assert.match(traversal.result.content[0].text, /workspace-relative|path segments/i);

  const studioStatus = await request(10, "tools/call", { name: "get_studio_status", arguments: {} });
  assert.match(studioStatus.result.content[0].text, /"connected": false/);

  const noHierarchy = await request(11, "tools/call", {
    name: "get_game_hierarchy",
    arguments: {},
  });
  assert.equal(noHierarchy.result.isError, true);
  assert.match(noHierarchy.result.content[0].text, /Studio Bridge is not enabled/);
});
