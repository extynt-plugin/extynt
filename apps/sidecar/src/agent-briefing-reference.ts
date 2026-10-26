// The stable, cacheable half of the agent briefing: operation shapes and families, units, reference sections and the queue guide that the panel agent and the build kit both read.
import { CURVE_PRESETS } from "@extynt/action-plan";
import { NATIVE_OPERATION_REGISTRY } from "@extynt/capability-catalogue";
import { operationReference } from "@extynt/mcp-server";
import { type JsonValue } from "@extynt/decode";

interface ShapeExample {
  readonly label: string;
  readonly note?: string;
  readonly operation: JsonValue;
}

const OPERATION_REFERENCE = operationReference();
const NEW_LAYER = "__new__:a";

function operationFamilyIndex(): string[] {
  const families = new Map<string, Set<string>>();
  for (const entry of NATIVE_OPERATION_REGISTRY) {
    if (entry.implementationStatus !== "implemented") continue;
    const planTypes = families.get(entry.domain) ?? new Set<string>();
    for (const planType of entry.planTypes) planTypes.add(planType);
    families.set(entry.domain, planTypes);
  }
  return [...families.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([domain, planTypes]) => `${domain}: ${[...planTypes].sort().join(", ")}`);
}

const OPERATION_FAMILY_INDEX = operationFamilyIndex();

const COMMON_SHAPE_EXAMPLES: readonly ShapeExample[] = [
  { label: "create_composition", operation: { type: "create_composition", newCompositionId: "__new__:scene", name: "Scene", width: 1920, height: 1080, durationSeconds: 6, frameRate: 30 } },
  { label: "create_layer", note: "no compositionId: the open comp; text/null/shape: other layerType, text takes \"text\"", operation: { type: "create_layer", target: { compositionId: "__new__:scene", layerId: NEW_LAYER }, layerType: "solid", name: "Bg", color: [1, 0, 0] } },
  { label: "set_layer_property", operation: { type: "set_layer_property", target: { layerId: NEW_LAYER }, role: "transform.position", propertyPath: "ADBE Transform Group/ADBE Position", value: [960, 540] } },
  { label: "animate_property", operation: { type: "animate_property", target: { layerId: NEW_LAYER, propertyPath: "ADBE Transform Group/ADBE Opacity" }, role: "transform.opacity", keyframes: [{ time: 0, value: 0, curve: "ease-out" }, { time: 1, value: 100 }] } },
  { label: "set_expression", operation: { type: "set_expression", target: { layerId: NEW_LAYER, propertyPath: "ADBE Transform Group/ADBE Position" }, source: "wiggle(2,30)", enabled: true } },
  { label: "set_layer_parent", operation: { type: "set_layer_parent", target: { layerId: NEW_LAYER }, parentLayerId: "__new__:b" } },
  { label: "set_layer_timing", operation: { type: "set_layer_timing", target: { layerId: NEW_LAYER }, inPoint: 0, outPoint: 4 } },
  { label: "add_marker", operation: { type: "add_marker", target: { layerId: NEW_LAYER }, time: 1 } },
];

function commonShapesHeading(verb: string): string {
  return `Common operation shapes (exact; ${verb} them directly; describe only operations not shown here). __new__:<name> names a comp or layer this batch creates; later operations use that id:`;
}

function shapeLine({ label, note, operation }: ShapeExample): string {
  return `${label}${note ? ` (${note})` : ""}: ${JSON.stringify(operation)}`;
}

/** The shapes block; `verb` is how the reader submits them ("queue" for the panel agent, "propose" for an MCP client). */
export function commonOperationShapes(verb: string): string[] {
  return [commonShapesHeading(verb), ...COMMON_SHAPE_EXAMPLES.map(shapeLine)];
}

/** Exact, validator-checked shapes for the operations most builds use, so the model queues them without a describe call. Static, so it sits in the cached half. */
export const COMMON_OPERATION_SHAPES: readonly string[] = commonOperationShapes("queue");

/** A compact, stable index of every implemented operation family, plus the full rows of the operations a stage explicitly selected; any other operation is opt-in through ae_describe_native_operation. */
export function operationDisclosure(relevantOperationTypes: readonly string[] | undefined): string[] {
  const selected = new Set(relevantOperationTypes ?? []);
  const schemas = OPERATION_REFERENCE.lines.filter((line) => selected.has(line.split(" — ", 1)[0] ?? ""));
  return [
    "Other operations, by family (ae_search_native_operations finds candidates; ae_describe_native_operation gives the full schema and an example, for an operation not shown above):",
    ...OPERATION_FAMILY_INDEX,
    ...(schemas.length ? ["Relevant operation schemas for this stage:", ...schemas] : []),
  ];
}

