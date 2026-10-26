# ADR 0028: workflow batch, undo, and evidence boundaries

Status: accepted

## Context

A batch is dependency-complete, bounded, and one undo/recovery unit.
`PLAN_UNDO_BATCH_SIZE` is the single-group ceiling for plan authoring. Treating
a longer plan as one batch would claim a stronger recovery boundary than the
host provides.

Receipts also distinguish execution from verification. Outcomes include
executed, applied-unverified, partial mutation, and lost host hops, and the
plan status surface must not compress those facts for callers.

## Decision

One `Batch` maps to exactly one host undo unit and one receipt. Admission
enforces the single-undo bound and refuses a larger proposal (`MULTI_UNDO_BATCH`).

Any future partitioning of a larger proposal may split only at deterministic,
dependency-safe boundaries. It must not separate a creator from its dependent
operations, change operation meaning, or hide a failed prefix, and it needs its
own reducer, fake-host and host-validation evidence before enablement.

Lifecycle state and evidence/admission dimensions remain separate. In
particular:

- `verified` requires the receipt's required postcondition evidence;
- `applied_unverified` means execution is known but required verification is
  unavailable or incomplete;
- `uncertain`/`mayHaveMutated` means the system cannot establish what ran or
  whether mutation occurred;
- `failed` is reserved for a known non-mutating refusal in this state model.

`applied_unverified` is not equivalent to `uncertain`, but it is not an
automatic continuation grant. Dependent bindings may cross that boundary only
when the operation's required creator evidence is present and the verifier
contract permits it. Otherwise the coordinator enters reconciliation or blocks
the dependent batch.

A successfully admitted/sealed batch is authoritative even if provider
narration fails afterward. The coordinator stops the model cycle immediately
after the seal, so later provider failure cannot cause post-seal model drift or
retract a valid batch. The batch's receipt remains the authority for host
outcome.

Completion uses one bounded typed proposal, `ae_workflow_complete`, rather than
free-form model prose. The proposal must echo the reducer's goal digest, name
all declared criteria exactly once, and reference verified receipts from the
same job; the sidecar/reducer alone emits criterion satisfaction and
`job.completed`.

Fresh model cycles receive only a bounded sidecar continuation projection:
job/goal and stage identity, current snapshot identity, recent receipt and
per-operation evidence, verified-only created-id bindings, unresolved criteria,
blockers, and limits. A created-id binding is executable only when it points to
the admitted creator operation, its supported exact readback field, and the
receipt's observed post-apply snapshot fingerprint; arbitrary `created` map
entries are rejected or omitted. Raw prompts, reasoning, tool arguments, and secrets do
not enter workflow state. A cycle limit or post-seal provider failure blocks the
job without retrying the already sealed host batch. A fresh cycle that returns
without a typed batch is not success evidence; until a sidecar-owned criterion
is satisfied, the coordinator records `WORKFLOW_NO_BATCH` and blocks rather
than treating model silence as stage completion. A lost host receipt settles as
unknown/may-have-mutated and is never retried automatically; only a distinct
late receipt accepted through the reducer's explicit reconciliation transition
may improve that evidence. Known pre-dispatch refusals and conflicting receipt
identities remain terminal.

The sidecar owns an in-memory continuation scheduler for the process lifetime.
Its per-job record survives the initiating HTTP wait, and a verified settlement
or permitted reconciliation wakes one serialized next cycle at most once.
Receipt/poll duplicates are idempotent. If an unrelated workflow lease is live
when reconciliation arrives, the evidence is retained while the job remains
blocked; only a reducer-owned reopen after that lease ends may resume it. This
does not provide restart recovery of the in-memory scheduler; durable evidence and the restart
boundary are described in ADR 0033.

Cancellation follows the host boundary:
an idle queued undo is closed as blocked, while apply work past `apply-begin`
and undo work past claim retain their reducer lease until a receipt or synthetic
unknown settlement arrives. A cancelled job remains cancelled when that evidence
is reconciled; only the evidence state and lease are updated, never future model
work. `activeDispatchLease` is exposed in the workflow projection to make this
ownership observable.

