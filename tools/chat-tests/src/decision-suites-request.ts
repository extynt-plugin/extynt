// The suites over reading a request: its parts, what has been built, drawn scenes, names, layer styles, evidence kinds, scale and continuation.
import {
  ASKS_PICTURE_JUDGEMENT, CONTINUATION, DRAWN_SCENE_REQUEST, LAYER_STYLE_REQUEST, NAMED_OBJECT_ASKED, NEEDS_FRAME_EVIDENCE, NEEDS_MOTION_EVIDENCE,
  ASSERTS_CURRENT_STATE, REQUEST_MISSING, REQUEST_PARTS, REQUEST_SCALE,
} from "@extynt/decide";
import type { AppliedStep } from "@extynt/decide";
import { array, decodeJson, number, object, optional, string } from "@extynt/decode";
import { specCase } from "./decision-eval-cases.js";
import {
  loadClaimCases, loadCompletionCases, loadContinuationCases,
  loadEvidenceCases, loadNamedCases, loadPartsCases, loadSceneCases, loadScaleCases, loadStyleCases, tagsOf,
} from "./decision-fixtures.js";
import type { SpecSuite } from "./decision-eval-types.js";

const stepFacts = object({
  role: optional(string()),
  target: optional(object({ propertyPath: optional(string()) })),
  keyframes: optional(array(object({ value: array(number()) }))),
});

function appliedStep(step: { readonly type: string; readonly payload: string }): AppliedStep {
  const facts = decodeJson(step.payload, stepFacts);
  const read = facts.ok ? facts.value : {};
  const positionKeys = (read.keyframes ?? []).flatMap(({ value: [x, y] }) => (x === undefined || y === undefined ? [] : [[x, y] as const]));
  return { type: step.type, json: step.payload, propertyPath: read.target?.propertyPath ?? "", role: read.role ?? "", positionKeys };
}

function evidenceSuite(name: string, pick: "temporal" | "visual" | "judgement"): SpecSuite {
  const spec = pick === "temporal" ? NEEDS_MOTION_EVIDENCE : pick === "visual" ? NEEDS_FRAME_EVIDENCE : ASKS_PICTURE_JUDGEMENT;
  const cases = loadEvidenceCases().cases.map((row) => specCase({ id: row.id, tags: tagsOf(row), spec, state: { goal: row.goal }, expected: row[pick] }));
  return { name, cases };
}

/** The suites over reading a request. */
export function requestSuites(): ReadonlyArray<SpecSuite> {
  return [
    { name: "request-parts", cases: loadPartsCases().cases.map((row) => specCase({ id: row.id, tags: tagsOf(row), spec: REQUEST_PARTS, state: { request: row.request }, expected: row.parts })) },
    {
      name: "request-completion",
      cases: loadCompletionCases().cases.map((row) => specCase({
        id: row.id, tags: tagsOf(row), spec: REQUEST_MISSING, state: { request: row.request, applied: row.applied.map(appliedStep) }, expected: row.missing,
      })),
    },
    { name: "drawn-scene", cases: loadSceneCases().cases.map((row) => specCase({ id: row.id, tags: tagsOf(row), spec: DRAWN_SCENE_REQUEST, state: { request: row.request }, expected: row.label })) },
    { name: "named-object", cases: loadNamedCases().cases.map((row) => specCase({ id: row.id, tags: tagsOf(row), spec: NAMED_OBJECT_ASKED, state: { request: row.request, name: row.name }, expected: row.asked })) },
    { name: "layer-style", cases: loadStyleCases().cases.map((row) => specCase({ id: row.id, tags: tagsOf(row), spec: LAYER_STYLE_REQUEST, state: { message: row.message, goal: row.goal }, expected: row.asked })) },
    evidenceSuite("evidence-temporal", "temporal"),
    evidenceSuite("evidence-visual", "visual"),
    evidenceSuite("evidence-judgement", "judgement"),
    { name: "request-scale", cases: loadScaleCases().cases.map((row) => specCase({ id: row.id, tags: tagsOf(row), spec: REQUEST_SCALE, state: { request: row.request }, expected: row.label })) },
    {
      name: "asserts-current-state",
      cases: loadClaimCases().cases.map((row) => specCase({
        id: row.id, tags: tagsOf(row), spec: ASSERTS_CURRENT_STATE, state: { message: row.message }, expected: row.asserts,
      })),
    },
    { name: "continuation", cases: loadContinuationCases().cases.map((row) => specCase({ id: row.id, tags: tagsOf(row), spec: CONTINUATION, state: { message: row.message }, expected: row.label })) },
  ];
}
