// The reference sections the model reads on demand through ae_read_guide, so the briefing carries one line per topic instead of every section.
import { decode, literal, object } from "@extynt/decode";
import type { AgentToolCall, AgentToolSpec } from "@extynt/llm";

/** The name of the read-only tool that returns one guide section. */
export const AGENT_GUIDE_TOOL = "ae_read_guide";

/** The guide topics, in the order the briefing lists them. */
export const AGENT_GUIDE_TOPICS = ["effects", "expressions", "shapes", "text", "queue", "scoped"] as const;

type AgentGuideTopic = (typeof AGENT_GUIDE_TOPICS)[number];

/** Reference material the model needs only sometimes. The briefing names each topic in one line; ae_read_guide returns the section. */
export const AGENT_GUIDES: Readonly<Record<AgentGuideTopic, string>> = {
  effects: `Effects.
- Host capability data is authoritative over this prompt and over any recalled matchName. Search ae_search_host_capabilities for what this After Effects has, then ae_describe_host_capability detail=controls for control paths and ranges.
- A control is addressed "<effectPath>/<control matchName>". ensure_effect takes capabilityId, effectMatchName and effectPath "ADBE Effect Parade/<matchName>" (the same path in target). set_effect_control and animate_control take effectMatchName with target {compositionId, layerId, effectPath, propertyPath}.
- A few effects need host setup and cannot be added unattended: ensure_effect refuses those with the reason, so do not retry. Tell the user to add that one by hand.
- User assisted effects and controls: a search or describe result marked userAssisted is one you may use, but After Effects shows a dialog (or may ask for options) that only the user can finish, and a control marked user assisted has no value a script can write. When you plan one, say so in your reply as its note directs, naming the effect or control: After Effects will show a dialog the user must finish (for one that only may ask for options, say it might), or the control is set by them by hand; if they cancel the dialog, the step fails and the plan is undone. An applied plan means they finished the dialog; their choice lives inside the effect and no readback shows it (a control marked opaque shows a label, not the setting), so never tell the user it is unset.
- Queue the ensure_effect and one set_effect_control per value the user named in the same call. A Glow with Glow Radius 40 on layer L:
  {"type":"ensure_effect","target":{"layerId":"L","effectPath":"ADBE Effect Parade/ADBE Glo2"},"capabilityId":"adobe.glow","effectMatchName":"ADBE Glo2","effectPath":"ADBE Effect Parade/ADBE Glo2"}
  {"type":"set_effect_control","target":{"layerId":"L","effectPath":"ADBE Effect Parade/ADBE Glo2","propertyPath":"ADBE Effect Parade/ADBE Glo2/ADBE Glo2-0003"},"effectMatchName":"ADBE Glo2","value":40}
  Each control's matchName and range come from ae_describe_host_capability, never from a guess.`,
  expressions: `Expressions and keyframes.
- A property carrying an expression ignores new keyframes. An expression on a keyed property stops those keys driving it while leaving them readable reference data (value, valueAtTime, loopOut), so keyframe evidence only means something when the expression reads it. Clear the expression with set_expression {enabled: false} to let the keys drive again.
- Text-box size is not observable, so height-fitted motion has to be computed inside an expression (thisLayer.sourceRectAtTime). As with any dynamic output, the receipt can confirm the write but never the motion it computes.
- A parented layer's Position, and any Position expression, is in the parent's space, not the composition's. Centre text by its Anchor Point instead (Anchor Point expression: r=sourceRectAtTime(); [r.left+r.width/2, r.top+r.height/2]), so Position is simply where the centre goes.
- set_expression also targets an exact effect control: pass effectPath and propertyPath "<effectPath>/<control matchName>" in target, spelled the way ae_inspect_layer shows the control, with the effect already on the layer or ensured earlier in the same queue.`,
  shapes: `Shapes and artwork.
- A scene you will animate is drawn and built by the visual-scene designer as separate native shape layers, one per part, each on its own pivot; its report names them, and you animate them by name.
- ae_create_vector_artwork is for a single static piece of artwork: send complete inline SVG and extynt sanitizes it, shows it in the approval plan, then privately materializes and imports it as one editable native-shape composition (AE 26.2.1+). SVG linear and radial gradients and their stops go through the native importer; no user path is needed. Its optional targetCompositionId places the result as one precomp layer. Linked mode is not supported and is refused truthfully.
- Direct low-level shape edits: create_shape_group, set_shape_path, ensure_shape_fill, ensure_shape_stroke, add_shape_item, update_shape_item.
- A native AE shape gradient's colour stops remain unscriptable after import. Point and path edits are available through native shape paths; to change imported gradient stops, create revised SVG artwork instead of pretending the stop list can be rewritten.
- A new shape layer sits at the composition centre with its anchor at [0,0] and its contents are drawn in layer space around that anchor: draw around [0,0] and place the layer with transform.position, or set its position to [0,0] first when you draw in composition coordinates. ae_measure_layer reports where a layer really sits.`,
  text: `Text.
- Pass font only when you are deliberately setting or changing typography, and then it must be an exact PostScript name ae_search_fonts returned, never an invented one. Omitting font on existing text leaves its font alone, which is what editing the words normally wants.
- Per-character animation is one add_text_animator carrying properties and selector keyframes: a letter-by-letter reveal is properties {opacity: 0} with "selector.start" keyed 0 to 100. A key is either set or keyframed, never both in one operation.`,
  queue: `Queue responses and one complete exchange.
Responses to ae_queue_add:
  accepted      {"queued": 4, "accepted": 4, "next": "..."}
  checkpoint    {"queued": 25, "accepted": 21, "corrected": 4, "checkpoint": {"reviewed": 25, "queued": 25, "outstanding": []}, "next": "..."}
  outstanding   a checkpoint whose "outstanding" lists {"index", "type", "code", "message", "instruction"}; ae_queue_fix takes those indexes
  refused       {"queued": 12, "accepted": 0, "fix": [{"position": 0, "type": "ensure_shape_fill", "code": "TARGET_NOT_FOUND", ...}], "next": "..."}
Every operation in an accepted call is judged as it arrives, so "accepted" is the whole answer for it. From time to time the sidecar re-reads the whole queue and returns a checkpoint; an empty "outstanding" means carry on. A refused ae_queue_add call is atomic: nothing from it remains queued, so fix the named positions and resend the whole call. Nothing reaches the project until ae_queue_finish.
Exchange:
  ae_queue_add {"operations": [
    {"type": "create_layer", "target": {"layerId": "__new__:bar"}, "layerType": "shape", "name": "Lower Third"},
    {"type": "set_layer_property", "target": {"layerId": "__new__:bar"}, "role": "transform.position", "propertyPath": "ADBE Transform Group/ADBE Position", "value": [960, 900]},
    {"type": "ensure_shape_fill", "target": {"layerId": "__new__:bar"}, "groupId": "root", "color": [0.1, 0.1, 0.12]}
  ]}
  -> {"queued": 3, "accepted": 3}
  ae_queue_finish {}
  -> {"sealed": true, "operationCount": 3, "undoGroups": 1, "queued": 0}`,
  scoped: `Scoped (bounded) reads, for a project observed through graph pages.
- ae_read_graph_page returns shallow index, layer, property, numeric-value, local blur or effect-create pages. Follow the returned stable IDs, ordinals and continuation; the sidecar owns freshness, cache eviction, scheduling and revision reconciliation. ae_get_graph_page waits for the same demand without redispatch.
- Scoped approval currently supports exact layer names and one existing unique static Gaussian Blur Blurriness scalar. Demand target.kind=blur with a fresh observed stamp to obtain its complete local read set. A separate effect-create demand supports one absent Gaussian creation with explicit enabled and initialization {blurriness, dimensions, repeatEdgePixels:boolean}; dimensions is Blur Dimensions: 1 = Horizontal and Vertical (the usual blur), 2 = Horizontal only, 3 = Vertical only. Choose every value from the user intent, or ask when it materially changes the requested semantics; no defaults are inferred. Creation and later scalar edits use separate exact approvals. Existing effects are refused by creation. Animation and expression dependencies remain unsupported.
- Evidence: planned is approved intent, applied is a host receipt, structurally verified is targeted readback, visually observed is selected frame evidence. None implies complete expression or dependency closure. A failed or partial receipt, or an unresolved native call, needs reconciliation or recovery, never an automatic write retry. A rename needs no screenshot merely to prove its name.
- Scoped rename, Gaussian creation and blur receipts do not support panel/API Undo: tell the user native AE Undo is available and report the receipt's undo-group count without promising reversal after intervening edits.`,
};

