# ADR 0038: Ask first, design first, build, then animate

Status: accepted. Decisions 2 and 4, and their 2026-10-12 amendment, are superseded by ADR 0042.

## Context

A run of the rocket regression prompt
ended with a stray 1920×1080 composition and every layer drawn for 16:9 inside the
user's 1620×1350 composition. The planet and trail were off the frame, the rings
never passed behind the planet, no specialist was consulted, and the turn was
recorded as failed. The causes were in our code and prompts, not only the model:

- The briefing told the model to queue a composition "before you inspect anything"
  and to leave `compositionId` out, and the composer sent every unnamed operation
  to the active composition even in a plan that had just created a new one.
- A new shape layer sits at the composition centre with its anchor at [0,0]; the
  model assumed [0,0] and drew in composition coordinates, so unpositioned layers
  landed off the frame.
- Specialists were optional and the workflow contract said "do not
  design the whole job first", so the whole scene and its motion went into one
  25-operation batch and parts were cut to fit.
- Nothing asked the user about a 30-second composition and a 6-second request.
- The workflow event log was full: terminal jobs with applied batches and every
  blocked job were never archived, so `EVENT_LOG_FULL` refused the batch, the turn
  was marked failed, and no verification cycle could run.

## Decision

1. Ask first. In the first cycle the owner compares the request with the open
   composition; when they conflict or the request reads two ways it calls
   `ae_ask_user`, which ends the turn with one question. The reply opens a job
   whose goal carries the original request, the question and the answer, and any
   settled specialist threads and orchestration bundle move to that job (for up
   to an hour).
2. Design first. A queue call that creates shape, text or solid layers or vector
   artwork is refused (`WORKFLOW_DESIGN_REQUIRED`) until the job has a
   visual-scene handoff; with no design, the sidecar launches the visual-scene and
   motion specialists itself with the open composition's facts. A failed or
   unavailable specialist does not block the build.
3. Show the design when asked. A request to see the plan first is answered by a
   design brief sent through `ae_ask_user`; after approval the build applies
   normally, without a per-batch review hold, unless the user asked to approve
   every batch.
4. Build, then animate. A batch may not keyframe or add expressions to layers it
   creates (`WORKFLOW_DESIGN_FIRST`). After a build batch has executed, animation
   needs a visual observation recorded after it (`WORKFLOW_FRAME_CHECK_REQUIRED`),
   checked at stage selection and at queue time. Every stage has its own
   25-operation budget.
5. The composition you are in. The briefing builds in the open composition at
   its real size, duration and frame rate, and creates a new composition only
   when asked, when none is open, or as a subcomp placed inside the open one.
   When a plan creates a composition while another is open, an operation that
   names neither is refused (`AMBIGUOUS_COMPOSITION`); an operation on a layer
   the plan created inherits that layer's composition.
6. Plan cards name new layers ("create_layer · Planet", not "New layer").
7. The workflow log compacts: completed, cancelled and blocked jobs with no host
   work pending are archived beyond the newest four, and older ones further while
   the retained log is above 96 KB.

## Consequences

- A job that builds new visual layers costs one specialist round (about a minute
  at medium effort), even for a single text layer; edits to existing layers do
  not.
- Static scene and motion take at least two batches and a frame check, so a scene
  job uses more cycles; the default of eight still covers design, check and two
  motion stages.
- Guarded workflow undo covers only the newest four terminal jobs; After Effects'
  own Undo remains for older work.
- The panel does not yet re-read After Effects when a message is sent, so "the
  open composition" is the one from the last probe (rule 9 still tells the model
  to refresh when the user describes something else). Left for a follow-up.
- Why most runs still finish `applied_unverified` is not fully explained here:
  per-step receipt read-back gaps (keyframe digests, shape items and effect
  controls outside the snapshot budget) still need measuring against real
  receipts.

## Amendment (2026-10-12)

Decisions 2 and 4 applied to every job, so a red solid or a null started both
specialists and went through a build stage, a frame check and an animate stage:
13 model calls and about 450k input tokens for one solid on DeepSeek. Now:

- Decision 2 covers drawn artwork only: shape layers and vector artwork. Solids,
  text, nulls, footage, cameras and lights are placed, not designed, and need no
  scene design.
- Decision 4 (no keyframes on layers the batch creates, and the frame check
  before animating) applies only to a job that has a scene design. A job without
  one may create and animate plain layers in the same stage.

The wider move to proportional cost is recorded in ADR 0042.
