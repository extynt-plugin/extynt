# ADR 0017: `ae_propose_plan` exposes the plan schema to any connected agent host

Status: accepted

## Context

The `ActionPlan` schema (`packages/action-plan`) carries every operation the
host can execute: layers and text, multi-keyframe animation, properties, effects,
timing, parenting, attributes, compositions and more, and `packages/host-ae`
compiles each into host commands. A connected agent host (Claude Code, Codex)
must be able to compose any sequence of those typed operations from its own
reasoning, while this repository keeps sole authority over validation, preview,
approval, execution and verification. A fixed set of canned shapes cannot carry
a multi-step creative request such as several distinct animation variants.

## Decision

`packages/mcp-server` exposes `ae_propose_plan({ summary, operations })`.

- `operations` is a bounded array of the operation union exported by
  `@extynt/action-plan`. The caller names `compositionId`, `layerId` and, where
  relevant, `effectPath` or `propertyPath` for each target.
- The tool always overwrites `snapshotFingerprint` and `selectionFingerprint`
  with the current snapshot's values, so a caller cannot forge or replay a
  stale target.
- The assembled plan goes through the same unmodified `validateActionPlan` as
  every other plan path: schema shape, bounds, target existence, per-operation
  rules and digest. The tool adds no operation types and no bypass. An
  operation the host cannot execute is rejected at proposal time with a
  specific code, never after the user has approved the plan.
- The result is stored and presented like any plan: `planId`, `status`, `plan`,
  `presentation` and an approval capability, so the panel's plan card, approve
  and cancel flow work unchanged.
- Placeholder ids (`__new__:<id>`) name things the plan creates. A later
  operation may reference an earlier planned layer as a parent, or an earlier
  planned composition as the container of a new layer. A newly created layer
  is not the primary target of another operation in the same plan: create it,
  refresh the snapshot, then act on the observed layer in a second call, so
  every target resolves against an observed snapshot.
- `create_composition` is project-level, so it has its own shape
  (`newCompositionId`, name, size, duration, frame rate) and its own validation
  path instead of a layer target. It keeps the same fingerprint freshness
  binding and bounded dimensions, duration and frame rate.
- `ae_list_plans` returns every stored plan, newest first, whichever tool
  created it, so the panel discovers a plan an external agent proposed without
  being told its id.

The agent reads context through the read tools, composes each variant as its
own `ae_propose_plan` call, and the user reviews and approves each one through
the same typed-plan, approval, undo and receipt loop as every other change.

## Consequences

- No mutation authority changes. `ae_propose_plan` exposes the schema's existing
  power; every invariant (fresh fingerprints, bounded operations and keyframes,
  allowlisted operation types, mandatory approval) is enforced by the same
  validator.
- A new operation type is added in three places together: `packages/action-plan`
  (validation), `packages/host-ae` (compilation) and the host library
  (`apps/panel/host/*.jsx`, execution). It is not advertised until all three
  exist, so a plan never validates and then fails at apply.
- Operations that edit through direct layer attributes (parent, blend mode,
  3D, shy, solo) have their own operation types rather than going through
  `set_layer_property`, because the host does not expose them as traversable
  properties. A locked layer cannot be targeted, so there is no unlock
  operation.
- Per-character text reveals use `ensure_text_animator` to build one animator
  with a range selector and one animator property, idempotently; the sweep
  itself is then an ordinary `animate_property` on the observed selector.
- The in-panel agent submits plans through the queue tools instead
  ([ADR 0035](0035-in-panel-agent-coequal-runtime.md)); both paths end in the
  same validator.
