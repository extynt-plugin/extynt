# MCP server

The tool surface extynt offers to an agent: the in-panel model and external MCP clients (Claude Code, Codex and others) see
the same catalogue. It reads the project, searches and describes host capabilities, composes plans, and applies and undoes
them through the sidecar. The package itself never runs scripts or touches After Effects: it validates and shapes each
call, and the sidecar and the plugin do the work.

- **Read and inspect:** project overview, composition and layer inspection, dependency tracing, issue lists, fonts, frame
  capture and measurement, effect and expression listings, and the host capability and native operation catalogues.
- **Plan and change:** `ae_propose_plan` (with `apply: true` it proposes and applies in one call), `ae_amend_plan`,
  `ae_approve_plan`, `ae_cancel_plan`, `ae_get_plan_status`, `ae_get_receipt` and `ae_undo_plan`. A plan is a typed list of
  operations; a refused proposal applies nothing, and a receipt reads the result back from After Effects.
- **Solve:** helpers for arc paths, staggers and keyframe assistants that return numbers a plan can use.

`listTools` (in `src/tool-catalogue.ts`) is the authoritative list and `callTool` (in `src/tool-run.ts`) runs one call. Both
are stateless functions rather than a server object: the sidecar holds the latest snapshot and passes it in explicitly. The
standard-input launcher (`src/stdio.ts`) answers `initialize`, `ping` and `tools/list` itself and forwards every
`tools/call` to the paired sidecar over loopback. No MCP SDK dependency is needed. See `docs/connect-an-agent.md` for
configuring a client.