The scheduler and `ae_workflow_complete` share one snapshot-pairing rule. A
verified receipt is usable only while the current normalized snapshot has the
same fingerprint as the receipt's observed post-apply snapshot. Deferred wake
and completion each recheck this at their authoritative boundary, so a mutation
between receipt publication and provider/completion evaluation blocks closed
without invoking the provider or emitting `job.completed`.

Completion evidence is paired once, at its newest receipt. A job that ran
several batches (one rename per layer, say) cites one batch receipt per step,
and only the receipt of the most recent batch can still equal the current
snapshot, because every later batch moved it. So `ae_workflow_complete`
requires that the newest cited receipt (by the job's batch order, then its
receipt order) carries the current snapshot fingerprint, which keeps an outside
edit after the last step a refusal (`COMPLETION_SNAPSHOT_UNPAIRED`). Every other
cited receipt only has to belong to a batch of this job that settled as verified
and was not undone or left undo-unverified; a foreign, unverified,
applied-unverified, uncertain or undone batch is refused as
`COMPLETION_UNSATISFIED`. A criterion may then repeat in the evidence rows, but
only to cite further distinct batch receipts (once each); an observation row
stands alone and keeps its own current-snapshot pairing. The reducer is
unchanged and still holds one reference per satisfied criterion: the sidecar
records the criterion against the newest receipt cited for it, after validating
every cited row.

A refused `ae_workflow_complete` blocks the job with `workflow:<code>` for its
`COMPLETION_*` code (or `workflow:workflow_completion_refused`). Applied host
work is intact and the next attempt only needs a corrected proposal, so a bare
user continuation (`continue`, `keep going`, and the other exact phrases that
resume a cycle-limit stop) reopens that same job for another completion attempt
instead of opening a new job from the word "continue". It follows the cycle-limit
path: only the latest job, only with no run or host work in flight, and the
window budget counts from the current cycle. The reducer's total provider-cycle
bound still applies. Every other blocker (no batch, provider unavailable,
missing completion after a continuation cycle, batch blockers) is not resumed
this way, and the panel's step-limit Continue button is not drawn for a refused
completion.

## Consequences

- Fake-host tests can assert a one-to-one batch/undo/receipt contract.
- A proposal over the single-undo bound is visibly refused until safe
  partitioning exists.
- The UI and model-facing projections show `applied_unverified` and
  `uncertain` differently.
- Real AE validation remains necessary for the actual undo-group and read-back
  behavior; fake AE cannot promote host evidence.

## Undo semantics per operation

Undo is After Effects' Edit > Undo, run once per apply group and guarded by the
project stamp (`UNDO_PROJECT_CHANGED`, `UNDO_NOT_LATEST`). It restores project
state only. The registry records each entry as `undo-group`, `host-dependent`
(the host may not put the change on the script undo stack; unverified on a live
host) or `not-undoable`. A plan type that several entries perform takes the
worst answer.

