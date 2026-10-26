// The tool specs a panel chat turn offers the model: the catalogue's read-only tools adapted for the panel, plus the workflow tools the owner loop adds.
import { agentToolDefinitions } from "@extynt/mcp-server";
import type { AgentToolSpec } from "@extynt/llm";
import { AGENT_CHAT_TOOLS, AGENT_VISION_TOOLS } from "./agent-policy.js";
import { AGENT_GUIDE_SPEC } from "./agent-guides.js";
import { WORKFLOW_ASK_TOOL, WORKFLOW_CHECKLIST_TOOL, WORKFLOW_DESIGN_TOOL, WORKFLOW_SPECIALIST_TOOL, WORKFLOW_UNBUILT_TOOL } from "./agent-types.js";
import { webSearchToolSpec } from "./web-search.js";
import { MODEL_SPECIALIST_ROLES } from "./workflow-orchestration.js";

type SpecAdjustment = (spec: AgentToolSpec) => AgentToolSpec;

const WORKFLOW_ASK_SPEC: AgentToolSpec = {
  name: WORKFLOW_ASK_TOOL,
  description: "Ask the user one short question and end this turn. Use it in the first cycle, before selecting a stage or queueing anything, when the request conflicts with the open composition or can be read two materially different ways — offer the concrete choices — or to show the design brief when the user asked to see the plan first. The user's reply continues this job.",
  parameters: {
    type: "object",
    properties: {
      question: { type: "string", minLength: 1, maxLength: 2000, description: "The question, or the design brief in a few short plain lines, ending with what you need from the user." },
      kind: { type: "string", enum: ["question", "design-brief"], description: "design-brief when this shows the design for approval; question otherwise (the default)." },
    },
    required: ["question"],
    additionalProperties: false,
  },
};

const WORKFLOW_CHECKLIST_SPEC: AgentToolSpec = {
  name: WORKFLOW_CHECKLIST_TOOL,
  description: "Write the whole request as a checklist before you build: one item per section, shot or deliverable the request names, however many that is, each with a verbatim spec. First call sets the list; later calls add items and never remove or rename one. Queue each item's batches with stage set to its id (ae_queue_add stage, ae_queue_design stage). An item is done once one of its batches applied and verified; ae_workflow_complete is refused while any item is not done. Returns every item with its status.",
  parameters: {
    type: "object",
    properties: {
      items: { type: "array", minItems: 1, maxItems: 200, items: { type: "object", properties: { id: { type: "string", minLength: 1, maxLength: 40, description: "Short slug, like bar-01 or world-b-intro." }, title: { type: "string", minLength: 1, maxLength: 120, description: "What this item delivers, in a few words." }, spec: { type: "string", maxLength: 400, description: "Verbatim request words." } }, required: ["id", "title"], additionalProperties: false } },
    },
    required: ["items"],
    additionalProperties: false,
  },
};

const WORKFLOW_UNBUILT_SPEC: AgentToolSpec = {
  name: WORKFLOW_UNBUILT_TOOL,
  description: "Close checklist items you tried and could not build, each with its reason; only an item you attempted can be closed. A closed item counts as settled.",
  parameters: {
    type: "object",
    properties: { items: { type: "array", minItems: 1, maxItems: 200, items: { type: "object", properties: { id: { type: "string", minLength: 1, maxLength: 40 }, reason: { type: "string", minLength: 1, maxLength: 240 } }, required: ["id", "reason"], additionalProperties: false } } },
    required: ["items"],
    additionalProperties: false,
  },
};

const WORKFLOW_SPECIALIST_SPEC: AgentToolSpec = {
  name: WORKFLOW_SPECIALIST_TOOL,
  description: "Control one specialist. Launch visual-scene before queueing shape layers or vector artwork (refused without a scene design): the designer draws and builds the scene itself as native layers in an existing composition, then reports the layers by name and id: do not queue them, animate them by name. Add motion only for motion beyond a single move, fade or wiggle. The instruction gives the part it designs (a checklist item's spec, else the whole request) and the composition's name, size, duration, frame rate. wait and status: designer returns at once, a repeat blocks; others block until done; message corrects it. Role expression: launch with what each layer should do; it replies at once with expressions for the real layers and markers.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["launch", "wait", "status", "message"], description: "launch a role, wait for its turn, read status, or message it a follow-up." },
      role: { type: "string", enum: [...MODEL_SPECIALIST_ROLES], description: "The specialist to address." },
      instruction: { type: "string", minLength: 1, maxLength: 4_000, description: "Required for launch/message: the concrete question or correction." },
      waitSeconds: { type: "number", minimum: 0, maximum: 240, description: "Advisory; waits cap at five minutes." },
      compositionId: { type: "string", description: "visual-scene: existing composition to build in (a checklist item's comp); omit for the open one." },
    },
    required: ["action", "role"],
    additionalProperties: false,
  },
};

const QUEUE_FINISH_TEXT = "true seals the batch in this call when nothing needs fixing and returns the receipt (ae_queue_finish review:true holds it for review instead).";
const QUEUE_ADD_FINISH = { type: "boolean", description: `${QUEUE_FINISH_TEXT} Send it on the last add of a stage; omit it to keep adding.` };
const QUEUE_DESIGN_FINISH = { type: "boolean", description: `${QUEUE_FINISH_TEXT} Default true; false keeps the batch open.` };
const QUEUE_ADD_STAGE = { type: "string", description: "Checklist item id, else a panel name." };
const QUEUE_FINISH_REVIEW = { type: "boolean", description: "true when the user asked to see or approve the change before it is applied — except for a job that builds new layers or artwork, where that request is answered by the design brief (ae_ask_user) before anything is built and the approved build then applies without review. The batch is sealed and shown with an Apply button, and nothing applies it, or any later batch in this request, until the user presses it. Omit otherwise." };

