# ADR 0042: one loop per job, a stable prefix, and cost in proportion to the change

Status: accepted. Supersedes ADR 0038 decisions 2 and 4 (and their 2026-10-12
amendment) and the part of ADR 0040 that lets the sidecar launch specialists by
itself.

## Context

A baseline measurement of the in-panel agent on five scenarios found this. A red solid then undo took 4 + 3 model calls
and 144k input tokens on the fake host, and 14 + 5 calls and 478k on real After
Effects. The cost was set by the harness, not by the request:

- Each call carried a prefix of about 25k tokens: the full in-panel tool list
  (47k characters) and a briefing that held reference material most jobs never use.
- The live state rode inside the system prompt, so the prefix changed every
  step and the cache barely held. Scenario 5 cached 19% on the fake host.
- Each job ran in staged cycles: a build stage, a frame check and an animate
  stage, each one a fresh agent loop. Visual and temporal evidence was required
  for every change, including a single solid.
- The sidecar launched the visual-scene and motion specialists itself for any
  job that drew layers. In scenario 5 they wrote 75k of the 86k output tokens,
  and that output broke the batch digest.

## Decision

1. **A stable prefix.** The system prompt and the tool list are the same bytes
   on every step of a turn. Per-step state (snapshot facts, the job, the last
   receipt, a short carried summary of earlier work) goes in one trailing
   user message that is marked transient and never cached. The history before
   it does not change between steps.
2. **A core tool set.** The panel offers the tools a typical job needs
   directly. Everything else is reached through `ae_tool_schema` and
   `ae_call_tool`, validated by the sidecar like any direct call.
   Reference material the briefing used to carry (effects, expressions,
   shapes, text, queue, scoped edits) is returned by `ae_read_guide` on demand.
   The system prompt plus tools stays under 12k tokens, and a test pins it.
3. **One loop per job.** `ae_queue_add` opens its own stage. A batch that
   auto-applies is awaited inside `ae_queue_finish`, which returns a compact
   receipt, and the model continues in the same messages. A job whose batch
   verified and whose answer is plain prose completes from its receipts.
   A batch the host refused before running anything because the project moved
   (`STALE_SNAPSHOT`, `SELECTION_CHANGED`) goes back to the model to re-read and
   queue again, at most twice per job. Any other batch that ends failed, and a
   repair past its limit, blocks the job so the chat lane is free. So does a
   turn that ends on a read-back mismatch the model did not repair.
   A job with a scene design runs in the same loop (amended 2026-10-13). Its
   build batch creates the static scene; animating it waits for a frame check,
   and a settled batch frees its layers for the next batch. A batch whose
   drawing only a frame can prove (`applied_unverified`, or a job that asks for
   visual evidence the read-back did not give) also continues. Before the model
   reads its receipt, the sidecar captures one frame of the batch's composition
   and measures it, records that as the job's visual evidence, and puts the
   measurement in the receipt, so the check costs no model call. When no frame
   can be measured, the receipt asks the model to capture and observe one.
   Every cycle reads the user's whole request as its goal, bounded at 8,000
   characters line by line, never a 256-character summary.
   `AE_WORKFLOW_SINGLE_LOOP=0` keeps staged cycles for every job, for the
   engine's own tests.
4. **Evidence in proportion to the change.** A structural read-back satisfies a
   structural change: a comp, a solid, a null, a parent, an expression, a
   keyframe set. A frame capture or a temporal check is required only for drawn
   artwork (shape layers, vector artwork), work that went through a scene
   design, or a goal that asks how something looks. This replaces ADR 0038
   decision 4 as amended: the frame check before animating still applies, but
   only to a job with a scene design. When a batch's read-back already covers
   every evidence kind its job requires, the receipt says so, and the model
   answers or queues the next batch without capturing a frame.
