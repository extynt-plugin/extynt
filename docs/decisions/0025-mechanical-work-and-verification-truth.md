# ADR 0025: the harness does its own mechanical work, and verification tells the truth

Status: accepted

## Context

A reviewed live run built a twelve-second countdown leader: 31 steps, 62 tool
calls, 578.6 seconds of agent turn, and 3.81M billed tokens of which 98.8% were
served from the prompt cache. The After Effects work in that turn — 133
operations applied and verified — took **3.9 seconds**. Measured against the
earlier attempt at the same brief (57 steps, 89 tools, 9.57M tokens), the queue
architecture had already taken most of the cost out; what remained was four
classes of defect, and only one of them was the model's fault.

**1. The harness refused work it had instructed.** Rule 6 of the briefing tells
the model to "leave compositionId out to mean the composition this job is
building in", and the worked example omits it on every operation.
`composeIncomingOperations` required it and refused the operation without one. A
live run obeyed its instructions, was refused at 19:42:11 and again at 19:42:17,
and spent two steps discovering that the rule it had been given was not the rule
being enforced. The same shape appeared one step later: the briefing says the
model "never count[s] operations, and never split[s] work to keep a call or a
plan small … how much fits in one call is the harness's business", while
`ae_queue_add` refused a 30-operation call because the ceiling is
`PLAN_UNDO_BATCH_SIZE` — the After Effects *undo group* size, whose own
definition says it must never become a limit the caller is told about. That
refusal plus the seven re-send steps after it cost 8 of the turn's 30 steps.

**2. A correct verification verdict could not be reported.** The receipt read
`status:"executed"`, `postcondition:"failed"`, `hostError:null`. The verification
ladder produced that combination legitimately — apply succeeded, verification
did not pass — but it collapsed two different situations into one word:
verification that ran and disagreed, and verification that could not run at all.
The host's own evidence file identified the cause precisely: at that run's verify
tick every operation type verified except `set_text_document`, which had twelve
recorded failures with basis `text-document-mismatch`. What reached the model was
the notice `Applied batch 1 — failed.` — no operation, no field, no reason. The
model then spent six hand-inspection calls and told the user the composition was
built.

This one was misdiagnosed twice before it was understood, and the correction is
the point. The briefing's rule 11 tells the model to read `ae_status` before
saying what happened — "how many operations, how many undo groups it became,
whether the host ran it, whether the read-back confirmed it" — and the handler that
answers the *in-panel* agent returned the version and the composition and nothing
else. The sidecar's richer `statusToolResult` is the external HTTP route; the
in-panel agent calls `callTool` in process and never saw `latestWork` at all. So
rule 11 was a promise the tool could not keep, and the model had not ignored a
warning it was given — it had never been given one. An earlier draft of this record
said otherwise and was wrong.

**3. The context guard-rails were inert.** `llm-config.ts` declares DeepSeek a
1,000,000-token window, so `turnBudget` derived `toolTokens: 938000`,
`perResultChars: 844200` and `foldedChars: 33768`. The turn's 62 tool results
totalled 66,569 tokens, so `foldOldToolResults` **never fired once**. It also had
a second, independent reason to be dead: `foldedChars` was itself window-derived
at 33,768 — larger than nearly every individual result — so even a fold that ran
would have skipped everything by its own "did this shrink it" guard. And it
counted only `role === "tool"` messages, leaving the largest carried term
invisible: replayed reasoning, which grew 0 → 4,006 → 8,012 → 12,018 → 16,024
characters across five measured steps and was re-sent in full on every later one.

**4. Measurement could not see the cost.** `agent.turn` logged
`usage.totalTokens` only, while the adapters already computed the cache split;
86–97% of a long turn's tokens are re-sends of its own accumulated context, so
the number that was being watched overstated the bill by roughly an order of
magnitude and pointed optimisation at the wrong thing.

Four smaller defects were found in the same pass: `probeWarnings` was unbounded
(measured at **54,569 characters for 512 warnings**, against a 616-character
layer list); live snapshots were **flat**, so `extractEffects` — which walks
`children` — returned nothing on a real project while every hand-written fixture
nested correctly; `ae_describe_native_operation` re-sent its whole registry entry
including a static plan-type contract on every call; and `responseBudgetBytes`
was declared by nine tools and read by none.

## Decision

**1. Stop refusing what the briefing instructs.** `composeIncomingOperations`
resolves an omitted or empty `compositionId` to `snapshot.activeCompositionId`,
falling back to the plan's single declared composition when a project has no
active one; anything genuinely ambiguous is still refused. `ae_queue_add` accepts
a call of any size and splits it internally at `PLAN_UNDO_BATCH_SIZE`, rolling
the whole call back if any chunk is refused — the call stays the unit of meaning
even though it is staged in pieces, and reported positions stay call-relative.
`ae_inspect_composition` and `ae_inspect_layer` default to the active composition
like their siblings.

**2. The status the agent is told to read reports the work.** `ae_status` answers
with the newest work and the receipt's own numbers — how many operations, how many
undo groups, whether the host ran it, whether the read-back confirmed it — and,
when a read-back failed, how many operations disagreed and on what
(`failedOperations`, `failureBasis`, read from the receipt's `repair` packet when
present and the failed verification steps when not). A repeated read inside one turn
collapses to an "unchanged" answer that still carries the work, because the briefing
tells the model to read it before speaking and a waiting turn reads it more than
once. The slot for that belongs to the caller, which is the layer that knows what a
turn is.