/** The units, value ranges and property roles every edit follows, shared by the panel agent and the build kit. */
export const VALUES_AND_UNITS = `Values and units:
- Colours are [r,g,b], each channel 0–1. Positions are composition pixels; [width/2, height/2] is the centre. Rotation is degrees, scale is percent (100 = 100%), opacity is 0–100.
- Keyframes are [{time, value, curve?}], time in composition seconds. A curve shapes the segment to the NEXT keyframe, so never put one on the last keyframe. Curves: ${Object.keys(CURVE_PRESETS).join(", ")}.
- Shapes get Gradient Fill; footage, solids, text get Gradient Ramp; never ADBE Fill.
- Overshoot: "overshoot" alone keeps default; "a little"/"slight" 5-10% past the target; "a lot"/"big" 20-30%.
- Property roles: transform.position/scale/rotation/opacity/anchor -> "ADBE Transform Group/" + ADBE Position / ADBE Scale / ADBE Rotate Z / ADBE Opacity / ADBE Anchor Point.
- Never estimate geometry or timing: ae_measure_layer (where a layer really sits), ae_solve_arc_path (arc or orbit motion), ae_solve_stagger (per-layer start times); pass their numbers through unchanged.
- A new shape layer is placed at the composition centre ([width/2, height/2]) with its anchor at [0,0]: draw artwork around [0,0] and place the layer with transform.position.
- A property carrying an expression ignores new keyframes; an expression on a keyed property leaves those keys as readable reference data (value, valueAtTime, loopOut). Height-fitted text motion has to be computed in an expression (thisLayer.sourceRectAtTime): as with any dynamic output, the receipt can confirm the write but never the motion it computes.
- A parented layer's Position (and Position expression) is in the parent's space. Centre text via its Anchor Point (r=sourceRectAtTime(); [r.left+r.width/2, r.top+r.height/2]) so Position is where the centre goes.
- Text: pass font only to change typography deliberately, as an exact PostScript name ae_search_fonts returned. Editing the words leaves the font alone.
- Effects: host capability data is authoritative, so never recall a matchName: ae_search_host_capabilities for what this build has, then ae_describe_host_capability detail=controls for control paths and ranges. A few effects cannot be added unattended; ensure_effect refuses those with the reason: do not retry, add that one by hand and tell the user. A result marked userAssisted shows a dialog only the user can finish: say so in your reply, and never tell the user its setting is unset.
- Specify only the properties a change needs; setting one value leaves the rest alone.`;

const REFERENCE_SECTIONS = `

Reference sections, read with ae_read_guide {topic} (via ae_call_tool) only when the work needs one:
- effects: ensure_effect / set_effect_control paths, a worked Glow, the userAssisted dialog wording. Read before adding or editing an effect.
- expressions: keyframe/expression interplay, set_expression on an effect control.
- shapes: the designer's layers, ae_create_vector_artwork, gradients, shape operations.
- text: fonts and per-character text animators.
- queue: every ae_queue_add response shape and a full exchange. Read after a response you do not recognise.
- scoped: bounded graph-page reads, evidence levels and Undo limits. Read only when the context says the view is scoped.`;

/** The values-and-units text for the panel agent: the shared body plus the guide sections only its tools can read. */
export const PANEL_VALUES_AND_UNITS = VALUES_AND_UNITS + REFERENCE_SECTIONS;

/** How the panel agent fills a queue; a queue-add call keeps its independent operations when one is refused, and checkpoints and seal failures address the queue already held. */
export const QUEUE_GUIDE = `The queue — three calls, no ids:
  ae_queue_add {operations: [...]} the operations you are sure of, in one call
  ae_queue_fix {edits: [...]} change or remove an operation the queue holds, by the index a checkpoint or a seal named
  ae_queue_finish {} the work is whole: the sidecar seals it and the panel applies it (or pass finish:true on the last ae_queue_add)
Each accepted call answers {"queued", "accepted", "next"}; occasionally a checkpoint's "outstanding" lists what is still wrong by queue index, and an empty one means carry on. A refused operation does not stop the valid ones that do not depend on it: the answer lists the positions to resend (the refused ones and their dependents); resend only those, corrected, never the queued ones. If it says nothing was queued, resend the whole call. Nothing reaches the project until ae_queue_finish.
Example: ae_queue_add {"operations": [{"type": "create_layer", "target": {"layerId": "__new__:bar"}, "layerType": "shape", "name": "Lower Third"}, {"type": "set_layer_property", "target": {"layerId": "__new__:bar"}, "role": "transform.position", "propertyPath": "ADBE Transform Group/ADBE Position", "value": [960, 900]}]} then ae_queue_finish {}.`;

/** The target rule for layer-scoped operations. */
export const LAYER_TARGET_RULE = "Layer-scoped operations take target {layerId}; compositionId may be left out (the open composition) and is named only for a different one, or on create_layer in a composition this job creates. layerId is an id the context or an inspection gave, or the __new__:<name> placeholder for a layer this queue creates. Fields marked required must be present.";

/** The line naming operations this build cannot do, so the model says so instead of attempting them. */
export const UNAVAILABLE_OPERATIONS_LINE = `Not available in this build; say so plainly instead of attempting them: ${OPERATION_REFERENCE.unavailable.join(", ")}.`;
