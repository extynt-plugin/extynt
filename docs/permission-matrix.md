# Permission matrix

What each part of the native install touches and which privilege it needs. The release
gate at the end is the contract the installers are tested against.

| Part | Location | Privilege | Notes |
| --- | --- | --- | --- |
| After Effects plugin (`extyntcore.plugin` / `.aex`) | After Effects plug-ins folder (`extynt` subfolder) | Writes to the AE install, installed by the plugin build or signed package | Not part of the per-user steps; the plugin only reads the host library and talks to the loopback sidecar |
| Host library (`host/`: `probe.jsx`, its parts, `manifest.json`) | macOS `/Library/Application Support/extynt/host`; Windows `%PROGRAMDATA%\extynt\host` | One elevated step (macOS `sudo`, Windows UAC), written root- or administrator-owned | A release plugin runs only the jsx it finds there, so a user-level process cannot change what executes inside After Effects. A development build can use a per-user folder instead (`--dev-library`, `-DevLibrary`), with no elevation |
| Sidecar (Node.js, loopback only) | macOS `~/Library/Application Support/extynt`; Windows runs from the checkout | Per-user, no administrator access | Started by a per-user launchd agent (macOS) or Scheduled Task (Windows); binds `127.0.0.1` on a port it picks |
| Served UI | `ui/` under the state folder (`ui-manifest.json` lists exactly the files) | Per-user | Loaded by the plugin's WebView from `http://127.0.0.1:<port>/ui/` |
| Pairing file `session.json` | State folder | Per-user, file mode 0600 | Holds the port and a bearer token; the MCP launcher and the plugin read it, so no endpoint or token is typed |
| Model key and settings | `llm.env` in the state folder | Per-user | The user's own provider key; the model runs outside extynt |
| Receipts, caches, logs, WebView profile | State folder (macOS `~/Library/Application Support/extynt`, Windows `%LOCALAPPDATA%\extynt`) | Per-user | Nothing is written to the After Effects bundle or system directories except the two items above |
| MCP launcher (`extynt-mcp`, `extynt-mcp.cmd`) | `bin/` under the state folder | Per-user | Runs the MCP server for an agent host; reads `session.json` |
| Project changes | Through the sidecar to the plugin | User approves a typed plan | No arbitrary script is run on the normal path; every plan is validated against a fresh read, runs in one undo group, and returns a receipt |
| `aerender` | Not used | - | - |
| Enterprise deployment | Not offered | - | Organization-wide policy support is not claimed |

## Release gate

A standard user account on macOS and on Windows must install extynt, start and
reconnect the sidecar, inspect a fixture, apply a plan and undo it. The only
elevation is the single host-library step. Nothing is written outside the state folder,
the host-library folder and the plugin folder.