/** The tool declaration the model sees for ae_read_guide. */
export const AGENT_GUIDE_SPEC: AgentToolSpec = {
  name: AGENT_GUIDE_TOOL,
  description: "Return one reference section of the extynt guide. Read-only, no project access. The briefing says when each topic is worth reading.",
  parameters: {
    type: "object",
    properties: { topic: { type: "string", enum: [...AGENT_GUIDE_TOPICS], description: "The guide section to return." } },
    required: ["topic"],
    additionalProperties: false,
  },
};

type GuideToolResult =
  | { ok: true; tool: string; snapshotFingerprint: null; data: { topic: AgentGuideTopic; guide: string } }
  | { ok: false; error: { code: string; message: string } };

const guideRequest = object({ topic: literal(...AGENT_GUIDE_TOPICS) });

/** Answers an ae_read_guide call from the model's own arguments: the named section, or INVALID_ARGUMENT naming the topics when the topic is missing or unknown. */
export function readGuideTool(args: AgentToolCall["arguments"]): GuideToolResult {
  const request = decode(guideRequest, args);
  if (!request.ok) return { ok: false, error: { code: "INVALID_ARGUMENT", message: `ae_read_guide needs a topic: ${AGENT_GUIDE_TOPICS.join(", ")}.` } };
  const { topic } = request.value;
  return { ok: true, tool: AGENT_GUIDE_TOOL, snapshotFingerprint: null, data: { topic, guide: AGENT_GUIDES[topic] } };
}
