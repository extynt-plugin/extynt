# extynt plugin

One MCP server (`packages/mcp-server`, launched via the shell wrapper
`bin/extynt-mcp` in the installed bundle) and one workflow skill
(`skills/ae-workflow/SKILL.md`), shared by every supported agent host. See
[docs/architecture/README.md](../docs/architecture/README.md) for how it fits
the product.

- **Codex**: `.codex-plugin/plugin.json` + `.mcp.json`.
- **Claude Code / Claude Desktop**: same `.mcp.json`, no changes required —
  see [`docs/connect-an-agent.md`](../docs/connect-an-agent.md) for exact steps.

All hosts run the same MCP launcher (`bin/extynt-mcp`; `extynt-mcp.cmd` on
Windows), which uses the bundled Node.js runtime that the installer provides
on macOS and Windows, so agent hosts need no Node.js of their own. The
launcher proxies live project calls to the per-user sidecar and never holds
project state itself. Adding a third agent host means pointing its MCP
configuration at the same launcher; nothing here is host-specific.
