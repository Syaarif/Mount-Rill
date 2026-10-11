# Mount Rill MCP (Phase 1)

A local, read-only MCP server for the Mount Rill Rojo workspace. The server
uses the official TypeScript MCP SDK over `stdio`; it does not open a network
listener, start Roblox Studio, execute Luau, or modify project files.

## Requirements

- Node.js 20 or newer (tested with Node.js 24.17.0)
- npm
- Rojo on `PATH` for `get_rojo_status` and `validate_rojo_config`
- A VS Code MCP-capable chat client to connect from VS Code

The Rojo integration runs only `rojo --version` and
`rojo sourcemap default.project.json`, with a five-second timeout and no shell.
It never accepts a command from the model.

## Install and test

From the project root in PowerShell:

```powershell
Set-Location 'D:\Mount_Rill VsCode\tools\mount-rill-mcp'
npm.cmd ci --ignore-scripts
npm.cmd test
```

`npm test` compiles strict TypeScript, runs the path-security and Rojo unit
tests, and opens an actual MCP stdio connection to verify tool discovery and
invocation. Run the compiled server directly with:

```powershell
$env:MOUNT_RILL_WORKSPACE = 'D:\Mount_Rill VsCode'
npm.cmd start
```

The workspace root defaults to the process working directory when
`MOUNT_RILL_WORKSPACE` is not set. Set it explicitly in the MCP client
configuration so the allowed workspace is unambiguous.

## Phase 1 tools

| Tool | Access |
| --- | --- |
| `get_project_info` | Project name, Rojo source mappings, and visible file count |
| `get_project_tree` | Bounded workspace-relative file tree |
| `search_project_code` | Literal search through supported text/source extensions |
| `read_project_file` | Read one bounded UTF-8 text file |
| `get_rojo_status` | Fixed `rojo --version` check |
| `validate_rojo_config` | Validate source mappings and run fixed Rojo sourcemap |

All tool inputs use Zod validation. Paths must be relative to the workspace.
Traversal, absolute paths, hidden/config directories, known secret names,
binary files, files over 512 KiB, and resolved paths outside the workspace are
rejected. Tree and search operations skip symbolic links and enforce depth,
file-count, byte, and result limits. File content and search output are read
only; no arbitrary shell commands are accepted.

Hidden paths such as `.mcp.json` and `.vscode` are intentionally not readable
by these tools. Do not place secrets in source files that are otherwise
readable.

## VS Code connection

This project audit found VS Code 1.140.0 but no installed GitHub Copilot
extension or existing MCP client configuration. Therefore this installation
does **not** add `.mcp.json` or claim that VS Code can currently connect.
After installing/enabling a compatible VS Code MCP client, a workspace
`.mcp.json` can use the current VS Code `servers` format. To enable the Studio
bridge, prompt for the token rather than storing it in the project:

```json
{
  "inputs": [
    {
      "id": "mount-rill-bridge-token",
      "type": "promptString",
      "description": "Local Mount Rill Studio bridge token",
      "password": true
    }
  ],
  "servers": {
    "mount-rill": {
      "command": "node",
      "args": ["${workspaceFolder}/tools/mount-rill-mcp/dist/index.js"],
      "env": {
        "MOUNT_RILL_WORKSPACE": "${workspaceFolder}",
        "MOUNT_RILL_STUDIO_BRIDGE_TOKEN": "${input:mount-rill-bridge-token}"
      }
    }
  }
}
```

Build the server with `npm.cmd run build` in `tools/mount-rill-mcp` before
connecting. Add the configuration only after confirming the MCP client is
installed and reload the VS Code window to test the connection. Keep
`MOUNT_RILL_WORKSPACE` pointed at the intended project root. The token is not
checked into source control; keep any client configuration containing it out
of source control as well.

## Phase 2: read-only Studio Bridge

The local plugin source is
`studio-plugin/MountRillStudioBridge.plugin.lua`. To use it:

1. Generate a fresh token in PowerShell and keep it only in your local
   environment/client prompt:

   ```powershell
   $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
   $bytes = New-Object byte[] 32
   $rng.GetBytes($bytes)
   $token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
   $token
   $rng.Dispose()
   Remove-Variable bytes, rng
   ```

2. Install the compatible VS Code MCP client, build the server, and configure
   the workspace MCP server using the secure input prompt above. Enter the
   generated token when VS Code prompts for it.
3. In Roblox Studio, open **Plugins > Plugins Folder**, copy the local plugin
   file there, then reload the plugin list or restart Studio.
4. Open **Mount Rill > Mount Rill Studio Bridge**, paste the same token, and
   click **Connect (read only)**. The token textbox is cleared immediately;
   the token is not persisted by the plugin.
5. Confirm `get_studio_status` reports a fresh connection before relying on
   `get_game_hierarchy`, `inspect_instance`, `search_studio_instances`,
   `get_selection`, or `get_studio_logs`.

The MCP process starts the bridge only when
`MOUNT_RILL_STUDIO_BRIDGE_TOKEN` is configured. It listens on
`127.0.0.1:38741` only, accepts authenticated JSON snapshots, caps payloads
and hierarchy depth/count, validates instance-property names against an
allowlist, and rejects stale snapshots after 15 seconds. The plugin sends
instance names/classes/full paths, selected allowlisted properties, the
current selection, and up to 100 recent log messages. It does not send
`Script.Source`, modify Studio objects, run Luau, or contact a Roblox asset
service.

**Studio verification is still required.** This environment had a Roblox
Studio process open, but no plugin was installed or activated during these
tests. The bridge receiver/authentication was tested locally with synthetic
snapshots; that does not prove Roblox Studio permits the plugin's
`HttpService:RequestAsync` call to loopback or that `GetLogHistory()` is
available in the installed Studio build. Studio/plugin permissions may need
user action. Do not treat the connection as live until the status tool
confirms it and actual hierarchy data is returned.

## Not implemented

Phase 1 and the read-only Phase 2 bridge do not write source files or Studio
instances. Source editing, world-building, asset lookup/insertion, game
execution, and deletion remain out of scope until the Studio connection has
been manually proven. Any future writes need reviewable diffs, validation,
backups, and explicit approval for destructive operations. No private asset
access or asset permission is claimed.
