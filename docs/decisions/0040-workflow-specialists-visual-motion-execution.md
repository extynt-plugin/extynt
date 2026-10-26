# ADR 0040: persistent on-demand workflow specialists (visual-scene, motion, execution)

Status: accepted. The sidecar no longer launches specialists by itself; ADR 0042 decision 5 supersedes that part.

## Context

Complex multi-domain workflows require decisions that cross scene design, timing,
and implementation. A single agent loop may miss dependencies, redesign upstream
work, or claim capabilities it cannot implement. The workflow owner (sidecar's
main agent loop) needs trusted advisors for specific domains without running them
unconditionally on every turn.

Persistent specialist sessions provide three read-only,
no-tool specialist threads: `visual-scene`, `motion`, and `execution`. Each
owns a bounded domain and returns a typed JSON handoff. They sleep after
returning a result, wake for corrections, and are cancelled with the workflow.

## Decision

The workflow owner runs a persistent orchestration with three optional specialist
roles:

- **visual-scene**: owns scene design (layers, assets, dimensions, colors,
  occlusion, z-order, masks/mattes). Returns a concrete editable manifest,
  visual acceptance frames, and named dependencies. Must not prescribe timing,
  submit operations, or claim a render exists.

- **motion**: owns temporal behavior (trajectories, timing beats, orientation,
  easing, velocity, continuity, parallax, trail progression). Returns motion
  acceptance sample times, continuity risks, and parametric descriptions. Must
  not redesign the scene, submit operations, or claim motion was rendered.

- **execution**: owns implementation planning (stage breakdown, operation
  families, layer identity, sidecar-safe boundaries, reversible risks, exact
  evidence required). Returns After Effects stage plan and pre-apply evidence
  checklist. Must not queue/apply work or claim execution occurred.

Each specialist session is owned by the workflow coordinator and accessed only
by the workflow owner (sidecar agent). A specialist thread:

- receives a bounded project snapshot and specialist-specific instruction;
- runs a tool-less agent loop (reads context, produces typed handoff);
- returns a `WorkflowSpecialistBrief` (objective, requirements, deliverables,
  constraints, verification);
- sleeps and awaits corrections via `ae_consult_specialist action=message`;
- is cancelled when the workflow completes or is abandoned; and
- retains completed streams in chat for inspection.

The workflow owner can launch specialists via `ae_consult_specialist action=launch`,
wait for results, read their handoffs, and send corrections. The owner may
dismiss specialist advice or incorporate it into its own proposal. Specialist
threads never submit plans, approve work, or claim completion.

## Rationale and evidence

Specialist threads separate concerns:

- **Scene specialists** keep layer/asset/visual decisions separate from timing
  and implementation, reducing redesign cycles in multi-specialist workflows.
- **Motion specialists** own timing continuity and easing expertise that a
  general agent may approximate or overlook.
- **Execution specialists** translate abstract requirements into concrete After
  Effects stage sequences and evidence requirements, decoupling user intent from
  technical feasibility.
- Read-only, no-tool design keeps specialists focused and reduces risk of
  specialist misadventure (no direct host calls, no plan submission).

Persistent sessions allow correction loops without restarts: the owner sends a
follow-up to a specialist without re-launching. Workflow-owned cancellation
ensures specialists don't outlive their job.

## Consequences

- **Specialist turns have a five-minute timeout**: a long specialist turn blocks
  the workflow owner. The timeout is cancelled when the specialist completes or
  the workflow is cancelled.
- **Specialist threads are not folded automatically**: if a specialist completes
  early and the workflow continues, the specialist handoff remains in the
  activity log. The owner loop does not compress old specialist completions.
- **The wake loop is capped**: when the owner answers in prose while a
  specialist is outstanding, the sidecar waits for it (each specialist turn is
  bounded by its own five-minute timeout) and wakes the owner, at most three
  times per turn (`SPECIALIST_WAKE_LIMIT`); after that the owner's answer stands.
- **Incomplete specialist threads block workflow completion**: if a specialist
  is pending when the workflow concludes, it is cancelled. The owner must
  consume specialist results (read handoffs) before finalizing.
- **Specialist threads stream in clickable chips**: completed specialist results
  appear in chat as read-only evidence, inspectable but not editable.

## Open risks and revisit triggers

1. **Specialist threads not being folded**: if a long workflow launches multiple
   specialists, their handoffs accumulate in chat and in-memory state, consuming
   tokens and memory. A future milestone should implement fold policies for
   old specialist results.

2. **Re-launch thrash**: the wake loop is capped per turn, but an owner that
   keeps re-launching the same specialist across turns is still bounded only by
   the step limit. Explicit per-role accounting may be needed.

3. **Five-minute specialist timeout is experimental**: if typical specialist
   work exceeds five minutes, the timeout will be hit and the workflow will be
   blocked. Production metrics must confirm the timeout is realistic.

4. **Specialist unavailability due to missing provider**: if
   `workflowSpecialistProviders` is not configured, specialists fall back to
   the owner's provider. If that provider cannot run agents, specialists are
   unavailable. The sidecar must surface this in diagnostics.

Revisit this decision if:

- Workflow turn counts exceed sustainable bounds due to specialist accumulation.
- Real workflows require specialist corrections exceeding the wake-loop
  architecture.
- Specialists need to propose or execute work (breaking the read-only boundary).
- External agents (Claude, Codex plugins) need access to specialist context;
  today specialists are in-panel only (see ADR 0035).
