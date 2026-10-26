/** A turn whose scene the visual-scene designer built reports the plans it applied and ends on a reply that names them. */
import assert from "node:assert/strict";
import test from "node:test";
import { MockProvider, type AgentStepInput, type AgentStepResult } from "@extynt/llm";
import { initialCycleState, mergeAgentResult, reduceCycle } from "../src/server-workflow-cycle-state.js";
import { chatTurn, DESIGN_SVG } from "./sidecar-fixture.js";
import { noteDesignerSeals, takeDesignerCards } from "../src/server-workflow-designer-cards.js";
import { appliedWords } from "../src/agent-plan-words.js";
import { plainReply } from "../src/agent-reply-plain.js";
import type { AgentPlanCard } from "../src/agent-types.js";
import { rigWith, step } from "./single-loop-rig.js";

function silentOwner(input: AgentStepInput): AgentStepResult {
  const done = input.messages.filter((message) => message.role === "tool").length;
  if (done === 0) return step("launch", "ae_consult_specialist", { action: "launch", role: "visual-scene", instruction: "Draw the planet and its ring in Main (comp-1), 1920x1080, 10 s." });
  if (done === 1) return step("wait", "ae_consult_specialist", { action: "wait", role: "visual-scene" });
  return { text: "The planet and its ring are built.", toolCalls: [] };
}

function designerScript(input: AgentStepInput): AgentStepResult {
  const done = input.messages.filter((message) => message.role === "tool").length;
  if (done === 0) return step("build", "ae_build_drawing", { svg: DESIGN_SVG });
  return { text: "Built the scene.", toolCalls: [] };
}

test("a turn the designer built reports its plans and ends on a reply naming them", async (t) => {
  const designer = new MockProvider({ script: designerScript });
  const rig = await rigWith(t, silentOwner, "designer-reply", [["create_layer"]], { workflowSpecialistProviders: { "visual-scene": designer } });
  rig.bindCreated = true;
  const turn = await chatTurn(rig.address, "Draw a planet with a ring", [], { autoApply: true });
  assert.equal(turn.outcome, "planned", JSON.stringify(turn));
  assert.equal(turn.plans.length, 1, "the designer's sealed plan is the turn's plan");
  assert.match(turn.plans[0]?.title ?? "", /Build the designed scene/);
});

test("cards the designer sealed give a silent turn a reply that names them", () => {
  const card = { planId: "plan-1", title: "Build the designed scene: Planet.", operations: [], warnings: [], expressions: [], requiresAcknowledgement: false, autoApply: true };
  const aggregate = { outcome: "answered" as const, notes: [], answer: "", plans: [], tools: [], reasoning: [], steps: 1, steering: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0 } };
  const state = initialCycleState({ used: new MockProvider({ answer: "x" }), jobId: null, continuation: null, orchestration: undefined, feedback: undefined });
  const added = reduceCycle({ ...state, aggregate }, { kind: "cards-added", cards: [card] });
  assert.deepEqual(added.aggregate?.plans.map((entry) => entry.planId), ["plan-1"]);
  assert.equal(added.aggregate?.answer, "Applied: Build the designed scene: Planet.");
  const spoken = reduceCycle({ ...state, aggregate: { ...aggregate, answer: "Done." } }, { kind: "cards-added", cards: [card] });
  assert.equal(spoken.aggregate?.answer, "Done.", "the model's own reply stands");
});

const planCardOf = (planId: string, title: string, operations: string[] = ["create_layer"]): AgentPlanCard => ({ planId, title, operations, warnings: [], expressions: [], requiresAcknowledgement: false, autoApply: true });

test("a later run of the job still reports the plans an earlier run's turn ended before", () => {
  const state = {};
  const sealed = (planId: string) => ({ ok: true as const, data: { queued: true, planId, summary: `Plan ${planId}` }, sealedCard: { planId, summary: `Plan ${planId}` } });
  noteDesignerSeals(state, { jobId: "job-1", queued: sealed("plan-1"), autoApply: true });
  assert.deepEqual(takeDesignerCards(state, "job-1").map((card) => card.planId), ["plan-1"]);
  noteDesignerSeals(state, { jobId: "job-1", queued: sealed("plan-2"), autoApply: true });
  assert.deepEqual(takeDesignerCards(state, "job-1").map((card) => card.planId), ["plan-1", "plan-2"], "the first plan is not lost to the first run");
  assert.deepEqual(takeDesignerCards(state, "job-2"), []);
});

