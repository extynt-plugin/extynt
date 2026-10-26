# One path for tools

The in-panel agent and an external MCP client call the same tools through the same function. This page
says where each piece lives so that nobody writes a second copy.

## The path

```text
 panel agent turn                         external agent
 server-chat-agent-native.ts              plugin/bin/extynt-mcp (stdio) -> /v1/mcp/tools/call
        │                                          │
        │   scopedCaller + wrappers                │   scopedCaller + wrappers
        ▼                                          ▼
 server-mcp-execute.ts  (admission, approval fold, delivery, decoration)
        │
        ▼
 callTool(name, args, ToolContext)   packages/mcp-server/src/tool-run.ts
        │
        ▼
 tool-dispatch.ts   HOST_HANDLERS (read through the plugin)   SNAPSHOT_HANDLERS (read the snapshot)
```

The panel agent runs `callTool` in-process. There is no stdio hop and no loopback HTTP call, because the sidecar already
holds the project snapshot and the plan state that `callTool` needs; a transport would only serialise what is already in
memory. The external route needs the transport only because its process is separate. Both arrive at `callTool`.

## What lives where

| Concern | Home |
| --- | --- |
| Tool names, schemas, descriptions, which runtime sees which | `packages/mcp-server/src/tool-catalogue.ts` (`TOOL_DEFINITIONS`, `IN_PANEL_AGENT_HIDDEN_TOOLS`, `PANEL_AGENT_ONLY_TOOLS`, `EXTERNAL_HIDDEN_TOOLS`) |
| Running a tool and shaping its result | `callTool`, `toMcpToolResult` |
| Reads of the project, effects, fonts, frames, dependencies | mcp-server handlers |
| Plan proposal, amendment, approval, undo, status | mcp-server handlers, with the sidecar answering through `sidecar-client.ts` |
| Reading a receipt: the verification failure line, the work outcome | mcp-server (`verification-failure.ts`, `plan-work.ts`); the sidecar's plan view calls `workOutcomeView` |
| `ae_status` | `statusResult` in mcp-server; the sidecar passes the facts only it holds (pipeline, model, host library, version skew) in `ToolContext.statusFacts` and answers it directly for external callers |
| Which snapshot a tool runs against | sidecar `scoped-aware-tool.ts` (`scopedCaller`) |
| Admission, mailbox, approval frames, SSE plan events, activity feed, frame capture, build kit, cancel, scoped undo | sidecar `server-mcp-*.ts`, as wrappers around `callTool` |
| Queue tools (`ae_queue_*`, `ae_workflow_complete`) | declared in mcp-server, answered by the sidecar because they act on its queue |

The `server-mcp-*.ts` files are wrappers, not copies: each does something only the process holding state can do, then
calls `callTool` or decorates its result.

## Rule for new code

If a behaviour is about what a tool means, it goes in `packages/mcp-server` and both runtimes get it. If it is about
who may call the tool now, what the user sees, or what the queue does, it goes in the sidecar wrapper. Reading a
receipt is the first kind; showing it in the panel is the second.
