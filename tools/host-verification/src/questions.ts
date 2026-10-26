/**
 * Open-questions analyzer: turns the raw values `runner/questions*.jsx` record into the
 * short, decisive summary a finding can be closed from. Judgement lives in `question-rules`
 * so a wrong assumption in the probe shows up as data; the validator replay needs no host.
 */

import type { StoredPlan, ToolContext } from "@extynt/mcp-server";
import { compileStoredPlan } from "./stored-plan.js";
import { proposePlan } from "./propose.js";
import type { JsonObject, JsonValue } from "./json.js";
import type { KitStamp, RuntimeInfo } from "./types.js";
import { CASE_COMP, fixtureSnapshot, plannerHostProfile } from "./plan.js";
import { unansweredOf } from "./question-data.js";
import { QUESTION_DERIVERS } from "./question-rules.js";

export interface OpenQuestionDefinition { id: string; title: string; answers: string[] }

/** Mirrors the ids, titles and answer prompts in `runner/questions.jsx`; a test asserts the two never drift apart. */
export const OPEN_QUESTIONS: OpenQuestionDefinition[] = [
  {
    id: "q1-parent-compensation-scope",
    title: "What set_layer_parent compensates, and when it is a no-op",
    answers: [
      "When a layer's Position was written before it is parented, which transform properties does After Effects rewrite — Position only, or Scale, Rotation and Anchor Point as well?",
      "With the parent at [0,0], is the child's local Position left exactly as written?",
      "When a layer that already has a parent is re-parented, does the compensation apply again from its current local value?",
    ],
  },
  {
    id: "q2-value-outside-the-key-range",
    title: "What a keyframed property holds before its first keyframe",
    answers: [
      "For a property whose first keyframe is at t=1, what do value and valueAtTime read at t=0 and at a negative time — the first keyframe's value, or a value written statically before the keyframes?",
      "When the first keyframe is at t=0 instead, is a statically written value observable at any time at all?",
      "With no static write, what does t=0 hold for a property whose first key is later?",
    ],
  },
  {
    id: "q3-static-write-over-keyframes",
    title: "A static write to a property that already has keyframes",
    answers: [
      "When set_layer_property writes a value to a property that already has keyframes, are the keyframes kept, cleared, or is the write refused?",
      "What does numKeys read back as afterwards, and what does the property evaluate to at the keyed times?",
      "Does writing the value a key already holds disturb the keys?",
    ],
  },
  {
    id: "q4-shape-path-without-paint",
    title: "A shape path with no fill or stroke",
    answers: [
      "For a shape layer whose only group holds an ellipse and no fill or stroke, what does sourceRectAtTime report — an empty rect, or the path's bounds?",
      "Does adding a fill to that same group change the reported bounds, which is the observable difference between drawing nothing and drawing the path?",
    ],
  },
  {
    id: "q5-effect-control-colour-precision",
    title: "Is an effect-control colour quantised like a composition background?",
    answers: [
      "When [0.1,0.2,0.3] is written to a colour effect control, does it read back exactly or quantised to 1/255 (26/255, 51/255, 77/255)?",
      "What does the same triple read back as on the composition background colour, on this same build, so the two surfaces can be compared directly?",
    ],
  },
];

/** One question's entry in a probe report; every member is optional because an interrupted probe writes what it had. */
export interface ProbeQuestionEntry {
  id?: string | undefined;
  title?: string | undefined;
  state?: string | undefined;
  error?: string | null | undefined;
  data?: JsonValue | undefined;
}

/** A probe group that threw. */
export interface ProbeError { group?: string | undefined; error?: string | undefined }

/** A probe's open-questions.json. */
export interface OpenQuestionsReport {
  schemaVersion?: string | undefined;
  kind?: string | undefined;
  kit?: KitStamp | undefined;
  runtime?: RuntimeInfo | null | undefined;
  hostKey?: string | null | undefined;
  startedAt?: string | undefined;
  finishedAt?: string | null | undefined;
  outFolder?: string | undefined;
  cleanup?: string | undefined;
  questions?: ProbeQuestionEntry[] | undefined;
  probeErrors?: ProbeError[] | undefined;
  errors?: string[] | undefined;
}

export type QuestionState = "answered" | "partial" | "error" | "unanswered" | "missing";
export interface QuestionVerdict { id: string; title: string; state: QuestionState; facts: string[]; unanswered: string[]; error?: string }
export interface PlannerPathVerdict { key: string; path: string; variant: string; accepted: boolean; code: string; message: string }
export interface OpenQuestionsResult {
  hostKey: string | null;
  hostLabel: string;
  kit: OpenQuestionsReport["kit"];
  probeFinishedAt: string | null;
  cleanup: string | null;
  counts: Record<QuestionState, number>;
  questions: QuestionVerdict[];
  plannerPaths: PlannerPathVerdict[];
  probeErrors: string[];
  probeFailures: string[];
}

interface PropertyPathCandidate { key: string; role: string | null; path: string; value: JsonValue; keyframes: Array<{ time: number; value: JsonValue }> }