const WORKFLOW_DESIGN_SPEC: AgentToolSpec = {
  name: WORKFLOW_DESIGN_TOOL,
  description: "The visual-scene designer builds its own drawing: this answers that the layers are built, naming them. If the designer's report says it compiled a drawing but could not build it (no composition), fix that, then call this to queue the compiled layers as native shape layers, whole layers per batch (it selects the build stage). It seals itself when nothing needs fixing, and the sidecar builds the rest once that applies; never write the shape paths by hand.",
  parameters: {
    type: "object",
    properties: { layers: { type: "array", items: { type: "string" }, maxItems: 48, description: "Optional: build only these layers of the drawing, by name." }, stage: { type: "string" }, finish: QUEUE_DESIGN_FINISH },
    additionalProperties: false,
  },
};

const IN_PANEL_CAPTURE = "Capture one local PNG frame of a composition (never uploaded, never edits). Returns a captureId at once; ae_observe_frame measures it and waits for the capture. The frame itself never reaches you. Use it to judge a picture yourself: a seal and ae_workflow_complete take the frames they need on their own.";
const IN_PANEL_MEASURE_NOTE = " Send both compositionId (the open composition's id) and layerId as the id strings the context or ae_inspect_composition gave you, never a layer number or name; neither may be left out.";
const CATALOGUE_COMPLETE_ADVICE = " If a criterion lacks evidence the answer names it and what to take (visually: ae_capture_composition_frame plus ae_observe_frame).";
const IN_PANEL_COMPLETE_NOTE = " The sidecar takes the frames a criterion needs itself: never capture just to complete; if it could not, the answer names what is missing.";
const CATALOGUE_UNBUILT_SENTENCE = " unbuilt lists checklist items you tried and could not build, each with its reason.";
const IN_PANEL_COMPLETE_PARAMETERS = { type: "object", properties: { goalDigest: { type: "string" }, criterionIds: { type: "array", items: { type: "string" } }, evidence: { type: "array", items: { type: "object" } } }, additionalProperties: false };
const SCOPED_READ_TOOLS: readonly string[] = ["ae_read_graph_page", "ae_get_graph_page", "ae_query_graph_cache"];

function withProperties(extra: AgentToolSpec["parameters"]): SpecAdjustment {
  return (spec) => {
    const properties = spec.parameters.properties;
    return { ...spec, parameters: { ...spec.parameters, properties: { ...(properties && typeof properties === "object" ? properties : {}), ...extra } } };
  };
}

const IN_PANEL_ADJUSTMENTS: ReadonlyMap<string, SpecAdjustment> = new Map<string, SpecAdjustment>([
  ["ae_workflow_complete", (spec) => ({ ...spec, description: spec.description.replace(CATALOGUE_COMPLETE_ADVICE, IN_PANEL_COMPLETE_NOTE).replace(CATALOGUE_UNBUILT_SENTENCE, ""), parameters: IN_PANEL_COMPLETE_PARAMETERS })],
  ["ae_measure_layer", (spec) => ({ ...spec, description: spec.description + IN_PANEL_MEASURE_NOTE })],
  ["ae_capture_composition_frame", (spec) => ({ ...spec, description: IN_PANEL_CAPTURE })],
  ["ae_queue_finish", withProperties({ review: QUEUE_FINISH_REVIEW })],
  ["ae_queue_add", withProperties({ stage: QUEUE_ADD_STAGE, finish: QUEUE_ADD_FINISH })],
]);

function inPanelSpec(spec: AgentToolSpec): AgentToolSpec {
  const adjust = IN_PANEL_ADJUSTMENTS.get(spec.name);
  return adjust ? adjust(spec) : spec;
}

function offeredCatalogueTools(options: AgentToolSpecOptions): ReadonlySet<string> {
  const allowed = new Set<string>(AGENT_CHAT_TOOLS);
  if (options.acceptsImages === true) for (const name of AGENT_VISION_TOOLS) allowed.add(name);
  if (options.wholeRead === true) for (const name of SCOPED_READ_TOOLS) allowed.delete(name);
  return allowed;
}

function whenOn(flag: boolean | undefined, specs: () => AgentToolSpec[]): AgentToolSpec[] {
  return flag === true ? specs() : [];
}

interface AgentToolSpecOptions { acceptsImages?: boolean; webSearch?: boolean; workflowStage?: boolean; workflowSpecialists?: boolean; workflowChecklist?: boolean; wholeRead?: boolean }

/** The tool specs for one turn, in a stable order: the catalogue, the guide tool, then the workflow and web-search tools the options switch on. Image, web search and workflow capabilities are the caller's, never inferred model powers. */
export function agentToolSpecs(options: AgentToolSpecOptions = {}): AgentToolSpec[] {
  const allowed = offeredCatalogueTools(options);
  const catalogue = agentToolDefinitions()
    .filter((tool) => allowed.has(tool.name))
    .map((tool) => inPanelSpec({ name: tool.name, description: tool.description, parameters: Object.fromEntries(Object.entries(tool.inputSchema)) }));
  return [
    ...catalogue,
    AGENT_GUIDE_SPEC,
    ...whenOn(options.workflowStage, () => [WORKFLOW_ASK_SPEC]),
    ...whenOn(options.workflowChecklist, () => [WORKFLOW_CHECKLIST_SPEC, WORKFLOW_UNBUILT_SPEC]),
    ...whenOn(options.workflowSpecialists, () => [WORKFLOW_SPECIALIST_SPEC, WORKFLOW_DESIGN_SPEC]),
    ...whenOn(options.webSearch, () => [webSearchToolSpec()]),
  ];
}
