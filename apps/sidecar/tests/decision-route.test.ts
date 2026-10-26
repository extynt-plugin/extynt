// The route decisions at the sidecar seams: the job-open batch carries them in the same request, the route sets a job's scale, a question is answered without a job and an edit never is, the tier picks between two configured models, the specialists decision withholds a role, and an amendment resumes the stopped job.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Question } from "@extynt/decide";
import { MockProvider } from "@extynt/llm";
import { bookBand, bookLabel, bookYesNo, clearBook } from "../src/decision-book.js";
import { primeJobOpen } from "../src/decision-prime.js";
import { primeContinuation } from "../src/decision-continuation.js";
import { specialistWithheld } from "../src/decision-specialists.js";
import { answersOnly } from "../src/server-chat-answer-only.js";
import { tierOrder } from "../src/server-chat-tier.js";
import { requestScale } from "../src/server-workflow-checklist-model.js";
import { isWorkflowAmendment, isWorkflowContinuationRequest } from "../src/server-workflow-continuation-ownership.js";
import { applying, picked, scriptedModel, serviceOver, yesNo } from "./decision-fakes.js";
import { authorization, sidecarFor, token, validSnapshot } from "./sidecar-fixture.js";

beforeEach(() => clearBook());

const QUESTION = "How does a wiggle expression work in After Effects?";
const EDIT = "Add a soft glow to the title and fade it in.";
const NEW_IDS = ["request-route", "request-specialists", "model-tier"];

const labelsOf = (question: Question): string[] => ("labels" in question ? question.labels.map((entry) => entry.label) : []);

function reading(route: string | (() => string), confidence = 0.95, tier = "strong") {
  return scriptedModel((question: Question) => {
    if (question.id === "request-route") return picked(typeof route === "string" ? route : route(), confidence);
    if (question.id === "model-tier") return picked(tier);
    if (question.id === "request-specialists") return applying(new Set(["planner"]), labelsOf(question));
    if (question.kind === "binary") return yesNo(false);
    if (question.kind === "labels") return applying(new Set(), labelsOf(question));
    return picked(labelsOf(question)[0] ?? "none");
  });
}

function turnOf(message: string, extra: { readonly history?: { role: "user" | "assistant"; content: string }[] } = {}) {
  return { message, history: extra.history ?? [] };
}

test("the route, specialists and tier ride the one job-open request", async () => {
  const jev = reading("single-agent");
  await primeJobOpen(serviceOver([jev.model]).service, { request: EDIT, message: EDIT });
  assert.equal(jev.calls.length, 1);
  const ids = jev.calls[0]?.questions.map((question) => question.id) ?? [];
  for (const id of NEW_IDS) assert.ok(ids.includes(id), id);
});

test("a booked route sets the job scale: specialists make it long, one agent makes it small", async () => {
  const long = "Rebuild the whole intro with a title, a logo reveal and a lower third.";
  await primeJobOpen(serviceOver([reading("specialist-workflow").model]).service, { request: long, message: long });
  assert.equal(requestScale(long), "long");
  await primeJobOpen(serviceOver([reading("single-agent").model]).service, { request: EDIT, message: EDIT });
  assert.equal(requestScale(EDIT), "small");
});

test("a question routes to answer-only, an edit never does, and an unsure answer falls back", async () => {
  const sidecar = sidecarFor({ port: 0, token, chatProvider: new MockProvider(), decisionModels: () => [reading("answer-only").model], quietAgentLog: true });
  assert.equal(await answersOnly(sidecar, turnOf(QUESTION)), true);
  const editing = sidecarFor({ port: 0, token, chatProvider: new MockProvider(), decisionModels: () => [reading("single-agent").model], quietAgentLog: true });
  assert.equal(await answersOnly(editing, turnOf(EDIT)), false);
  clearBook();
  const unsure = sidecarFor({ port: 0, token, chatProvider: new MockProvider(), decisionModels: () => [reading("answer-only", 0.6).model], quietAgentLog: true });
  assert.equal(await answersOnly(unsure, turnOf(QUESTION)), false);
});