const PROPERTY_PATH_CANDIDATES: PropertyPathCandidate[] = [
  { key: "transform.opacity", role: "transform.opacity", path: "ADBE Transform Group/ADBE Opacity", value: 50, keyframes: [{ time: 0, value: 10 }, { time: 1, value: 90 }] },
  { key: "transform.scale", role: "transform.scale", path: "ADBE Transform Group/ADBE Scale", value: [100, 100], keyframes: [{ time: 0, value: [50, 50] }, { time: 1, value: [150, 150] }] },
  { key: "transform.rotation", role: "transform.rotation", path: "ADBE Transform Group/ADBE Rotate Z", value: 30, keyframes: [{ time: 0, value: 0 }, { time: 1, value: 45 }] },
  { key: "transform.position", role: "transform.position", path: "ADBE Transform Group/ADBE Position", value: [10, 20], keyframes: [{ time: 0, value: [0, 0] }, { time: 1, value: [100, 100] }] },
  { key: "transform.anchor", role: "transform.anchor", path: "ADBE Transform Group/ADBE Anchor Point", value: [5, 6], keyframes: [{ time: 0, value: [0, 0] }, { time: 1, value: [40, 40] }] },
  { key: "text.selector.percentStart", role: null, path: "ADBE Text Properties/ADBE Text Animators/ADBE Text Animator/ADBE Text Selectors/ADBE Text Selector/ADBE Text Percent Start", value: 50, keyframes: [{ time: 0, value: 0 }, { time: 1, value: 100 }] },
];

const PROBE_LAYER = "__new__:probe";
const createProbeLayer = { type: "create_layer", target: { compositionId: CASE_COMP, layerId: PROBE_LAYER }, layerType: "text", name: "Probe", text: "Probe" };
const declareSelectorAnimator = { type: "add_text_animator", target: { compositionId: CASE_COMP, layerId: PROBE_LAYER }, newAnimatorId: "__new__:animator", properties: { opacity: 0 }, selector: { type: "range", settings: { start: 0, end: 100 } } };

function plannerVerdict(operations: JsonObject[]): { accepted: boolean; code: string; message: string } {
  const plans = new Map<string, StoredPlan>();
  const context: ToolContext = { snapshot: fixtureSnapshot({ layers: [] }), plans, hostProfile: plannerHostProfile(), now: () => new Date("2026-01-01T00:00:00.000Z") };
  const proposal = proposePlan("open questions: which property paths does the validator accept on a layer created in the same plan", operations, context);
  if (proposal.kind === "refused") return { accepted: false, code: proposal.code, message: proposal.message };
  const stored = plans.get(proposal.planId);
  if (!stored) return { accepted: false, code: "UNKNOWN", message: "the plan store lost the accepted plan" };
  const compiled = compileStoredPlan(stored.plan);
  if ("ok" in compiled) return { accepted: false, code: compiled.code, message: compiled.message };
  return { accepted: true, code: "", message: "" };
}

/** The validator half of the replay: no After Effects needed, so it is always in the summary. */
export function plannerPathVerdicts(): PlannerPathVerdict[] {
  const out: PlannerPathVerdict[] = [];
  const target = { compositionId: CASE_COMP, layerId: PROBE_LAYER };
  for (const candidate of PROPERTY_PATH_CANDIDATES) {
    const variants: Array<{ variant: string; operations: JsonObject[] }> = [
      { variant: "set_layer_property", operations: [createProbeLayer, { type: "set_layer_property", target: { ...target }, role: candidate.role, propertyPath: candidate.path, value: candidate.value }] },
      { variant: "animate_property", operations: [createProbeLayer, { type: "animate_property", target: { ...target, propertyPath: candidate.path }, keyframes: candidate.keyframes, keyframeMode: "replace" }] },
      { variant: "set_expression", operations: [createProbeLayer, { type: "set_expression", target: { ...target, propertyPath: candidate.path }, source: "value", enabled: true }] },
    ];
    if (candidate.key === "text.selector.percentStart") {
      variants.push({ variant: "add_text_animator → animate_property", operations: [createProbeLayer, declareSelectorAnimator, { type: "animate_property", target: { ...target, propertyPath: candidate.path }, keyframes: candidate.keyframes, keyframeMode: "replace" }] });
      variants.push({ variant: "add_text_animator → set_expression", operations: [createProbeLayer, declareSelectorAnimator, { type: "set_expression", target: { ...target, propertyPath: candidate.path }, source: "value", enabled: true }] });
    }
    for (const entry of variants) {
      const verdict = plannerVerdict(entry.operations);
      out.push({ key: candidate.key, path: candidate.path, variant: entry.variant, accepted: verdict.accepted, code: verdict.code, message: verdict.message });
    }
  }
  return out;
}

const questionState = (entry: ProbeQuestionEntry): QuestionState => entry.state === "answered" || entry.state === "partial" ? entry.state : entry.state === "error" ? "error" : "unanswered";

