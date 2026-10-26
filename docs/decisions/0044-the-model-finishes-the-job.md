# ADR 0044: the model finishes the job; the sidecar keeps it safe, cheap and informed

Status: accepted. This is the single source of truth for how a workflow run starts, continues and ends. Where
code, a prompt, a wake or a tool reply disagrees with this record, the record wins and the code changes.

## Context

Long runs (2–4 h After Effects jobs) kept stopping partway. A full map of the workflow layer
(about 170 situations) showed that the stops did not come from the model or from the correctness and cost
gates. They came from a small set of control rows that contradict each other:

- the prompt (contract rule 7), the stage tool and the wakes tell the model to end after a batch;
- free run then blocks the job for ending in prose and reopens it;
- every one of those round trips counts toward an 8-cycle stall budget that kills the job for good.

The sidecar also builds, seals, releases and completes work on the model's behalf without saying so, so the
model wakes into receipts it did not author and loses the thread.

## Decision

**Goal.** The model builds the whole request and says when it is done. The sidecar keeps the project safe and
the run cheap, tells the model everything it did, and stops a job only when something has really gone wrong.

1. **Only four things end a job:**
   - the model's `ae_workflow_complete`, once it is accepted;
   - the user pressing Stop;
   - a limit the user set: wall clock or spend;
   - a disaster: After Effects is gone, the project state cannot be recovered, or the event log cannot be
     written.
2. **Everything else is feedback.** Refusals, read-back mismatches, coverage gaps, off-frame layers, completion
   refusals and prose endings reach the model in the next message or the next cycle as information. None of
   them blocks the job as a terminal state, and none ends the run.
3. **A cycle is a cost boundary, not an ending.** Ending a cycle (step limit, context limit, window boundary)
   continues the job. A settled, verified seal continues in the same cycle when steps remain.
4. **No progress pauses, it does not kill.** When cycles pass without an applied batch, the sidecar first tells
   the model so: what it tried, what was refused, what is missing. After that, the job pauses with the reason
   shown, and "continue" resumes it. Runaway caps (the cycle ceiling and the hard limit) pause the same way.
5. **Nothing tells the model to stop early.** Prompts, wakes and tool replies say "build the next missing part"
   or "call ae_workflow_complete when every part is built". They never say "…and end", "answer now" or "a prose
   answer completes the job".
6. **Every message matches what happens.** If a reply says there is no automatic retry, the sidecar does not
   retry it.
7. **The correctness and cost gates stay.** Admission, receipts, budgets, design gates, held animation and
   proof without frames all stay. Only the wording of their refusals changes, where rule 5 or 6 requires it.
8. **Planning is long; operations are small.** Before building, the model writes the whole request as a
   checklist: one item per section, shot or deliverable the request names. That checklist is what "done" means. A small request (a short goal naming at most three things) needs no checklist: it is one item, and the existing completion checks apply.
   Cost saving lives in how each item is built (batched operations, trusted receipts, no re-reads, few frames),
   never in how much is built. `ae_workflow_complete` is refused while any item has no verified stage, and the
   refusal names the open items. An item the model tried and could not build may be closed as unbuilt with a
   reason, which the completion answer reports.

Evidence (a 30-second launch film brief, about 60 deliverables): the model said at step 4 that
only the timing setup was built, used `ae_workflow_complete` as a probe for what was missing, patched only the
named keywords, and was accepted at step 19 (1m52s) with 0 of 15 bars built. The job's criteria were the
generic `goal-visual` / `goal-temporal`, which one frame and one keyframe satisfy.

### The sidecar reports what it did, and rechecks when it matters

The sidecar may still act for the model, because those actions save cost: rollover seals, `ae_queue_design`
auto-builds, auto-seals, held-animation releases, measured frames, completion evidence, implicit stages and
window moves. Every such action:

- **Is reported.** It appends one line to the job's sidecar-action ledger, for example "sealed batch b12
  (8 ops, design build 3 of 5), verified". The next thing the model reads carries the unread lines once: the
  tool reply in the same loop, or the continuation message across a cycle or window boundary.
- **Is rechecked when it is big.** If the sidecar sealed mutations the model did not author, and either their
  receipt lacks visual coverage or there were two or more such batches since the model last looked, the next
  cycle is an observation-only cycle (the existing read-only pass) before authoring resumes. The sidecar decides
  this by that rule. The model does not ask for it.
- **Is rechecked when the state is uncertain.** An unverified mutation, a batch rejected or abandoned after
  dispatch, or an undo that did not execute is a recheck, not a retry. The sidecar opens the observation cycle
  and says so, instead of claiming "no automatic retry" and then retrying.

## Situation rules

**Feedback** means: no terminal block, and the message travels in the next continuation message.

| Situation | Rule |
| --- | --- |
| A cycle ends in prose (free run) | feedback: "your cycle ended without ae_workflow_complete; build the next missing part, or complete" |
| Completion is refused and no new batch follows | feedback carrying the refusal |
| Prose with no batch | feedback |
| Stall: 8 cycles with nothing applied | stall feedback at 4 cycles; a resumable pause at 8, with a message that says why |
| Hard limit and ceiling | the 512 ceiling is a resumable pause; the 1024 reducer limit cannot be extended, and its message says to send a new request |
| Wall clock | a real stop (`WORKFLOW_WALL_CLOCK_LIMIT`) whose message names the limit |
| Event log full | a stop; the log warns before the cap |
| Boundary blocker string | matches `USER_OR_HOST_STOPS`; both blocker strings in that snapshot are real, so both stay |
| Wake messages | "...seal it and continue from its receipt." |
| `stopAfterSeal` | a verified seal continues in the loop while steps remain |
| Contract: how a job ends | complete only with `ae_workflow_complete`; keep building until then |
| Stage tool wording | "Seal when the batch is whole, then continue with the next part" |
| Read-back verified | "call ae_workflow_complete" |
| Uncertain state (unverified mutation, abandoned batch, undo that did not execute) | recheck: an observation cycle, with a message that says so |
| Sidecar actions (rollover seals, auto-builds, auto-seals, held-animation releases, measured frames, completion evidence, implicit stages, window moves) | a ledger line; recheck by the rule above |
| Coverage allowance | only `ae_workflow_complete` calls count |
| The same refusal twice | ends the cycle (it prevents loops); the refusal travels as feedback |
| `ask_user` in a continuation | refused: a long run must not wait on an absent user |
| Prose in cycle 0 | cancels the job: a question was answered |
| A held animation | refuses completion |
| Admission, receipts, reducer, design gates | unchanged |

The feedback rules apply in free run, which is the default. Outside free run there is no self-continuation, so those rows still block, which avoids looping a prose-ending model through 8 cycles.
