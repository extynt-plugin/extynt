# Connect an agent to extynt

Any MCP client can reach After Effects through the one MCP server in
`packages/mcp-server`. A small launcher starts it with the Node.js runtime the
installer put in your profile, so the agent needs no Node.js of its own. The server
proxies every project call to the per-user sidecar, which holds the project state.

Prerequisites: extynt is installed (`packaging/macos/install.sh` or
`packaging/windows/install.ps1`), After Effects has been restarted, and you have opened
the extynt panel once (Window > extynt).

No endpoint or token is typed anywhere. The sidecar writes `session.json` (port and a
bearer token, mode 0600) in its per-user state folder, and the launcher reads it.

| | macOS | Windows |
| --- | --- | --- |
| State folder | `~/Library/Application Support/extynt` | `%LOCALAPPDATA%\extynt` |
| Launcher | `~/Library/Application Support/extynt/bin/extynt-mcp` | `%ProgramData%\extynt\bin\extynt-mcp.cmd` |

## Connect any agent

1. Open After Effects > Window > extynt > Settings > Agents.
2. Press **Copy prompt** and paste it into your agent. The prompt asks the agent to
   register the server and restart so it starts.
3. Or, if you prefer to edit the configuration yourself, press **Show MCP config** and
   add the matching `mcpServers` entry to your agent's MCP configuration.

macOS:

```json
{
  "mcpServers": {
    "extynt": {
      "command": "sh",
      "args": ["/Users/YOU/Library/Application Support/extynt/bin/extynt-mcp"]
    }
  }
}
```

Replace `YOU` with your macOS user name. JSON cannot expand `~`.

Windows:

```json
{
  "mcpServers": {
    "extynt": {
      "command": "cmd",
      "args": ["/c", "%ProgramData%\\extynt\\bin\\extynt-mcp.cmd"]
    }
  }
}
```

Works as written: `cmd` expands `%ProgramData%` when the agent starts it. The launcher lives there because that path has no spaces; `cmd /c` cannot start a path with spaces from an MCP client.

Restart or reload the agent after adding the entry so the server starts. Tools then
appear with the agent's own naming for MCP tools (for Claude Code, `mcp__extynt__*`).

## Set up a decision model

The optional decision model (Jev, an OpenAI-compatible endpoint or Cloudflare Workers AI) answers short closed questions faster. Ask the agent to "set up a decision model": it calls `ae_decision_model` with `action: "setup"` and gets back a one-time link on this computer (127.0.0.1, valid for ten minutes, ten tries, used up by one successful save). Open the link and paste the key into the page, which tests it before saving anything and lets you retry on a failure; if the panel is open, its Decision model section opens too. The tool has no key argument. If you paste a key into the chat anyway, the agent is told not to pass it on and to point you at the link instead.

`ae_decision_model` also takes `action: "status"` (which models are set up, never their keys), `"test"` (a live question to the model) and `"clear"` (remove one provider, or all). The panel's Settings > Model > Decision model section does the same by hand. To skip both, put `TYPESAFE_API_KEY=...` in `llm.env` (`~/Library/Application Support/extynt/` on macOS, `%LOCALAPPDATA%\extynt\` on Windows, `~/.config/extynt/` on Linux). A real environment variable or `.env` with the same name overrides `llm.env`, and the answer to a save says when that happens.

## Restart after an update

An agent host keeps running the extynt MCP server it started until the host is
restarted. After updating extynt, restart the host; `ae_status` reports a version
mismatch.

## Verify the connection

Ask the agent to call `ae_status`. It reports the extynt and MCP server versions, the
panel pipeline state, the After Effects version and build, model configuration and
snapshot freshness. If the snapshot is stale or unavailable, open the
extynt panel in After Effects: the panel connects to the sidecar and refreshes the
project when it opens.

## What the agent can do

- Every `ae_*` read tool (project structure, effects, expressions, capabilities) works
  once a snapshot exists.
- `ae_propose_plan` lets the agent compose a custom multi-operation typed plan. The
  plan appears in the panel for review. `ae_approve_plan` queues it, and an open
  panel applies it through the same typed command, undo, fresh-read and receipt flow
  as the in-panel agent. `ae_undo_plan` reverts it.
- `plugin/skills/ae-workflow/SKILL.md` describes the inspect-first, typed-plan,
  approve, verify workflow the agent should follow; it applies to every agent host.

## Examples

These are client-specific notes. The steps above work for every client.

### Claude Code

The repository ships the plugin in `plugin/`: `bin/extynt-mcp` (a shell launcher),
`bin/extynt-mcp.ts` (locates the server), `skills/ae-workflow/SKILL.md`,
`.claude-plugin/plugin.json` and `.mcp.json`. Install the `plugin/` folder as a Claude
Code plugin, or register the launcher directly:

macOS:

```sh
claude mcp add extynt -s user -- ~/Library/Application\ Support/extynt/bin/extynt-mcp
```

Windows:

```sh
claude mcp add extynt -s user -- cmd /c %ProgramData%\extynt\bin\extynt-mcp.cmd
```

The plugin's shell launcher is for macOS and Linux checkouts; on Windows register the
installed `.cmd` launcher.

### Claude Desktop

Add the `mcpServers` entry above to `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`), then
restart Claude Desktop. If the server does not start on Windows, replace
`%ProgramData%` with the full path (`C:\ProgramData`), because that file may not expand
variables.

### Codex

Install `plugin/` as a Codex plugin (`.codex-plugin/plugin.json` points at `.mcp.json`),
or add the `mcpServers` entry above to the Codex MCP configuration.