function verdictFor(definition: OpenQuestionDefinition, entry: ProbeQuestionEntry | undefined): QuestionVerdict {
  if (!entry) return { id: definition.id, title: definition.title, state: "missing", facts: [], unanswered: [], error: "the probe report has no entry for this question" };
  const { data } = entry;
  const unanswered = unansweredOf(data);
  const state = questionState(entry);
  let facts: string[] = [];
  try {
    const deriver = QUESTION_DERIVERS[definition.id];
    if (deriver) facts = deriver(data);
  } catch (error) {
    facts = [`the analyzer could not read this question's data: ${error instanceof Error ? error.message : String(error)}`];
  }
  return { id: definition.id, title: definition.title, state, facts, unanswered, ...(entry.error && state !== "answered" ? { error: entry.error } : {}) };
}

function questionEntries(report: OpenQuestionsReport): Map<string, ProbeQuestionEntry> {
  const entries = new Map<string, ProbeQuestionEntry>();
  for (const entry of report.questions ?? []) if (typeof entry.id === "string") entries.set(entry.id, entry);
  return entries;
}

const ordinalOf = (id: string): number => Number(/^q(\d+)/.exec(id)?.[1]) || Number.MAX_SAFE_INTEGER;

function hostLabelOf(runtime: OpenQuestionsReport["runtime"]): string {
  if (!runtime) return "unknown host";
  const build = runtime.buildNumber ? ` (build ${runtime.buildNumber})` : "";
  return `After Effects ${String(runtime.appVersion ?? "?").replace(/x\d+$/, "")}${build} ${runtime.platform ?? "?"}/${runtime.architecture ?? "?"}`;
}

function countStates(questions: QuestionVerdict[]): Record<QuestionState, number> {
  const counts: Record<QuestionState, number> = { answered: 0, partial: 0, error: 0, unanswered: 0, missing: 0 };
  for (const question of questions) counts[question.state] += 1;
  return counts;
}

export function analyzeOpenQuestions(report: OpenQuestionsReport): OpenQuestionsResult {
  const entries = questionEntries(report);
  const questions = OPEN_QUESTIONS.map((definition) => verdictFor(definition, entries.get(definition.id))).sort(
    (left, right) => ordinalOf(left.id) - ordinalOf(right.id),
  );
  return {
    hostKey: report.hostKey ?? null,
    hostLabel: hostLabelOf(report.runtime ?? null),
    kit: report.kit,
    probeFinishedAt: report.finishedAt ?? null,
    cleanup: report.cleanup ?? null,
    counts: countStates(questions),
    questions,
    plannerPaths: plannerPathVerdicts(),
    probeErrors: (report.probeErrors ?? []).map((entry) => `${entry.group ?? "probe"}: ${entry.error ?? "unknown error"}`),
    probeFailures: report.errors ?? [],
  };
}

const hostLine = (result: OpenQuestionsResult): string => `Host key: \`${result.hostKey ?? "unknown"}\` · kit ${result.kit?.extyntVersion ?? "?"} · probe finished ${result.probeFinishedAt ?? "?"}`;

function questionsHeader(result: OpenQuestionsResult): string[] {
  const lines = [
    `# Open questions — ${result.hostLabel}`,
    "",
    hostLine(result),
    "",
    `Questions: ${result.counts.answered} answered, ${result.counts.partial} partial, ${result.counts.error} error, ${result.counts.unanswered} unanswered, ${result.counts.missing} missing.`,
    "",
  ];
  if (result.cleanup) lines.push(`Project cleanup: ${result.cleanup}.`, "");
  if (result.probeFailures.length) lines.push("## Probe failures", "", ...result.probeFailures.map((error) => `- ${error}`), "");
  if (result.probeErrors.length) lines.push("## Probe group errors", "", ...result.probeErrors.map((error) => `- ${error}`), "");
  return lines;
}

function questionSection(question: QuestionVerdict, index: number): string[] {
  const ordinal = Number(/^q(\d+)/.exec(question.id)?.[1]);
  const lines = [`## Q${Number.isFinite(ordinal) ? ordinal : index + 1} — ${question.title} — ${question.state}`, ""];
  if (question.error) lines.push(`> ${question.error}`, "");
  lines.push(...question.facts.map((fact) => `- ${fact}`));
  if (!question.facts.length) lines.push("- no observation was recorded");
  if (question.unanswered.length) lines.push("", `Unread on this host: ${question.unanswered.join("; ")}`);
  lines.push("");
  return lines;
}

function validatorReplay(result: OpenQuestionsResult): string[] {
  const lines = ["## Validator replay (no After Effects required)", "", "`[create_layer, <operation>]` against a snapshot whose composition has no layers.", "", "| Path | Operation | Validator | Code |", "| --- | --- | --- | --- |"];
  for (const entry of result.plannerPaths) lines.push(`| \`${entry.key}\` | ${entry.variant} | ${entry.accepted ? "accepted" : "refused"} | ${entry.code || "—"} |`);
  return lines;
}

export function renderQuestionsSummary(result: OpenQuestionsResult): string {
  const lines = questionsHeader(result);
  for (const [index, question] of result.questions.entries()) lines.push(...questionSection(question, index));
  lines.push(...validatorReplay(result));
  return `${lines.join("\n")}\n`;
}