test("an answer-only route is never taken with no model, for a reply to the assistant's question, a pending job or a picture", async () => {
  const none = sidecarFor({ port: 0, token, chatProvider: new MockProvider(), quietAgentLog: true });
  assert.equal(await answersOnly(none, turnOf(QUESTION)), false);
  const sidecar = sidecarFor({ port: 0, token, chatProvider: new MockProvider(), decisionModels: () => [reading("answer-only").model], quietAgentLog: true });
  assert.equal(await answersOnly(sidecar, turnOf(QUESTION, { history: [{ role: "assistant", content: "Shall I add it?" }] })), false);
  assert.equal(await answersOnly(sidecar, { ...turnOf(QUESTION), continueJobId: "job-1" }), false);
  assert.equal(await answersOnly(sidecar, { ...turnOf(QUESTION), images: [{ mediaType: "image/png", base64: "AA==" }] }), false);
});

test("a question is answered without opening a job, and the next message asking for an edit routes normally", async (t) => {
  const route = reading(() => (currentMessage.value === QUESTION ? "answer-only" : "single-agent"));
  const provider = new MockProvider({ answer: "A wiggle expression moves a property randomly." });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, decisionModels: () => [route.model], quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const post = async (requestId: string, message: string): Promise<number> => (await fetch(`http://${address.host}:${address.port}/v1/chat`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ requestId, message }) })).status;
  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(validSnapshot) });
  currentMessage.value = QUESTION;
  assert.equal(await post("ask-1", QUESTION), 200);
  assert.deepEqual(Object.keys(sidecar.workflowCoordinator.workflowStore.getState().jobs), [], "an answered question opens no job");
  currentMessage.value = EDIT;
  assert.equal(await post("edit-1", EDIT), 200);
  assert.equal(Object.keys(sidecar.workflowCoordinator.workflowStore.getState().jobs).length, 1, "the edit opened its job");
});

const currentMessage = { value: "" };

test("with two different models configured a fast-tier request runs on the fallback; with one it is a no-op", async () => {
  const strong = new MockProvider({ model: "strong-model" });
  const light = new MockProvider({ model: "light-model" });
  const fastReading = reading("single-agent", 0.95, "fast");
  const { service } = serviceOver([fastReading.model]);
  const swapped = await tierOrder({ decisions: service }, { primary: strong, fallback: light }, EDIT);
  assert.equal(swapped.primary, light);
  assert.equal(swapped.fallback, strong);
  clearBook();
  const same = await tierOrder({ decisions: service }, { primary: strong, fallback: new MockProvider({ model: "strong-model" }) }, EDIT);
  assert.equal(same.primary, strong);
  const alone = await tierOrder({ decisions: service }, { primary: strong, fallback: undefined }, EDIT);
  assert.equal(alone.primary, strong);
  clearBook();
  const strongReading = serviceOver([reading("single-agent", 0.95, "strong").model]).service;
  const kept = await tierOrder({ decisions: strongReading }, { primary: strong, fallback: light }, EDIT);
  assert.equal(kept.primary, strong);
});

test("a role the models confidently left out is withheld; execution and unbooked goals never are", () => {
  const goal = "Make the title glow.";
  assert.equal(specialistWithheld(goal, "planner"), false);
  bookBand({ decision: "request-specialists", text: goal }, "act");
  bookYesNo({ decision: "request-specialists", text: goal, item: "planner" }, false);
  bookYesNo({ decision: "request-specialists", text: goal, item: "execution" }, false);
  bookYesNo({ decision: "request-specialists", text: goal, item: "reviewer" }, true);
  assert.equal(specialistWithheld(goal, "planner"), true);
  assert.equal(specialistWithheld(goal, "execution"), false);
  assert.equal(specialistWithheld(goal, "reviewer"), false);
});

test("a message that amends a stopped job counts as a continuation and as an amendment", async () => {
  const message = "mach weiter, aber nimm die Schrift Arial";
  assert.equal(isWorkflowContinuationRequest(message), false);
  const jev = scriptedModel(() => picked("amend-and-resume"));
  await primeContinuation(serviceOver([jev.model]).service, message);
  assert.equal(isWorkflowContinuationRequest(message), true);
  assert.equal(isWorkflowAmendment(message), true);
  bookLabel({ decision: "continuation", text: "weiter" }, "resume");
  assert.equal(isWorkflowContinuationRequest("weiter"), true);
  assert.equal(isWorkflowAmendment("weiter"), false);
});
