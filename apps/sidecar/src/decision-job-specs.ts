// The decisions made when a job opens, as one batch over the request: each @extynt/decide spec re-read over the shared state, with its fitted bands.
import {
  ASKS_PICTURE_JUDGEMENT, ASSERTS_CURRENT_STATE, DRAWN_SCENE_REQUEST, LAYER_STYLE_REQUEST, MODEL_TIER, NAMED_OBJECT_ASKED, REQUEST_ROUTE, REQUEST_SPECIALISTS, NEEDS_FRAME_EVIDENCE, NEEDS_MOTION_EVIDENCE, REQUEST_PARTS, REQUEST_SCALE, VISUAL_WAIVER,
  namedObjectCandidates, withFittedBands, type AnySpec, type BinarySpec, type ChoiceSpec, type FeatureId, type SpecialistRole, type JsonValue, type LabelsSpec,
} from "@extynt/decide";

/** What the job-open batch reads: the job's request (its goal) and the turn's message, which are the same text for a fresh request. */
export type JobText = { readonly request: string; readonly message: string };

const MAX_NAMED_QUESTIONS = 20;

const NATIVE_NAME_PREFIX = "ADBE_";

function overBinary<Inner extends JsonValue>(spec: BinarySpec<Inner>, project: (state: JobText) => Inner, note = ""): BinarySpec<JobText> {
  return { ...spec, instructions: `${spec.instructions}${note}`, deterministic: (state) => spec.deterministic(project(state)), deterministicConfidence: (state, answer) => spec.deterministicConfidence?.(project(state), answer) ?? 1 };
}

function overChoice<Inner extends JsonValue, Label extends string>(spec: ChoiceSpec<Inner, Label>, project: (state: JobText) => Inner): ChoiceSpec<JobText, Label> {
  return { ...spec, deterministic: (state) => spec.deterministic(project(state)), deterministicConfidence: (state, answer) => spec.deterministicConfidence?.(project(state), answer) ?? 1 };
}

function overLabels<Inner extends JsonValue, Label extends string>(spec: LabelsSpec<Inner, Label>, project: (state: JobText) => Inner): LabelsSpec<JobText, Label> {
  return { ...spec, deterministic: (state) => spec.deterministic(project(state)), deterministicConfidence: (state, answer) => spec.deterministicConfidence?.(project(state), answer) ?? 1 };
}

const requestOf = (state: JobText): { readonly request: string } => ({ request: state.request });
const goalOf = (state: JobText): { readonly goal: string } => ({ goal: state.request });

const waiverOf = (state: JobText) => ({ goal: state.request, designed: false, structuralOperations: true, exactValuesOnly: true, allConfirmed: true });

const WAIVER_NOTE = " Read it for the goal alone: assume the batch only sets or restructures values, designed nothing, and every written value was confirmed.";

const JOB_NOTE = " The state's request is the job's request; its message is the latest message of the turn.";

const JOB_OPEN_DECISIONS: Readonly<Record<string, AnySpec<JobText>>> = {
  [REQUEST_PARTS.name]: withFittedBands(overLabels<{ readonly request: string }, FeatureId>(REQUEST_PARTS, requestOf)),
  [DRAWN_SCENE_REQUEST.name]: withFittedBands(overChoice(DRAWN_SCENE_REQUEST, requestOf)),
  [REQUEST_SCALE.name]: withFittedBands(overChoice(REQUEST_SCALE, requestOf)),
  [NEEDS_MOTION_EVIDENCE.name]: withFittedBands(overBinary(NEEDS_MOTION_EVIDENCE, goalOf, JOB_NOTE)),
  [NEEDS_FRAME_EVIDENCE.name]: withFittedBands(overBinary(NEEDS_FRAME_EVIDENCE, goalOf, JOB_NOTE)),
  [ASKS_PICTURE_JUDGEMENT.name]: withFittedBands(overBinary(ASKS_PICTURE_JUDGEMENT, goalOf, JOB_NOTE)),
  [VISUAL_WAIVER.name]: withFittedBands(overBinary(VISUAL_WAIVER, waiverOf, WAIVER_NOTE)),
  [LAYER_STYLE_REQUEST.name]: withFittedBands(overBinary(LAYER_STYLE_REQUEST, (state) => ({ message: state.message, goal: state.request }))),
  [REQUEST_ROUTE.name]: withFittedBands(overChoice(REQUEST_ROUTE, requestOf)),
  [REQUEST_SPECIALISTS.name]: withFittedBands(overLabels<{ readonly request: string }, SpecialistRole>(REQUEST_SPECIALISTS, requestOf)),
  [ASSERTS_CURRENT_STATE.name]: withFittedBands(overBinary(ASSERTS_CURRENT_STATE, (state) => ({ message: state.request }))),
  [MODEL_TIER.name]: withFittedBands(overChoice(MODEL_TIER, requestOf)),
};

/** The key a named-object question is asked under: the decision name, a colon and the name. */
export function namedObjectKey(name: string): string {
  return `${NAMED_OBJECT_ASKED.name}:${name}`;
}

function namedQuestion(name: string): BinarySpec<JobText> {
  return withFittedBands(overBinary(NAMED_OBJECT_ASKED, (state) => ({ request: state.request, name }), ` The name to decide on is "${name}".`));
}

function askedNameCandidates(request: string): ReadonlyArray<string> {
  return namedObjectCandidates(request).filter((name) => !name.startsWith(NATIVE_NAME_PREFIX)).slice(0, MAX_NAMED_QUESTIONS);
}

/** The whole job-open batch for a request: the fixed decisions and one named-object question per name it carries. */
export function jobOpenBatch(request: string): Readonly<Record<string, AnySpec<JobText>>> {
  const named = askedNameCandidates(request).map((name): readonly [string, AnySpec<JobText>] => [namedObjectKey(name), namedQuestion(name)]);
  return { ...JOB_OPEN_DECISIONS, ...Object.fromEntries(named) };
}
