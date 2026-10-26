# ADR 0026: the queue is the commit unit, so a refused chunk keeps the chunks before it

Status: accepted

## Context

A reviewed live run built the twelve-second countdown leader again, and the same
defect appeared twice in it. `ae_queue_add` splits a call larger than
`PLAN_UNDO_BATCH_SIZE` (25) into chunks and validates each chunk through
`addToPlan`, but the loop then rolled the whole call back if any chunk was
refused. The reasoning was recorded in `packages/mcp-server/src/index.ts`:

> The call stays the unit of meaning even though it is staged in pieces.
> `addToPlan` refuses a batch atomically, so a chunked call that fails partway is
> rolled back to the state it started from: the alternative — leaving the earlier
> chunks staged — would turn one call the agent asked for into a half-applied
> one, which is the thing the per-batch atomicity exists to prevent.

That was wrong about which unit the user asked for, and the run measured the
cost:

- The step whose banner reads "step 10 sent" (transcript lines 3152–3160; the call at
  3155, the model's reasoning at 3173–3185): an 86-operation call refused because
  one `ensure_effect` at position 6 was missing `target.effectPath`. The failure was
  inside the **first** chunk, so `queued: 0, accepted: 0` came back. The 19 entries
  and 7,023 characters of `fix` it answered with on the pre-change code — the root
  plus a `TARGET_NOT_FOUND` for every later control, one entry per operation — are a
  recorded measurement of that shape, not one this tree can re-run: the replay is not
  in the test, whose fixture (a root at position 6 with thirty derived effect controls
  behind it, eighteen of them inside the failed chunk) pins the post-change answer
  instead — one root, one consequence group, and `notValidated: {from: 25, to: 85}`.
- The step whose banner reads "step 11 sent" (transcript lines 3346–3357): the same
  stray top-level `groupId` copied into eight `create_shape_group` operations, split
  across the two calls at lines 3349 and 3350 — six in the first (positions 2, 16,
  37, 43, 67, 75; 86 operations) and two in the second (positions 56 and 63; 81
  operations). No single answer ever listed eight. The first call's faults are
  positions 2 and 16, both inside the chunk that failed, so under containment its
  answer is one entry listing [2, 16] with `notValidated: {from: 25, to: 85}`; the
  four faults past the failed chunk are never validated at all.
- The fix list was folded in context anyway ("Call ae_queue_add again if you need
  the rest"), and the model's own reasoning says it could not retrieve it: "I need
  to see the FULL fix list … I can't retrieve it" (transcript lines 3179–3185). It
  then re-authored the payload blind, and the replies the transcript's own usage
  lines close as steps 9–12 emitted 25,807 + 16,812 + 13,019 + 6,524 = 62,162 output
  tokens: 45.1% of the run's 137,818.

Three defects sat behind that, and they are independent:

1. **A rejected operation cost the whole call.** Nothing is applied before
   `ae_queue_finish`: the plan is the sidecar's, it is readable mid-authoring with
   `ae_recall_plan`, and `addToPlan` already treats an unresolved reference as a
   legitimate mid-authoring state — the plan module's own doc comment (since removed) says so and reports
   it as a note rather than a refusal. A staged prefix is therefore not a
   half-applied change; it is the state that design exists to allow.
2. **The refusal told the model something false.** It said "only the fixed
   operations need to be resent", while nothing from the call was staged — so an
   agent obeying it silently dropped every accepted operation of its own batch.
   The same falsehood was in the `ae_plan_add` tool description ("accepted
   operations are kept and the plan stays open"), so the promise the model read
   while authoring and the refusal it received contradicted each other.
3. **The fix list was mostly cascade noise.** A long tail of derived refusals is
   not new information: it is one root plus arithmetic the sidecar can already do.

## Decision

**Containment at chunk granularity; validation stops at the first failed chunk.**

- Chunks that validated stay staged. Only the failing chunk is unstaged, and it
  is unstaged as a unit, because a batch is composed and validated as a unit.
- Validation does not continue past the first failed chunk. A later chunk would
  be judged against objects the failed chunk never created, so continuing would
  manufacture exactly the cascade noise this change is removing.
- Positions in `fix` are call-relative, as they always were; the chunk offset
  arithmetic is preserved, and `consequenceOf` is offset with it.
- The response is explicit about the queue's state: how many operations were
  queued from the call, that the failing chunk's accepted operations are not
  queued either, and the exact range that was never validated
  (`notValidated: {from, to}` plus the same range in `next`).
- The rollback bookkeeping (`stagedBefore`, and the `record.staged` /
  `placeholderBindings` / `plan` / `updatedAt` snapshot it restored) is deleted
  with the rollback: there is nothing left to restore it for.

**The refusal states exactly what to resend, on both surfaces.** The plan
lifecycle (`addToPlan`) now says the batch is staged whole or not at all, that the
operations which were accepted are not in the plan either, and that the whole
batch has to come back with the fix applied. The queue's refusal names the
positions that were refused, the positions that were validated and are not queued
either, the range that was never validated, and the prefix that does not need
re-sending.

**Fix lists collapse, and the collapse is grounded, not guessed.**

- Entries with the same code and identical message text become one entry listing
  every position. The text is the template: a text that differs names a different
  field, object or operation, and merging those would hide which one is at fault.
- A refusal the sidecar can *prove* follows from an earlier one is reported under
  that root as a consequence, not as a separate fix, and the root comes first.
  What is provable here is narrow and was checked before it was promised:
  effect materialisation. A refused effect-control operation is attributed to the
  nearest earlier `ensure_effect` aimed at the same composition, layer and effect
  path, when its message says the missing thing is an `ensure_effect` and that
  provider is itself refused. That is the live case.
- **What is not provable is not claimed.** A `__new__:` placeholder cascade is not
  derivable: the validator forgives a reference to an object an earlier operation
  in the same plan declares *whatever that operation's verdict was* — measured on
  this tree, and visible in the captured call itself, a `create_shape_group` whose
  top-level `groupId` is refused does not make the operations that reference the
  group it declares fail: they were accepted in the same answer.
  `PlanProblem.dependents` is not used either: it is
  computed from `createdIdsOf`, which reads `target.layerId` on every operation
  type, so a refused `set_layer_name` "creates" the layer it names and every later
  operation mentioning it would be excused. Excusing a real error is worse than
  reporting a derived one.
- Nothing is capped. A cap would drop refusals the agent has no way to re-read —
  the call would have to be sent again to see them — and with the two collapses
  above the refusal is short enough to fit in context without being folded at all.

**The plan path states its own ceiling.** `ae_plan_add` still refuses a call larger
than `PLAN_UNDO_BATCH_SIZE` — that is a recorded decision with its own test ("a
batch larger than the undo group is refused rather than silently split") — so its
descriptions say so plainly instead of promising that the harness will absorb an
oversized call. Chunking that path was considered and rejected: it would renumber
batches inside one call, change what `MAX_AUTHORING_BATCHES` and the job status
count, and give the plan path a second, call-relative coordinate system alongside
the plan indexes `ae_amend_plan` takes. The queue is the path that splits, and its
description says that too; the intent that no *plan* is limited by a per-call
ceiling is kept, because the ceiling belongs to the tool, not to the plan.

## Consequences

- The captured 86-operation call, whose shape is recorded at 19 fix entries and 7,023
  characters on the pre-change code, now produces one root entry plus one nested
  consequence group: one `ensure_effect` to fix, eighteen positions that resolve with
  it, and a `notValidated` range. The `groupId` faults are one entry per failed
  chunk rather than one answer listing all eight — [2, 16] with
  `notValidated: {from: 25, to: 85}` for the first call of that step, [56, 63] with
  `{from: 75, to: 80}` for the second — and a single call whose faults all fall
  inside its first chunk is one entry listing all of them.
- The measured live shapes are pinned by tests: an 86-operation call refused at
  position 6 asserts `accepted: 0`, one fix entry, positions 7–24 as its
  consequences, and `notValidated: {from: 25, to: 85}`; a 26-operation call whose
  refusal is its 26th operation asserts that the first 25 stay queued, that the plan
  the queue owns really holds them, and that nothing was left unvalidated; and a call
  with eight identical `groupId` faults inside its first chunk asserts one entry
  listing all eight positions.
- The fold exemption in the sidecar already keys on a non-empty `fix` array, so a
  refusal stays readable; the smaller list makes that exemption cheap rather than
  load-bearing.
- A full re-send of a partially staged call duplicates its prefix, and nothing in the
  guard catches it: an identical group is only recognised when the previous call
  ended on the success path. Measured on this tree, three verbatim sends of a
  65-operation call with one fault at position 30 took the queue 25 → 50 → 75, each
  reporting no duplicate. No broader dedupe is added — the existing guard is
  deliberately narrow ("the same group, immediately again, with the queue exactly as
  that call left it"), and a heuristic that dropped a prefix would silently discard
  work the caller meant twice. The refusal is where the model can be told, so it is:
  the queued positions are named as already queued, and the sentence says that
  sending the whole call again would queue them a second time.
- The agent's authoring rules and the authoring line the panel shows come from the
  sidecar's briefing; the briefing states the containment rule.

### Residual, deliberately not closed here

- **A placeholder cascade is reported, not excused.** Where the validator does not
  forgive a reference to an object an earlier refused operation declared, the
  derived refusal appears as its own entry. That is the conservative direction: a
  duplicate to fix costs one line, an excused real error costs the run.
- **Only the effect chain is attributed.** A cascade through `update_shape_item`'s
  `itemId`, a mask ordinal, or a text animator has no message that names the
  missing object and no single provider test to mirror, so it is not attributed.
  Adding one later means finding a structural test as exact as
  `hasPlannedEffect`, not widening the message match.

## Addendum: a refused operation no longer costs the independent rest of the call

Superseded in part: a call with refused operations now stages every operation that validated and
does not depend on a refused one (since removed: staging is in `queue-stage.ts`). Dependence is what the call text proves: the
composer's `consequenceOf` chains, any operation naming an id a held operation creates (followed to a
fixed point, forward references included), and writes on a layer whose `set_layer_parent` is held.
The answer lists `fix` (the refusals), `dependents`, `resend` (all positions owed) and says to resend
only those; the staged part is remembered by the duplicate guard, so a verbatim whole-call resend is
answered with the same owed list instead of queueing the staged part twice. The all-or-nothing answer
stays where partial staging is unsafe: nothing independent remains, re-staging the independent subset
is itself refused or fails (up to four rounds), or composition fails. The sidecar still refuses a seal
sent beside such an answer, because positions are still owed.
