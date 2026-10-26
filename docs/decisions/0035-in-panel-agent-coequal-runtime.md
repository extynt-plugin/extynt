# ADR 0035: in-panel agent is a coequal first-class runtime

Status: accepted

## Context

The sidecar runs a full tool-calling agent loop
(`apps/sidecar/src/agent-runtime.ts`) for the panel's chat. External agents
(Claude Code, Codex) reach the same deterministic tools through the plugin's
MCP launcher. Both must share one capability boundary so neither can bypass
the approval and verification path.

## Decision

The in-panel agent and external agents are both first-class. Both:

- call the same deterministic tool implementations (`@extynt/mcp-server`);
- author the same typed action-plan schema, checked by the same validators and
  path policy;
- reach After Effects only through server-issued approval capabilities, the
  host compiler and the sidecar's apply and verify path; and
- are answered with the same receipts.

They differ where their situations differ:

- The in-panel agent's loop is the sidecar's: its briefing, step and token
  limits, queue, and stages and specialists. It cannot approve; the apply
  decision belongs to the sidecar (the "ask before applying" setting and the
  agent's review hold).
- An external agent runs its own loop under its client's limits and approves its
  own plans with `ae_approve_plan`; the MCP client's permission prompt is the
  human gate, backed by the host-verification acknowledgement.

The provider-neutral adapter (`packages/llm`) is called only from the sidecar.

## Plan surfaces per runtime

The two runtimes share the plan boundary but not one tool list. The split is
defined in `packages/mcp-server/src/tool-catalogue.ts`.

- In-panel agent (`agentToolDefinitions()`): the queue (`ae_queue_add`,
  `ae_queue_fix`, `ae_queue_finish`), inspection, discovery and undo, plus the
  sidecar-only `ae_select_workflow_stage`, `ae_consult_specialist` and
  `ae_workflow_complete`. The plan-id lifecycle tools (`ae_propose_plan`,
  `ae_plan_*`, `ae_amend_plan`, `ae_approve_plan`, `ae_get_receipt`,
  `ae_undo_plan`) are hidden from it. It never sees a plan id.
- External agents over MCP (`listTools("agent")`): the plan-id lifecycle
  (`ae_propose_plan` or `ae_plan_create`/`ae_plan_add`/`ae_plan_complete`,
  `ae_amend_plan`, `ae_approve_plan`, status, receipts, undo) with the same
  inspection and discovery tools. The queue and workflow completion are refused
  to them (`PANEL_AGENT_ONLY`): the queue is a single sidecar-wide slot that
  only a chat turn delivers to the panel, and completion needs the goal digest
  only the panel agent's brief carries.

## Consequences

- Both surfaces share the typed plan boundary: the same validators, path policy,
  approval capabilities, host compiler and receipts.
- External agents get no workflow stages and no specialists. Claude and Codex
  can delegate with their own subagents; only one writer should propose and
  approve.
- Failure or misconfiguration of the in-panel agent loop does not affect
  external agent connectivity; both are recoverable from diagnostics.
- If external agents ever need an agent loop or policy different from the
  in-panel one, that requires a new agent-configuration boundary; if the tool
  sets diverge further, the contracts should be separated explicitly.

## Status

- The shared-implementation requirement is met. The in-panel agent and external
  agents both call `callTool` from `@extynt/mcp-server` (the panel through
  `apps/sidecar/src/server-chat-agent-native.ts`, external clients through
  `apps/sidecar/src/server-mcp-execute.ts`).
- `apps/sidecar/src/server-mcp-*` is the HTTP bridge for external agents. It is
  not a second dispatcher: it routes requests to the same `callTool`.
- `apps/sidecar/tests/agent-runtime-parity.test.ts` guards the split. It asserts
  that both runtimes' tool names and input schemas come from
  `tool-catalogue.ts`, and that each tool sits on the side its runtime markers
  name.