**3. Verification has four bands, and the inconclusive one is named.**
`passed` / `applied_unverified` / `failed` keep their meanings;
`verification_unavailable` is the fourth, tested **first**, because a probe that
never answered computes its per-operation steps against an empty snapshot and
every one of them reads as a failure that did not happen. `statusFromApplyReceipt`
maps it to `applied_unverified` explicitly rather than by falling through, so a
later change to the default cannot silently reclassify it.

**4. A failure says what failed, and reaches every reader.** A verification that
ran and found mismatches emits a bounded `repair` packet —
`{failedCount, operations: [≤8 × {index, operation, basis, field?, expected?,
observed?}]}` — which the sidecar preserves through receipt normalisation. The apply notice groups the packet into at most three
labels and a count (`12 of 133 operations did not read back (set_text_document,
field "font")`), keeps its exact old wording when no packet is present, and never
claims a denominator it does not have.

**5. The working set is bounded independently of the declared window.** A
window-derived budget is a memory-safety bound and stays; what was missing is a
*working-set* bound, because a model with a 1M window was allowed to carry 938k
tokens of stale schema dumps it no longer needed. `foldTokens` is the smaller of
the two (48,000 floor / 5% share / 64,000 ceiling → 50,000 at a 1M window), the
fold counts assistant messages and their replayed reasoning, older reasoning is
replaced by a bounded placeholder while the newest assistant message is left
byte-intact for the provider contract, and a hard backstop stops a turn that
would still exceed the prompt reserve rather than sending an unbounded request.

**6. The briefing carries what this host has already failed at.** Runtime
evidence is rendered into the cached half of the briefing as a short list of
operations with recorded read-back failures (`- set_text_document
(text-document-mismatch, 12 failures)`, ≤8 operations, ≤400 characters, absent
entirely when nothing has failed). A rule now also requires searching the host
profile and the operation registry before reporting anything as impossible.

**7. A text layer's Source Text is a legal expression ground** when the same plan
creates that text layer, because that `create_layer` is what writes it. In a
reviewed run the absence of this ground turned a one-layer expression counter
into **eleven** hold-keyed number layers, which is a large part of why the plan
reached 133 operations.

**8. Discovery answers are bounded.** `ae_describe_native_operation` returns a
summary by default (schema, plan shape, worked example, verification status) and
the registry entry entire only at `detail: "full"`; declared response budgets are
enforced by paging against the number declared instead of being written and
stripped; and every target refusal names the ids that would have been accepted,
sourced from the validator rather than from a parallel table.

**9. A frame can be described in numbers, and the description is bounded on both
sides.** The capture path is local-only by contract, so a model that cannot accept
an image has no way to check anything visual. `summarizeFrame` turns decoded RGBA
into coverage, a 3×3 grid, a bounding box, the transparent share and the dominant
colours; `validateFrameSummary` bounds that value where it crosses a process
boundary; and `ae_observe_frame` serves it to the model. The measurement happens
once, in the tested implementation (`packages/visual-evidence`).

## Consequences

- The mechanical refusals are gone, so the steps they cost are gone with them:
  the reviewed run's 8 wasted steps on refusals and re-sends, and the extra
  inspection steps that followed an unexplained failure.
- `set_text_document` is the noisiest operation on this host (47 verifications /
  12 failures, all `text-document-mismatch`). Font identity is now compared with
  case and separator folding and text content through the same line-break
  normalisation the writer uses; a substituted *family* still reports a mismatch,
  because normalisation cannot judge that and loosening further would hide real
  failures.
- The measured cost of the context changes, at the numbers above: a fold that
  fires at 50,000 tokens instead of never, on a turn whose results totalled
  66,569. The long-turn token curve should flatten rather than grow as
  `steps × carried`.
- Live effect discovery works again: snapshots are re-nested from the probe's
  flat path list, so `extractEffects` sees the parade's children on a real host
  as it always did on fixtures. This changes the fingerprint of every live
  snapshot; in-memory comparisons stay self-consistent and runtime evidence is
  keyed by host build rather than fingerprint.

### Residual, deliberately not closed here

- **`perResultChars` is still derived from `toolTokens`**, so one result may be
  larger than the whole working set before the fold shrinks it. It is not fatal
  (the fold runs before the next request) but it is the remaining inconsistency,
  and changing it means changing a test that pins the window monotonicity.
- **The unchanged-collapse is unreachable from the panel agent.** The `memory`
  plumbing is correct and live for external clients through
  `ae_get_plan_status`, but that tool is deliberately retired from the in-panel
  surface, and the in-panel agent polls `ae_status`, which the sidecar answers
  without it. Making that collapse live means adding the equivalent on the
  sidecar's side.
- **Semantic postconditions can now be supported by measurement, though not yet by
  authority.** This change makes the verifier's *deterministic* verdicts honest and
  reportable. Claims like "the wipe sweeps upward" or "the ring visibly spins" are not
  decidable from property read-back, and nothing here renders. A captured frame can be described in numbers — `summarizeFrame` and
  `ae_observe_frame` return coverage, a 3×3 cell grid, a bounding box and the dominant
  colours — so a model that cannot accept an image can check direction, placement and
  coverage rather than asserting them. That is measurement offered to the model, not a
  verdict the verifier enforces; making a *semantic* postcondition carry authority needs the
  checkpoints wired into the receipt.
