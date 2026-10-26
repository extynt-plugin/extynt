# ADR 0029: deterministic workflow batch closure and refusal

Status: accepted

## Context

A workflow batch is one typed operation list, one After Effects undo unit, and
one receipt. The sidecar must decide whether that list is safe to admit before
the host runs it, not by reading the receipt afterwards.

Two ceilings apply:

- `PLAN_UNDO_BATCH_SIZE` is the authoritative host undo-group bound (25
  operations). The host compiler splits a longer plan into several undo groups.
- `MAX_WORKFLOW_OPERATIONS_PER_BATCH` is the workflow domain's general
  operation ceiling (256). It does not permit a multi-undo plan to count as one
  batch.

Batch closure also needs to prevent three common sources of ambiguity: a batch
that is too expensive, a consumer that appears before its creator, and a
placeholder that is not actually produced by this list. Reordering or silently
partitioning an authored proposal would change its meaning and could separate
an operation from the undo and receipt boundary that makes it recoverable.

## Decision

### Closure is deterministic and all-or-nothing

`@extynt/workflow` exposes `analyzeWorkflowBatch`. It analyzes the submitted
operation list in its original order and returns either a clean closure or one
bounded refusal. It never reorders operations, partitions a proposal, or
silently drops an operation. The sidecar either admits the exact list or asks
the caller to repair/resubmit it.

The closure analyzer reports these refusal classes:

| Code | Meaning |
| --- | --- |
| `EMPTY_BATCH` | No typed operation was supplied. |
| `INVALID_OPERATION` | An entry is not a typed operation envelope. |
| `OPERATION_BOUND` | The list exceeds the effective operation ceiling. |
| `MUTATION_BUDGET` | Weighted mutation cost exceeds the batch budget. |
| `HOST_TIME_BUDGET` | Deterministic host-time estimate exceeds the batch budget. |
| `DEPENDENCY_UNRESOLVED` | A typed identifier references a missing or duplicate producer. |
| `DEPENDENCY_ORDER` | A consumer precedes the operation that creates its placeholder. |

The refusal is a validation result, not an execution result. No host command,
approval capability, workflow admission, or receipt is created by a refused
closure.

### Budgets are explicit, weighted, and conservative

The shared closure defaults are deliberately deterministic:

```text
maxOperations:   256  (domain ceiling; admission tightens this)
maxMutationUnits: 512
maxHostTimeUnits:  1,024
```

The mutation estimate classifies operation names as idempotent (1), ensuring
(1), creating (2), destructive (3), or external (4) units. The host-time
estimate starts at one unit, charges two per keyframe, and applies a higher
weight to render/export-shaped operations. These are admission estimates, not
After Effects wall-clock measurements or a guarantee that a batch will finish
within a particular number of milliseconds.

Callers may tighten a budget, but `analyzeWorkflowBatch` clamps custom values
to the architecture's hard ceilings. A permissive caller cannot widen the
operation, mutation, or host-time limits. Admission additionally
passes `PLAN_UNDO_BATCH_SIZE` as its `maxOperations`, so the current one-undo
workflow bound is 25 even though the general domain ceiling is 256.

### Placeholder dependencies are typed, ordered, and local

Only an explicit producer-field allowlist can mint a dependency placeholder.
The allowlist covers the supported creators (layers, compositions, folders,
imports, masks, shape groups/items, text animators, precompositions, and
duplicates). A string that merely contains `__new__:` in user text, an
expression, a path, or another non-identifier field is not a dependency.

For each typed identifier reference, closure requires exactly one producer in
the same list and requires the producer's ordinal to be lower than the
consumer's. Duplicate producers are refused rather than resolved by choosing
one. A placeholder from an earlier batch must already be rebound to a verified
host id before this batch is admitted; closure does not guess across batches.

The reducer repeats the cross-batch safety check at admission: every declared
dependency must already be verified, and its receipt's observed post-apply
snapshot fingerprint must equal the descendant batch's snapshot fingerprint.
The lifecycle state alone is insufficient evidence because a descendant could
otherwise target a stale project snapshot.

### The undo boundary is authoritative and recomputed

Workflow admission recomputes the expected host undo count from the immutable
typed operation list and `PLAN_UNDO_BATCH_SIZE` before trusting the
caller's reported group count:

```text
expectedUndoGroups = operations.length > PLAN_UNDO_BATCH_SIZE
  ? ceil(operations.length / PLAN_UNDO_BATCH_SIZE)
  : 1
```

Admission accepts only `expectedUndoGroups === 1`, and the caller's reported
count must match that recomputed value. A forged one-group report for a longer
plan is refused; a short plan reporting two groups is also refused. The
implementation does not partition, reorder, or reinterpret the proposal to
make it fit.

### Fake-host evidence is necessary but not sufficient

The deterministic workflow and fake-host suites establish closure behavior,
dependency ordering, receipt correlation, refusal of multi-undo batches, and
stale-lineage blocking. They do not establish After Effects behavior. In
particular, fake receipts cannot promote evidence for actual undo-group count,
host callback loss after mutation, or the sufficiency of a creator's AE
read-back fields.

Before enabling a selected operation set against a supported AE build, a
focused real-host validation script must capture:

1. the actual number of undo groups created by one admitted workflow batch;
2. the post-apply snapshot and exact creator read-back fields used for any
   cross-batch binding; and
3. the outcome when the host callback is lost immediately before or
   after the host mutation begins.

Those host findings are promoted separately from fake-host green runs. A fake
host pass can justify the sidecar contract; it cannot claim real AE support or
verification capability.

## Consequences

- A batch is admitted as the exact authored operation list or is
  refused with a repairable reason; semantic changes are never hidden in
  admission.
- `PLAN_UNDO_BATCH_SIZE` remains the single source of truth for the current
  host undo boundary, whatever count a caller reports.
- Dependency-complete batches can be evaluated before execution, and stale
  descendants are blocked by receipt/snapshot lineage rather than inferred
  from lifecycle status.
- Mutation and host-time budgets bound the host lane without pretending to be
  precise After Effects performance predictions.
- Real AE validation remains an explicit rollout obligation. Fake-host tests
  are architecture evidence, not host certification.
