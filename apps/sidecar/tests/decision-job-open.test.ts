// The job-open decisions: one request to the decision model for the whole batch, its confident answers read by the seams, and the deterministic answers whenever it is absent, fails or is unsure.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { clearBook } from "../src/decision-book.js";
import { primeJobOpen } from "../src/decision-prime.js";
import { decideSceneRequest } from "../src/build-kit.js";
import { decideLayerStyleRequest } from "../src/layer-style-request.js";
import { decideFeatureAsk, decideNameAsk, requestedFeatures } from "../src/request-coverage.js";
import { requestScale } from "../src/server-workflow-checklist-model.js";
import { goalAsksForJudgement, requiredEvidenceKindsForGoal } from "../src/workflow-goal-evidence.js";
import { applying, picked, scriptedModel, serviceOver, yesNo } from "./decision-fakes.js";

const GERMAN = "Füge dem Titel einen weichen Schein hinzu und zeichne einen Sternenhimmel. PLAN_CARD soll bleiben.";

beforeEach(() => clearBook());

function jevReadingGerman() {
  return scriptedModel((question) => {
    if (question.id === "request-parts" && question.kind === "labels") return applying(new Set(["glow"]), question.labels.map((entry) => entry.label));
    if (question.id === "drawn-scene") return picked("drawn-scene");
    if (question.id === "request-scale") return picked("small");
    if (question.id === "named-object:PLAN_CARD") return yesNo(true);
    if (question.id === "layer-style-request") return yesNo(false);
    return yesNo(question.id === "evidence-temporal" ? false : true);
  });
}

test("with no model configured nothing is asked and the seams answer as before", async () => {
  const { service } = serviceOver([]);
  await primeJobOpen(service, { request: GERMAN, message: GERMAN });
  assert.equal(requestedFeatures(GERMAN).length, 0);
  assert.equal(decideSceneRequest({ request: GERMAN }), "arranged-layers");
});

test("the whole job-open batch is one request to the decision model", async () => {
  const jev = jevReadingGerman();
  await primeJobOpen(serviceOver([jev.model]).service, { request: GERMAN, message: GERMAN });
  assert.equal(jev.calls.length, 1);
  const ids = jev.calls[0]?.questions.map((question) => question.id) ?? [];
  for (const id of ["request-parts", "drawn-scene", "request-scale", "evidence-temporal", "evidence-visual", "evidence-judgement", "layer-style-request", "visual-waiver", "named-object:PLAN_CARD"]) assert.ok(ids.includes(id), id);
});

test("a feature named in another language is asked once the model has read the request", async () => {
  await primeJobOpen(serviceOver([jevReadingGerman().model]).service, { request: GERMAN, message: GERMAN });
  assert.deepEqual(requestedFeatures(GERMAN).map((feature) => feature.id), ["glow"]);
  assert.equal(decideFeatureAsk({ goal: GERMAN, feature: "blur" }), "not-asked");
});

test("the scene, the scale, the evidence kinds and the layer-style reading follow the model", async () => {
  await primeJobOpen(serviceOver([jevReadingGerman().model]).service, { request: GERMAN, message: GERMAN });
  assert.equal(decideSceneRequest({ request: GERMAN }), "drawn-scene");
  assert.equal(requestScale(GERMAN), "small");
  assert.deepEqual(requiredEvidenceKindsForGoal(GERMAN), ["visual"]);
  assert.equal(goalAsksForJudgement(GERMAN), true);
  assert.equal(decideLayerStyleRequest({ message: GERMAN, workflowGoalSummary: GERMAN }), "does-not-name");
});

test("a name the request gives is asked about, and an After Effects match name is not put to the model", async () => {
  const jev = jevReadingGerman();
  const request = `${GERMAN} ADBE_Glo2 stays.`;
  await primeJobOpen(serviceOver([jev.model]).service, { request, message: request });
  assert.equal(decideNameAsk({ goal: request, name: "PLAN_CARD", index: 0 }), "asked");
  assert.ok(!(jev.calls[0]?.questions ?? []).some((question) => question.id.includes("ADBE_")));
});

test("a request that failed or timed out keeps every deterministic answer", async () => {
  for (const failure of ["timeout", "unavailable"] as const) {
    clearBook();
    const jev = scriptedModel(() => yesNo(true), failure);
    await primeJobOpen(serviceOver([jev.model]).service, { request: GERMAN, message: GERMAN });
    assert.equal(requestedFeatures(GERMAN).length, 0);
    assert.equal(decideSceneRequest({ request: GERMAN }), "arranged-layers");
  }
});

test("an unsure answer below the verify band is dropped", async () => {
  const unsure = scriptedModel(() => yesNo(true, 0.6));
  await primeJobOpen(serviceOver([unsure.model]).service, { request: "Make it pop", message: "Make it pop" });
  assert.equal(goalAsksForJudgement("Make it pop"), false);
});

test("the same request is not asked twice", async () => {
  const jev = jevReadingGerman();
  const { service } = serviceOver([jev.model]);
  await primeJobOpen(service, { request: GERMAN, message: GERMAN });
  await primeJobOpen(service, { request: GERMAN, message: GERMAN });
  assert.equal(jev.calls.length, 1);
});

test("every settled decision is logged with its tier and no request text", async () => {
  const { service, rows } = serviceOver([jevReadingGerman().model]);
  await primeJobOpen(service, { request: GERMAN, message: GERMAN });
  const scene = rows.find((row) => row.decision === "drawn-scene");
  assert.equal(scene?.tier, "decision-model");
  assert.equal(scene?.answer, "drawn-scene");
  assert.ok(rows.some((row) => row.decision === "named-object"));
  assert.ok(!JSON.stringify(rows).includes("Sternenhimmel"));
});
