# ADR 0018: Claude is a supported agent host alongside Codex

Status: accepted

## Context

MCP is the deterministic capability boundary, and the same action-plan/MCP
contract can serve more than one agent host. Codex is packaged through
`plugin/.codex-plugin/plugin.json` plus `plugin/.mcp.json`. Users of Claude
(Claude Code and Claude Desktop) need to drive the same tools from there,
without a second protocol, a second server implementation, or a hosted OAuth
connector.

## Decision

No new server, protocol, or capability. `plugin/.mcp.json` is already in the
exact shape Claude Code reads natively for a project-scoped MCP server
(`{"mcpServers": {"after-effects": {"command": "node", "args": [...],
"env": {...}}}}`), and `plugin/skills/ae-workflow/SKILL.md` was already
host-agnostic (no Codex-specific language). Claude is supported by:

- Claude Code: reading `plugin/.mcp.json` directly (project-scoped), or
  registering the same command via `claude mcp add`.
- Claude Desktop: pasting the same `command`/`args`/`env` block into
  `claude_desktop_config.json`'s `mcpServers`.

Both point at `packages/mcp-server/dist/src/stdio.js`, the same stdio
launcher Codex uses, which resolves its sidecar
endpoint/token automatically from the co-located session file rather than
requiring an environment secret to be typed in by hand.

See [`docs/connect-an-agent.md`](../connect-an-agent.md) for the exact steps.

## Consequences

The Claude connector needs no change to `packages/mcp-server`,
`packages/action-plan`, or the skill content, because the action-plan/MCP
contract is host-independent by construction. A
third agent host would follow the same pattern: point its MCP configuration
at the same stdio launcher.

## Revisit triggers

Revisit if a future agent host requires a transport this stdio launcher does
not support (for example, a hosted OAuth-based remote connector rather than
a locally spawned process), or if Claude or Codex change how they discover
project-scoped MCP servers or skills in a way that breaks the current
`.mcp.json`/`SKILL.md` conventions.