test("the reply for applied plans never uses an operation's own name as a title", () => {
  assert.equal(appliedWords([planCardOf("a", "Queued ensure effect")]), "Applied: Made 1 change.");
  assert.equal(appliedWords([planCardOf("a", "ensure_effect", ["ensure_effect", "set_effect_control"])]), "Applied: Made 2 changes.");
  assert.equal(appliedWords([planCardOf("a", "Blur the title.")]), "Applied: Blur the title.");
  assert.equal(appliedWords(Array.from({ length: 22 }, (_, index) => planCardOf(`p${index}`, "Fade"))), "Applied 22 plans: Fade (22 times).");
  const named = ["Trim A", "Trim B", "Trim C", "Trim D"].map((title, index) => planCardOf(`n${index}`, title));
  assert.equal(appliedWords(named), "Applied 4 plans: Trim A; Trim B; Trim C; Trim D.");
});

test("a plan whose every row already held its value is not reported as applied", () => {
  const same = { ...planCardOf("same", "Trim the clip"), rows: [{ label: "Out point", target: "Clip", before: "5", after: "5" }] };
  const real = { ...planCardOf("real", "Fade the clip"), rows: [{ label: "Opacity", target: "Clip", before: "100", after: "0" }] };
  assert.equal(appliedWords([same, real, same]), "Applied: Fade the clip.");
  assert.equal(appliedWords([same]), "Nothing needed changing: everything was already as asked.");
});

test("a sentence naming an internal component is dropped from a reply", () => {
  const plain = plainReply("Built the title and the subtitle. The sidecar's own review is the remaining step.\nAll five layers are in place.");
  assert.equal(plain, "Built the title and the subtitle.\nAll five layers are in place.");
  const legit = "Renamed the layer to Validator. Check the review step in your own words.";
  assert.equal(plainReply(legit), legit, "words a user may legitimately use are kept");
});

test("internal tool and operation names do not reach a reply", () => {
  const reply = "| Step | Result |\n| --- | --- |\n| `ensure_effect` | added to __new__:Title |\n| ae_queue_add | sealed |";
  const plain = plainReply(reply);
  assert.doesNotMatch(plain, /ensure_effect|__new__|ae_queue_add/);
  assert.match(plain, /\| ensure effect \| added to Title \|/);
  assert.equal(plainReply("Renamed my_layer to Hero."), "Renamed my_layer to Hero.", "a name that is not ours is left alone");
});

test("a layer called create_bg is not rewritten, and fenced code comes through verbatim", () => {
  assert.equal(plainReply("Added the layer create_bg and add_glow."), "Added the layer create_bg and add_glow.");
  const fenced = "Use this:\n```\nae_status; set_value(1); ensure_effect\n```\nafter ae_status.";
  assert.equal(plainReply(fenced), "Use this:\n```\nae_status; set_value(1); ensure_effect\n```\nafter a step.");
});

const blankRun = { outcome: "answered" as const, notes: [], answer: "", plans: [], tools: [], reasoning: [], steps: 1, steering: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0 } };

test("the reply of a run names every plan applied across its cycles, not only the last cycle's", () => {
  const first = { ...blankRun, plans: [planCardOf("a", "Build the logo"), planCardOf("b", "Animate the logo in")], answer: appliedWords([planCardOf("a", "Build the logo"), planCardOf("b", "Animate the logo in")]) };
  const second = { ...blankRun, plans: [planCardOf("c", "Group the logo on a null"), planCardOf("d", "Size the logo to fit")], answer: "Applied: Group the logo on a null; Size the logo to fit." };
  const merged = mergeAgentResult(mergeAgentResult(undefined, first), second);
  assert.equal(merged.answer, "Applied 4 plans: Build the logo; Animate the logo in; Group the logo on a null; Size the logo to fit.");
  const prose = mergeAgentResult(mergeAgentResult(undefined, first), { ...second, answer: "The logo is built and animated." });
  assert.equal(prose.answer, "The logo is built and animated.", "the model's own reply stands");
  const quiet = mergeAgentResult(mergeAgentResult(undefined, first), { ...second, answer: "" });
  assert.equal(quiet.answer, "Applied 4 plans: Build the logo; Animate the logo in; Group the logo on a null; Size the logo to fit.", "a cycle that said nothing keeps the summary current");
});

test("a long run names every plan instead of counting the rest", () => {
  const plans = Array.from({ length: 12 }, (_, index) => planCardOf(`p${index}`, `Step ${index}`));
  assert.equal(appliedWords(plans), `Applied 12 plans: ${plans.map((plan) => plan.title).join("; ")}.`);
});

test("a reply never uses the checklist's own words for a part of the job", () => {
  assert.equal(plainReply("Both build items are done and verified."), "Both parts are done and verified.");
  assert.equal(plainReply("The build item and one review item are closed."), "The part and one check are closed.");
});