5. **The model chooses specialists.** The sidecar never launches a specialist
   by itself. Shape or vector artwork queued with no scene design is refused
   (`WORKFLOW_DESIGN_REQUIRED`) with a message telling the model to launch
   visual-scene, and motion only for more than a single move, fade or wiggle.
   This replaces ADR 0038 decision 2 and narrows ADR 0040: the specialist roles,
   their read-only boundary and their lifecycle are unchanged, and only who
   starts them changes.
6. **Context carries between jobs.** The trailing state message carries a
   summary of at most 1,500 characters: the open comp, what the last two jobs
   built, and the last outcome. It keeps only ids present in the current
   snapshot, so the model does not re-read what it just made.
7. **Show what was built.** After a plan applies, the panel opens the top-level
   composition it built in the viewer.

ADR 0038 decisions 1, 3, 5, 6 and 7 stand.

## Evidence

The same five scenarios, the same model (DeepSeek `deepseek-flash`) and the same
fixtures as the baseline.

| # | Scenario | Baseline fake | Final fake | Baseline AE 25 | Final AE 25 | Final AE 26 |
|---|---|---|---|---|---|---|
| 1 | build; undo | 4 / 87.8k; 3 / 56.7k | 3 / 31.9k; 2 / 21.3k | 14 / 381k; 5 / 96.7k | 3 / 32.8k; 2 / 21.5k | 3 / 32.7k; 2 / 21.6k |
| 2 | null-parent-wiggle | 4 / 92.2k | 3 / 39.1k | 14 / 410k, fail | 3 / 33.6k | 4 / 49.7k |
| 3 | title-slide-and-fade | 4 / 82.0k | 3 / 34.2k | 2 / 39.2k, asked | 4 / 57.5k | 4 / 49.4k |
| 4 | title-ident-from-scratch | 565k, fail | 86k, fail (fixture) | 622k, partial | 1.12M, partial | 452k, partial |
| 5 | rocket-orbit | 265k, fail | 66k, fail (fixture) | 1.50M, motion missing | 506k, pass | 703k, pass on screen |

Cells give main calls / input tokens. On real After Effects the first call of a turn is 10.4k to 10.9k tokens, and 85% to 94% of input is cached from step 2 onward. Scenario 4 does not meet its target on real After Effects; see Open risks.

## Consequences

- Most jobs never see a specialist. A drawn scene still costs a design round,
  now started by the model when the work calls for it.
- A plain structural job is trusted on its read-back. A bug that changes the
  look of a layer while its properties read back right would no longer be
  caught by a frame. The read-back covers the properties the operation set.
- Tools outside the core set cost one extra call the first time a job needs
  their schema. When a long-tail tool turns out to be needed on most jobs, it
  moves into the core set; `ae_measure_layer` already did.
- The carried summary is about 450 characters per step that are never cached.
- External MCP clients see the same server tools as before. Only the in-panel
  surface is trimmed.
- A property written while its own expression is enabled reads back as the
  expression's output, so the write is graded `coerced_equivalent`
  (`property-value-under-expression`) instead of a mismatch. The expression's own row
  proves the expression.

## Open risks

- Completion still accepts any verified receipt for the goal criterion. Before
  the 2026-10-13 amendment, scenario 4 closed on real After Effects with the
  title, camera, markers and Essential Graphics property unbuilt: the goal was
  cut to 256 characters, and every staged cycle restarted without history. On
  AE 25 that cost 1.12M input against a 622k baseline. The whole request now
  reaches every cycle, the designed job stays in one loop, and contract rule 7
  has the model check every requested item before answering. Nothing checks
  item by item yet, so a model that answers early still closes the job.

- Legacy admission paths that still assume staged cycles, the fixed 3 s
  pairing wait after a seal, and `LIMIT_EXCEEDED` coverage need their own tests.
- Carried ids could collide when a project is closed and another one reuses
  them. The snapshot filter narrows this risk but does not remove it.
- The ledger records usage per turn, not per call, so "cached from step 2
  onward" is not measured directly.
