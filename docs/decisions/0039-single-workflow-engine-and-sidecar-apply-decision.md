# ADR 0039: workflow-v1 is the only in-panel engine, and the sidecar owns each batch's apply decision

Status: accepted.

## Context

Two engines would double every boundary: two fallback paths (one could replay
work a sealed batch had already queued), two busy checks, two settle-wait
shapes, and tests that encode behavior a packaged install cannot reach. The
engine is therefore single, and `workflow-v1` is it
([ADR 0027](0027-workflow-domain-package.md)).

The apply decision needs one owner as well. A request to review a plan before
it is applied has to reach whatever applies it, so the decision is made in one
place, by the sidecar, from the user's setting and the agent's explicit hold.

## Decision

1. `workflow-v1` is the only in-panel engine. The coordinator and its persistent
   store always exist, and `/v1/workflow/status` is always served. A chat turn
   that a tool-calling model can own runs as a workflow job; a model that cannot
   call tools answers on the read-only path. `AE_WORKFLOW_ENGINE` is retired: a
   leftover value is logged at startup and ignored, never a reason to refuse
   startup.
2. External MCP clients keep the explicit plan contract (`ae_propose_plan`,
   `ae_plan_*`, `ae_approve_plan`, `ae_undo_plan`). The in-panel turn's queue
   tools and `ae_workflow_complete` are not advertised to them: only that turn's
   seal reaches the panel's commit flow, and completion needs the workflow job
   only that turn opens. An external caller's queue is a separate slot from the
   in-panel turn's.
3. The sidecar owns the apply decision for every batch the in-panel agent
   seals. A sealed batch applies without a click only when the user's "ask
   before applying" setting allows it for that plan and the agent did not hold
   the batch. Under the default (`risky`), reversible, verifiable edits apply at
   once with Undo on the card, while deletes, writes outside the project
   (render, import, export, replace footage), plans whose undo is
   native-only, and plans from external agents wait for the user; `always`
   waits for every plan and `never` for none. The agent holds a batch with
   `ae_queue_finish` `review: true` when the user asks to approve first; the
   hold covers every later batch of that request, and the continuation is
   briefed as manual. Nothing the agent passes can widen the decision.
4. A batch nobody will apply without a click skips the post-seal apply wait, so
   its card is returned at once.

## Consequences

- One engine to test and reason about.
- A question turn runs through the workflow bootstrap, whose steps run at
  `medium` effort until a stage is selected (a slot set lower keeps its own
  choice). Bootstrap steps read the whole project context, which low effort
  handles poorly.
- The sidecar does not parse the message for review phrasing: matching "don't
  apply it to the background layer" as a review request holds a batch the user
  wanted applied. The agent's explicit `review` hold is the only path.

## Rejected alternatives

- A rollback switch to a second engine: it keeps a fallback path that can
  replay sealed work.
- Refusing startup on a leftover `AE_WORKFLOW_ENGINE`: a stale file must not
  stop the sidecar.
- Letting the panel decide from its own toggle, which a review request cannot
  reach.
- Recognising review phrasings in the sidecar: it is intent parsing,
  and an explicit parameter is available.
