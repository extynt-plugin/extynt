# ADR 0027: workflow domain package

Status: accepted

## Context

The sidecar owns jobs, stages, batches, commit boundaries, continuation,
cancellation and recovery. Those facts need one reviewable home that does not
depend on the typed operation package, the sidecar, the model providers or the
panel, so that lifecycle truth can be tested without After Effects or a model.

## Decision

`@extynt/workflow` (`packages/workflow`) holds the serializable workflow domain
contracts and a pure reducer and replay surface. It may depend on operation
types from `@extynt/action-plan`; it must not depend on the sidecar, HTTP,
providers, the filesystem or panel code.

The package owns the vocabulary for job, stage, batch, lifecycle state,
evidence dimensions, workflow events, transition errors and projections. The
sidecar owns a coordinator that supplies host and provider events and
dispatches typed commands.

`workflow-v1` is the only engine: sidecar-owned job state with one-batch bounded
model cycles. Continuation is receipt-driven and sidecar-owned. A sealed batch
ends the current model cycle; the scheduler retains the job after the
initiating HTTP request and schedules at most one serialized next cycle after
a verified settlement (including an explicitly permitted late reconciliation).
Unknown, failed, refused or applied-unverified host evidence never triggers an
automatic retry. Provider, no-batch and limit blockers are terminal for that
job and release the authoring slot when no host lease remains; an uncertain
host batch stays visibly blocked and can only be reopened by its verified
reconciliation transition. Completion is a typed proposal bound to the goal
digest and evaluated by the coordinator and reducer from verified receipt
evidence; model prose cannot complete a job.

Cancellation is claim-aware: queued work is removed before the host runs it,
but an apply past `apply-begin` or an executing undo retains its reducer-owned
lease until a receipt or an unknown settlement arrives. A cancelled job never
resumes model work, and a guarded late receipt may update only the retained
evidence. Deferred continuation and typed completion both require the current
snapshot fingerprint to equal the verified receipt's observed fingerprint; a
mismatch blocks without a provider call or job completion.

Durable storage and the restart boundary are described in
[ADR 0033](0033-workflow-recovery-status-and-restart-boundary.md).

## Consequences

- Reducer tests establish lifecycle truth without a provider or After Effects.
- Sidecar orchestration is tested against a fake plugin while
  `@extynt/action-plan` and the MCP contract stay independent of workflow state.
- External MCP clients keep the explicit plan tools; the workflow engine runs
  in-panel chat turns ([ADR 0039](0039-single-workflow-engine-and-sidecar-apply-decision.md)).

## Rejected alternatives

- Extending `StoredPlan` into the job ledger: it mixes plan authoring,
  execution, undo and job grouping and is owned by the MCP package.
- Putting workflow contracts in `@extynt/action-plan`: action plans describe
  typed mutations; jobs, stages and batches describe orchestration and must stay
  independent of individual operation schemas.
