# ADR 0037: computation tools — the model composes, code calculates

Status: accepted

## Context

The model authors every typed operation itself, and before this change that
included the arithmetic: where a parented layer's anchor lands in composition
space, the points and Bézier tangents of an arc, the key times that make a
motion speed up, the rotation that keeps a layer facing its direction of
travel, the start offsets of a centre-out stagger. The validator catches a
malformed plan; it cannot catch a well-formed plan whose numbers are guessed.
That is the expensive failure — a valid, approvable plan that does the wrong
thing — and it is the failure these tools exist to prevent.

A proposed alternative put a domain compiler between the model and the plan:
the model would write a typed semantic goal (`arc_around`, `speed_profile`, …)
and code would ground, solve, and materialise the operations, with the current
path kept as a fallback lane. It was not adopted. A goal vocabulary is a second
language the model must learn, it is narrower than the operation registry, and
every new creative idea would need a new constraint kind — a catalogue of
canned intents again, typed rather than regex-matched. A materialiser that reads `arc_around`
differently from the user produces a valid wrong plan whose numbers the model
never saw. Two lanes would also undo the single planning surface of ADRs 0032
and 0035.

## Decision

Keep one planning surface and give the model calculators rather than a compiler.
Solvers are pure functions in `packages/mcp-server/src/solvers/`, exposed as
read-only tools the model calls when it needs a number:

- `ae_measure_layer` — a layer's anchor, corners, bounds, and layer-to-comp
  matrix from the snapshot, parents resolved, with caveats for animation, 3D,
  and layers that have no fixed size.
- `ae_solve_arc_path` — Position keyframes on an exact circular arc with
  Bézier spatial tangents (`4/3·tan(θ/4)·r` handles), times spread by a speed
  profile, and optional Rotation keyframes along the tangent. Given a target it
  returns ready `animate_property` operations.
- `ae_solve_stagger` — per-item start times for forward, reverse, centre-out,
  edges-in, and seeded random orders, by step or total span, optionally eased.

Solver output is ordinary operation data: it passes through the same validator,
policy, compiler, and host boundary as anything the model writes by hand, and
the model still sees and queues every number. A novel request simply uses fewer
solvers; there is no routing decision and no fallback lane.

## Consequences

- The briefing tells the model to compute geometry and timing rather than
  estimate it, and to pass solver numbers through unchanged.
- New solvers are added where traces show arithmetic errors, one at a time,
  each tested alone. A composite tool is justified only by evidence that the
  model repeatedly chains the same solvers.
- Not yet covered: auto-orient is not in the operation registry, rendered
  bounds of text and shape layers need the host (`sourceRectAtTime`), and
  requirement-level verification (sampled values checked against typed
  acceptance assertions) is the natural next step.