| Operation | Undo | Inverse operation shipped | Limits |
| --- | --- | --- | --- |
| `create_folder`, `create_composition`, `import_file` | yes (`import_file` host-dependent) | `delete_project_item` | Deleting an item never deletes the file on disk. |
| `delete_project_item`, `remove_layer`, `remove_mask`, `remove_marker` | yes | none | Undo is the only way back; nothing recreates the removed object. Files on disk are untouched. |
| `create_layer`, `duplicate_layer` | yes | `remove_layer` | |
| `add_mask`, `add_marker` | yes | `remove_mask`, `remove_marker` | |
| `precompose_layers` | yes, one step | none | Taking it apart by hand means removing the precomp layer and its composition item. |
| `set_footage_proxy` | yes, host-dependent | `clear_footage_proxy` | Re-setting a cleared proxy needs the old path, which is not read back. |
| `replace_footage` | yes, host-dependent | itself | The previous path is not in the receipt; keep it. |
| `set_composition_guides` | yes, host-dependent | itself with replace and an empty list | A replace clears every guide, including guides that predate the plan. |
| `set_project_settings` | yes, host-dependent | itself | Write the previous values back; undoability is not verified live. |
| Value writes (names, layer properties and attributes, parent, matte, timing, time remap, expressions, loops, text document, camera, light, material, audio, effect controls, composition settings, animator and shape item updates) | yes | the same operation with the previous value | Several declare the previous value unobserved (`update_mask`, `set_shape_path`, `set_time_remap`, `set_audio`, `set_material_options`), so the restoring rerun is only as good as what the receipt carries. |
| `animate_property`, `animate_control` | yes | none | Undo removes the keyframes; no clear-keyframes operation is shipped. |
| `ensure_effect`, `add_text_animator`, `ensure_text_animator`, `create_shape_group`, `add_shape_item`, `ensure_shape_fill`, `ensure_shape_stroke` | yes | none | Undo removes what was added; no removal operation is shipped. |
| `apply_preset` | project state, unverified live | none | The receipt lists what the preset added. Whether a preset joins the undo group is not verified on a live host. |
| `ensure_layer_style` | host-dependent | itself, which only switches the style off | Nothing removes the style; the menu command's undo behavior is not verified. |
| `add_essential_property` | yes, host-dependent | none | No documented script API removes a single exposure. |
| `render_composition`, queue or configure only | yes, one step | none | A queue item is project state. No file is written. |
| `render_composition` with `RENDER_NOW` | no for the output file | none | Undo does not delete the rendered file; nothing in extynt does. Check the path before applying. |
| `export_mogrt` | no for the file | none | Undo does not delete the written template. |
| `vector.create-inline` (inline SVG import) | not undoable by registry | none | The managed source file remains after project Undo. |

Operations with no scripting entry point (track motion, the Warp Stabilizer and 3D Camera Tracker analysis step, Roto
Brush, Content-Aware Fill) are unsupported and not offered (registry status `unsupported`). The two analysis effects
can still be added with `ensure_effect`; see [footage-and-analysis.md](../footage-and-analysis.md). Puppet pins are not in that list:
`set_puppet_pins` (registry `puppet.set-pins`) is implemented.

Puppet pins place up to 64 pins at exact composition-pixel positions, each with up to 256 keyframes
(`packages/action-plan/src/puppet-pin-ops.ts`). The first apply wraps the layer in a 1080 x 1080 carrier composition
named `<layer> puppet` and replaces the layer with a carrier layer; the receipt returns `carrierLayerId`, and later
calls re-pin that carrier. The mesh is the Puppet grid preset, 4x4 for up to 16 pins and 12x12 above
(`apps/panel/host/apply-puppet.jsx`). The host refuses a layer it cannot wrap (`PUPPET_LAYER_UNSUPPORTED`): 3D, parented,
with children parented to it, a track matte or adjustment layer, or animated opacity. It needs the extynt plugin's
stream bridge. Undo is not in the table below: the apply creates a project item and replaces the layer, no inverse
operation is shipped, and the undo group is not recorded as verified live.

Only `RENDER_NOW`, `export_mogrt` and the managed SVG source leave effects
outside project state. Everything else is reversible by Undo, so a missing
inverse operation is a product gap and not a host limit; the plan notices state
this per operation (`packages/mcp-server/src/notices.ts`).

## Validation requirement

Before enabling any multi-operation batch, run the deterministic fake-host
suite for at least the creator/dependent, failed-prefix, duplicate receipt, and
lost-receipt cases. At a major milestone, run a focused script in
`tools/host-verification` against the supported AE build to capture the
actual undo-group count, postcondition/read-back evidence, and timeout
behavior. Use approximately ten green headless iterations per real-AE
validation pass; the host pass is where version/build evidence may be promoted.
