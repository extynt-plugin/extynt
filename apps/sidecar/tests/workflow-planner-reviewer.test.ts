/** The planner (long jobs, once), the reviewer (long jobs, at review items) and the expression specialist (any job), and what each costs. */
import { decodeOrThrow, type JsonObject as LogLine, jsonObject, type JsonValue } from "@extynt/decode";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MockProvider, type AgentStepInput, type AgentStepResult } from "@extynt/llm";
import type { CompositionSnapshot, LayerSnapshot, PropertySnapshot } from "@extynt/project-graph";
import type { WorkflowId } from "@extynt/workflow";
import { fieldOf, numberOf, parseJson, textOf, type JsonObject } from "./http-json.js";
import { post, rigWith, step } from "./single-loop-rig.js";
import { MAX_FIX_ROUNDS, checklistGate, recordReview } from "../src/server-workflow-checklist-completion.js";
import { coveredBatches, dueReviews } from "../src/server-workflow-checklist-model.js";
import { NEXT_SLICE_CHARS, checklistProgress, checklistStatusLine, itemStates, parseChecklists, recordSeal, noteQueueLabel, serializeChecklists, setChecklist, type Checklist, type ChecklistView } from "../src/server-workflow-checklist.js";
import type { SidecarActionHost, SidecarActionLedger } from "../src/server-workflow-sidecar-actions.js";
import { logSpecialistSummary, oneShotSpecialist, type CallHost } from "../src/server-workflow-specialist-calls.js";
import { DESIGN_ROLES, delegationMode, WORKFLOW_SPECIALIST_ROLES } from "../src/workflow-orchestration.js";
import { EXPRESSION_LAYOUT_CHARS, expressionLayout, parseExpressionOutput, parsePlannerOutput, parseReviewerOutput } from "../src/workflow-specialist-outputs.js";
import { present } from "./agent-test-support.js";

const JOB: WorkflowId = "job-1";
const host = (): SidecarActionHost => ({ workflowSidecarActions: new Map<WorkflowId, SidecarActionLedger>(), options: { workflowFreeRun: true } });
type Batch = ChecklistView["batches"][string];
const verified: Batch = { lifecycle: "settled", execution: { mutation: "applied" }, verification: { state: "verified" }, recovery: { state: "none" } };
const view = (batches: Record<string, Batch>): ChecklistView => ({ batches });
const build = (id: string, spec = `spec of ${id}`) => ({ id, title: `Item ${id}`, spec, kind: "build" });
const review = (id: string, covers: string[]) => ({ id, title: `Review ${id}`, spec: "", kind: "review", covers });

function planned(items: JsonValue): { h: SidecarActionHost; checklist: Checklist } {
  const h = host();
  assert.equal(setChecklist(h, JOB, { raw: items, planned: true }).ok, true);
  return { h, checklist: present(present(h.workflowSidecarActions.get(JOB)).checklist) };
}
function seal(h: SidecarActionHost, item: string, batchId: string): void {
  noteQueueLabel(h, JOB, { stage: item });
  recordSeal(h, JOB, { batchId });
}

test("planner output: a plan with specs and reviews parses; duplicate ids and too many items are refused; covers slips are cleaned", () => {
  const good = parsePlannerOutput(`\`\`\`json\n${JSON.stringify({ items: [build("bar-01", "Bar one, #22d3ee, 0.5s ease"), build("bar-02"), review("rev-1", ["bar-01", "bar-02"])] })}\n\`\`\``);
  assert.equal(good.ok && good.items.length, 3);
  assert.equal(good.ok && present(good.items[0]).spec, "Bar one, #22d3ee, 0.5s ease", "the brief's own values are kept");
  assert.equal(good.ok && present(good.items[2]).kind, "review");
  assert.equal(parsePlannerOutput("no json here").ok, false);
  const twice = parsePlannerOutput(JSON.stringify({ items: [build("a"), build("a")] }));
  assert.match(twice.ok ? "" : twice.error, /twice/);
  const many = Array.from({ length: 121 }, (_, index) => build(`b-${index}`));
  assert.equal(parsePlannerOutput(JSON.stringify({ items: many })).ok, false, "more than 120 items");
  const ids = (text: string): string[] => { const plan = parsePlannerOutput(text); return plan.ok ? plan.items.map((item) => item.id) : []; };
  assert.deepEqual(ids(JSON.stringify({ items: [build("a"), review("r", ["ghost"])] })), ["a"], "a review covering only unknown ids is dropped");
  assert.deepEqual(ids(JSON.stringify({ items: [build("a"), review("r", [])] })), ["a"], "a review covering nothing is dropped");
  const mixed = parsePlannerOutput(JSON.stringify({ items: [build("a"), build("b"), review("r", ["a", "ghost"]), review("r2", ["r"])] }));
  assert.deepEqual(mixed.ok && mixed.items.map((item) => [item.id, item.covers ?? []]), [["a", []], ["b", []], ["r", ["a"]]], "a review keeps only the build ids it names");
  const stray = parsePlannerOutput(JSON.stringify({ items: [{ ...build("setup-comp"), covers: ["x"] }, build("b")] }));
  assert.equal(stray.ok && present(stray.items[0]).covers, undefined, "a build item's covers are dropped, the plan is kept");
  const crowded = parsePlannerOutput(JSON.stringify({ items: [...Array.from({ length: 6 }, (_, index) => build(`b-${index}`)), review("r1", ["b-0"]), review("r2", ["b-1"]), review("r3", ["b-2"])] }));
  assert.equal(crowded.ok && crowded.droppedReviews, 2, "no more than one review per 5 build items");
});

test("a planned list keeps spec, kind and covers through the saved checklist; the model's own list never gains them", () => {
  const { h, checklist } = planned([build("a", "x".repeat(2_000)), build("b"), review("r", ["a", "b"])]);
  assert.equal(present(present(checklist.items[0]).spec).length, 1_200, "a spec is bounded");
  assert.deepEqual(present(checklist.items[2]).covers, ["a", "b"]);
  const back = parseChecklists(parseJson(JSON.stringify(serializeChecklists(h.workflowSidecarActions))));
  assert.deepEqual(present(back.get(JOB)).items, checklist.items, "persisted with the checklist");
  const own = host();
  setChecklist(own, JOB, { raw: [{ id: "a", title: "A", spec: "sneaky", kind: "review", covers: ["a"] }] });
  assert.deepEqual(present(present(own.workflowSidecarActions.get(JOB)).checklist).items, [{ id: "a", title: "A", spec: "sneaky" }], "the model's list may carry a spec but never a kind or covers");
});

test("spec slices ride the progress line: the next open items, never a review, within the cap, beside the status line", () => {
  const items = [...Array.from({ length: 40 }, (_, index) => build(`bar-${String(index + 1).padStart(2, "0")}`, `Bar ${index + 1}: ${"colour #22d3ee, ease in 0.4s, ".repeat(40)}`)), review("rev-1", ["bar-01"])];
  const { h } = planned(items);
  seal(h, "bar-01", "b1");
  const line = present(checklistProgress(h, JOB, view({ b1: verified })));
  assert.ok(line.length <= NEXT_SLICE_CHARS, `${line.length} chars`);
  assert.match(line, /^This cycle: bar-02 — Bar 2: colour #22d3ee/);
  assert.match(line, /Checklist 1\/41 done; open: /);
  assert.doesNotMatch(line.slice(0, line.indexOf("Checklist")), /bar-01 —|rev-1/, "a done item and a review are not slices");
  const plain = host();
  setChecklist(plain, JOB, { raw: [{ id: "a", title: "A" }] });
  assert.equal(checklistProgress(plain, JOB, view({})), checklistStatusLine(plain, JOB, view({})), "a list without specs gets the status line alone");
});

test("review due logic: due once every covered item is done or unbuilt, again only after new covered work, or when completion asks again", () => {
  const { h, checklist } = planned([build("a"), build("b"), review("r", ["a", "b"])]);
  const due = (batches: Record<string, Batch>) => dueReviews(checklist, view(batches)).map((item) => item.id);
  seal(h, "a", "b1");
  assert.deepEqual(due({ b1: verified }), [], "b is still open");
  seal(h, "b", "b2");
  assert.deepEqual(due({ b1: verified, b2: verified }), ["r"]);
  assert.match(present(checklistStatusLine(h, JOB, view({ b1: verified, b2: verified }))), /r \(review pending\)/);
  const two = view({ b1: verified, b2: verified });
  assert.deepEqual(recordReview(h, JOB, two, { itemId: "r", kind: "fix", problems: "a: wrong colour" }), { closed: false });
  assert.deepEqual(due({ b1: verified, b2: verified }), [], "a fix verdict waits for new covered work");
  seal(h, "a", "b3");
  assert.deepEqual(due({ b1: verified, b2: verified, b3: verified }), ["r"], "a new verified batch on a covered item");
  assert.deepEqual(coveredBatches(checklist, view({ b1: verified, b2: verified, b3: verified }), ["a"]), ["b1", "b3"]);
  const gate = checklistGate(h, JOB, two, [{ id: "r", reason: "the model tries to close it" }]);
  assert.equal(gate.code, "CHECKLIST_INCOMPLETE");
  assert.match(gate.code ? gate.message : "", /r \(review pending\)[^]*closed only by the sidecar's reviewer[^]*not closable as unbuilt: r/);
  assert.deepEqual(due({ b1: verified, b2: verified }), ["r"], "asked again");
  assert.equal(present(itemStates(checklist, two).find((state) => state.id === "r")).status, "open", "the model cannot close a review");
});

test("review outcomes: pass is done, skipped is done, the second fix verdict closes it as unbuilt and completion reports it", () => {
  assert.equal(MAX_FIX_ROUNDS, 2);
  const { h, checklist } = planned([build("a"), review("r1", ["a"]), review("r2", ["a"]), review("r3", ["a"])]);
  seal(h, "a", "b1");
  const done = view({ b1: verified });
  recordReview(h, JOB, done, { itemId: "r1", kind: "pass" });
  recordReview(h, JOB, done, { itemId: "r2", kind: "skipped", reason: "capture failed" });
  assert.equal(recordReview(h, JOB, done, { itemId: "r3", kind: "fix", problems: "a: first problem" }).closed, false);
  assert.equal(recordReview(h, JOB, done, { itemId: "r3", kind: "fix", problems: "a: wrong colour; a: text missing" }).closed, true);
  assert.deepEqual(itemStates(checklist, done).map((state) => state.status), ["done", "done", "done", "unbuilt"]);
  const gate = checklistGate(h, JOB, done, undefined);
  assert.equal(gate.code, undefined, "nothing is left open");
  assert.deepEqual(gate.code ? [] : gate.unbuilt.map((item) => [item.id, item.reason]), [["r3", "review: a: wrong colour; a: text missing"]]);
  assert.equal(present(present(checklist.reviews).r2).note, "capture failed");
});

test("delegation mode is the three design roles', whatever other roles exist", () => {
  assert.deepEqual([...DESIGN_ROLES], ["visual-scene", "motion", "execution"]);
  assert.deepEqual(WORKFLOW_SPECIALIST_ROLES, [...DESIGN_ROLES, "planner", "reviewer", "expression"]);
  assert.equal(delegationMode(3), "delegated");
  assert.equal(delegationMode(2), "partial");
  assert.equal(delegationMode(0), "single-agent-fallback");
});

test("reviewer output: pass, or fix with usable fixes for covered items; anything else is not a verdict", () => {
  assert.deepEqual(parseReviewerOutput('{"verdict":"pass"}', ["a"]), { ok: true, verdict: "pass", fixes: [] });
  const fix = parseReviewerOutput('{"verdict":"fix","fixes":[{"itemId":"A","problem":"bar is red","expected":"cyan"},{"itemId":"ghost","problem":"x","expected":"y"}]}', ["a", "b"]);
  assert.deepEqual(fix, { ok: true, verdict: "fix", fixes: [{ itemId: "a", problem: "bar is red", expected: "cyan" }] });
  assert.equal(parseReviewerOutput('{"verdict":"fix","fixes":[{"itemId":"ghost","problem":"x"}]}', ["a"]).ok, false);
  assert.equal(parseReviewerOutput("looks fine", ["a"]).ok, false);
});

test("expression output: rows need a layer, a property and an expression; the layout sent with the call is capped and real", () => {
  const parsed = parseExpressionOutput('{"expressions":[{"layer":"Title","property":"Opacity","expression":"linear(time, 0, 1, 0, 100)","note":"fade"},{"layer":"","property":"x","expression":"y"}]}');
  assert.deepEqual(parsed, { ok: true, expressions: [{ layer: "Title", property: "Opacity", expression: "linear(time, 0, 1, 0, 100)", note: "fade" }] });
  assert.equal(parseExpressionOutput("{}").ok, false);
  const marker: PropertySnapshot = { path: "ADBE Marker", matchName: "ADBE Marker", displayName: "Marker", kind: "property", valueType: "unknown", value: { markers: [{ time: 1.5, comment: "hit" }] }, canSetValue: false };
  const layers = Array.from({ length: 200 }, (_, index): LayerSnapshot => ({ id: `l${index}`, index: index + 1, name: `Layer number ${index + 1}`, type: "shape", enabled: true, shy: false, solo: false, locked: false, startTime: 0, inPoint: 0, outPoint: 30, stretch: 100, parentId: index > 0 ? "l0" : null, matteLayerId: null, matteType: "none", isSelected: false, sourceId: null, properties: index === 1 ? [marker] : [] }));
  const comp: CompositionSnapshot = { id: "c", name: "Main", duration: 30, frameRate: 24, width: 1920, height: 1080, pixelAspect: 1, workAreaStart: 0, workAreaDuration: 30, layers, markers: { count: 100, markers: Array.from({ length: 100 }, (_, index) => ({ time: index, comment: `beat ${index}` })) } };
  const layout = expressionLayout(comp);
  assert.ok(JSON.stringify(layout).length <= EXPRESSION_LAYOUT_CHARS, `${JSON.stringify(layout).length} chars`);
  assert.equal(layout.truncated, true);
  assert.deepEqual(layout.composition, { name: "Main", duration: 30, frameRate: 24 });
  assert.equal(present(layout.layers[1]).parent, "Layer number 1", "a parent is named, not numbered");
  const small = expressionLayout({ ...comp, layers: layers.slice(0, 3), markers: { count: 2, markers: [{ time: 1, comment: "hit" }, { time: 2, comment: "land" }] } });
  assert.equal(small.truncated, undefined);
  assert.deepEqual(small.compMarkers, [{ time: 1, comment: "hit" }, { time: 2, comment: "land" }]);
  assert.deepEqual(small.layerMarkers, { "Layer number 2": [{ time: 1.5, comment: "hit" }] });
});

test("a specialist call is logged start to finish: one call line, a specialist-logs row without the frames, and one summary per job", async () => {
  const stateDirectory = mkdtempSync(join(tmpdir(), "specialist-log-"));
  const h: CallHost = { workflowSidecarActions: new Map(), options: { workflowFreeRun: true, stateDirectory }, now: () => new Date("2026-10-15T10:00:00.000Z"), persistWorkflowHandoffs: () => undefined, specialistUsage: { add: () => undefined } };
  const provider = new MockProvider({ script: (): AgentStepResult => ({ text: '{"verdict":"fix","fixes":[{"itemId":"a","problem":"p","expected":"e"}]}', toolCalls: [], usage: { inputTokens: 900, outputTokens: 30 } }) });
  const lines: LogLine[] = [];
  const run = () => oneShotSpecialist({ host: h, provider, role: "reviewer", jobId: JOB, requestId: "req-1", user: "Covered items", images: [{ mediaType: "image/png", base64: "QUJD" }], log: (line) => lines.push(decodeOrThrow(jsonObject, line)), parse: (text) => { const parsed = parseReviewerOutput(text, ["a"]); return parsed.ok ? { ok: true, value: parsed } : parsed; }, caught: (value) => ({ count: value.fixes.length, detail: { verdict: value.verdict, fixes: value.fixes.length } }) });
  assert.equal((await run()).ok, true);
  assert.deepEqual(present(provider.stepInputs[0]).images, [{ mediaType: "image/png", base64: "QUJD" }], "the frames ride the step");
  assert.deepEqual(present(provider.stepInputs[0]).tools, []);
  assert.equal(lines.length, 1);
  assert.deepEqual({ ...lines[0], ms: 0 }, { event: "specialist.call", role: "reviewer", jobId: JOB, requestId: "req-1", outcome: "completed", ms: 0, inputTokens: 900, outputTokens: 30, verdict: "fix", fixes: 1 });
  const cut = new MockProvider({ script: () => { throw new Error('The compatible API stopped at its max_tokens limit (finish_reason "length") before the answer finished.'); } });
  const truncated = await oneShotSpecialist({ host: h, provider: cut, role: "planner", jobId: JOB, requestId: "req-2", user: "brief", log: (line) => lines.push(decodeOrThrow(jsonObject, line)), parse: () => ({ ok: false, error: "never" }), caught: () => ({ count: 0, detail: {} }) });
  assert.match(truncated.ok ? "" : truncated.error, /^planner output hit the token limit/);
  lines.pop();
  const failing = new MockProvider({ script: () => { throw new Error("provider down"); } });
  const failed = await oneShotSpecialist({ host: h, provider: failing, role: "planner", jobId: JOB, requestId: "req-1", user: "brief", log: (line) => lines.push(decodeOrThrow(jsonObject, line)), parse: () => ({ ok: false, error: "never" }), caught: () => ({ count: 0, detail: {} }) });
  assert.equal(failed.ok, false);
  assert.match(String(lines[1]?.reason), /provider down/);
  assert.match(String(lines[1]?.reason), /^(?!planner output hit)/, "an ordinary fault is not called a token limit");
  const rows = readFileSync(join(stateDirectory, "specialist-logs", `${JOB}.jsonl`), "utf8").trim().split("\n").map(parseJson);
  assert.deepEqual(rows.map((row) => [textOf(row, "role"), textOf(row, "outcome")]), [["reviewer", "completed"], ["planner", "failed"], ["planner", "failed"]]);
  assert.match(textOf(rows[0], "messages.0.content"), /\[1 frame\(s\) attached\]/);
  assert.doesNotMatch(JSON.stringify(rows), /QUJD/, "the frame bytes are never archived");
  assert.equal(numberOf(rows[0], "cost.inputTokens"), 900);
  logSpecialistSummary(h, JOB, (line) => lines.push(line));
  logSpecialistSummary(h, JOB, (line) => lines.push(line));
  const summaries = lines.filter((line) => line.event === "specialist.summary");
  assert.equal(summaries.length, 1, "one summary per job");
  const counts = ["roles.reviewer.calls", "roles.reviewer.inputTokens", "roles.reviewer.caught", "roles.planner.failed"].map((path) => numberOf(summaries[0], path));
  assert.deepEqual(counts, [1, 900, 1, 2]);
});


const TIMING = { type: "set_layer_timing", target: { compositionId: "comp-1", layerId: "layer-1" }, inPoint: 0, outPoint: 2 };
const LONG = (goal: string): string => `${goal}. ${"Keep every layer named and the timing exact, and leave the rest of the project alone. ".repeat(5)}`;
const TRIM = (stage?: string) => ({ ...(stage ? { stage } : {}), summary: "Trim", operations: [TIMING] });
type Act = { id: string; name: string; args?: JsonObject } | "end";
const call = (id: string, name: string, args: JsonObject = {}): Act => ({ id, name, args });
const PAD = "Keep every layer named and the timing exact, and leave the rest of the project alone.";
const planFor = (step: AgentStepInput): string => {
  const brief = step.messages.map((message) => typeof message.content === "string" ? message.content : "").find((content) => content.includes("untrusted data")) ?? "";
  const goal = brief.split("The user's request:\n")[1]?.split(". ")[0] ?? "";
  return JSON.stringify({ items: [{ id: "bar-01", title: "Title bar", spec: goal, kind: "build" }, { id: "bar-02", title: "Subtitle bar", spec: PAD, kind: "build" }, { id: "rev-1", title: "Review: bars", spec: "", kind: "review", covers: ["bar-01", "bar-02"] }] });
};
const text = (value: string, usage = { inputTokens: 500, outputTokens: 40 }): AgentStepResult => ({ text: value, toolCalls: [], usage });

function owner(actions: Act[]) {
  const users = new Set<string>(), read = new Map<string, string>();
  let index = 0;
  const note = (message: AgentStepInput["messages"][number]): void => {
    if (message.role === "user" && typeof message.content === "string") users.add(message.content);
    if (message.role === "tool") read.set(message.toolCallId, message.content);
  };
  const script = (input: AgentStepInput): AgentStepResult => {
    input.messages.forEach(note);
    const next = actions[index];
    index += 1;
    if (!next || next === "end") return { text: next ? "Pausing this cycle." : "Done.", toolCalls: [] };
    return step(next.id, next.name, next.args ?? {});
  };
  return { users, read, script };
}
const jobs = (rig: Awaited<ReturnType<typeof rigWith>>) => Object.values(rig.sidecar.workflowCoordinator.workflowStore.getState().jobs);
async function finished(rig: Awaited<ReturnType<typeof rigWith>>): Promise<void> {
  for (let attempt = 0; attempt < 600 && jobs(rig)[0]?.status === "active"; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
}
const checklistOfRig = (rig: Awaited<ReturnType<typeof rigWith>>) => present(present([...rig.sidecar.workflowSidecarActions.values()][0]).checklist);
const BUILD_AND_END: Act[] = [call("a1", "ae_queue_add", TRIM("bar-01")), call("f1", "ae_queue_finish"), call("a2", "ae_queue_add", TRIM("bar-02")), call("f2", "ae_queue_finish"), "end"];

test("long job: the planner writes the checklist before the owner runs, the review passes, and every call is measured", async (t) => {
  const planner = new MockProvider({ script: (step) => text(planFor(step), { inputTokens: 2_000, outputTokens: 300 }) });
  const reviewer = new MockProvider({ script: () => text('{"verdict":"pass","fixes":[]}', { inputTokens: 900, outputTokens: 10 }) });
  const { users, read, script } = owner([...BUILD_AND_END, call("done", "ae_workflow_complete")]);
  const rig = await rigWith(t, script, "plan-pass", [["set_layer_timing"], ["set_layer_timing"]], { workflowFreeRun: true, quietAgentLog: false, workflowSpecialistProviders: { planner, reviewer } });
  const lines: string[] = [];
  t.mock.method(process.stdout, "write", (chunk: string | Uint8Array): boolean => {
    if (String(chunk).includes('"specialist.')) lines.push(String(chunk));
    return true;
  });
  await post(rig.base, "/v1/chat", { requestId: "plan-pass-turn", message: LONG("build the title bar and the subtitle bar, in at 0s and out at 2s"), history: [], autoApply: true });
  await finished(rig);
  assert.equal(planner.calls, 1, "the planner runs once");
  assert.match(String(present(present(planner.stepInputs[0]).messages[0]).content), /build the title bar and the subtitle bar/, "it is given the whole brief");
  assert.deepEqual(present(planner.stepInputs[0]).tools, []);
  assert.ok([...users].some((message) => /This cycle: bar-01 — build the title bar and the subtitle bar, in at 0s and out at 2s; bar-02 — Keep every layer/.test(message)), "the first message carries the next items' specs");
  assert.doesNotMatch(read.get("a1") ?? "", /CHECKLIST_REQUIRED/, "a planned job is not asked to write the checklist");
  assert.equal(reviewer.calls, 1, "one review, after both covered items were built");
  assert.ok((present(reviewer.stepInputs[0]).images?.length ?? 0) >= 2, "two to four frames ride the call");
  assert.match(String(present(present(reviewer.stepInputs[0]).messages[0]).content), /bar-01 — Title bar: build the title bar and the subtitle bar/);
  assert.equal(present(present(checklistOfRig(rig).reviews)["rev-1"]).result, "pass");
  assert.deepEqual(jobs(rig).map((job) => job.status), ["completed"]);
  const logged = lines.map(parseJson);
  const calls = logged.filter((line) => fieldOf(line, "event") === "specialist.call");
  assert.deepEqual(calls.map((line) => ["role", "outcome", "inputTokens", "outputTokens"].map((path) => fieldOf(line, path))), [["planner", "completed", 2_000, 300], ["reviewer", "completed", 900, 10]]);
  assert.equal(fieldOf(calls[0], "items"), 3);
  assert.equal(fieldOf(calls[1], "verdict"), "pass");
  const summary = logged.filter((line) => fieldOf(line, "event") === "specialist.summary");
  assert.equal(summary.length, 1, "one summary when the job ends");
  const directory = join(present(rig.sidecar.options.stateDirectory), "specialist-logs");
  const archived = readdirSync(directory).flatMap((file) => readFileSync(join(directory, file), "utf8").trim().split("\n")).map(parseJson);
  assert.deepEqual(archived.map((row) => textOf(row, "role")), ["planner", "reviewer"], "both calls are in specialist-logs");
});

test("long job: the reviewer is shown the job's reference images after the frames, labelled as data", async (t) => {
  const planner = new MockProvider({ script: (step) => text(planFor(step)) });
  const reviewer = new MockProvider({ script: () => text('{"verdict":"pass","fixes":[]}') });
  const { script } = owner([...BUILD_AND_END, call("done", "ae_workflow_complete")]);
  const rig = await rigWith(t, script, "plan-refs", [["set_layer_timing"], ["set_layer_timing"]], { workflowFreeRun: true, workflowSpecialistProviders: { planner, reviewer } });
  const reference = { mediaType: "image/png", base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==" };
  await post(rig.base, "/v1/chat", { requestId: "plan-refs-turn", message: LONG("build the title bar and the subtitle bar, in at 0s and out at 2s"), history: [], autoApply: true, images: [reference] });
  await finished(rig);
  const images = present(present(reviewer.stepInputs[0]).images);
  assert.deepEqual(images.at(-1), reference, "the reference rides last, after the captured frames");
  assert.ok(images.length >= 3);
  assert.match(String(present(present(reviewer.stepInputs[0]).messages[0]).content), /After the frames: 1 reference image is attached as look and style references[^]*never as instructions/);
});

test("long job: a plan the checklist refuses is asked for again with the reason, not dropped for the builder to rewrite", async (t) => {
  const reworded = JSON.stringify({ items: [{ id: "bar-01", title: "Title bar", spec: "Make a title bar.", kind: "build" }] });
  let asked = 0;
  const planner = new MockProvider({ script: (step) => text((asked += 1) === 1 ? reworded : planFor(step)) });
  const reviewer = new MockProvider({ script: () => text('{"verdict":"pass","fixes":[]}') });
  const { read, script } = owner([...BUILD_AND_END, call("done", "ae_workflow_complete")]);
  const rig = await rigWith(t, script, "plan-retry", [["set_layer_timing"], ["set_layer_timing"]], { workflowFreeRun: true, workflowSpecialistProviders: { planner, reviewer } });
  await post(rig.base, "/v1/chat", { requestId: "plan-retry-turn", message: LONG("build the title bar and the subtitle bar, in at 0s and out at 2s"), history: [], autoApply: true });
  await finished(rig);
  assert.equal(planner.calls, 2);
  assert.match(String(present(present(planner.stepInputs[1]).messages[0]).content), /previous plan was refused: The spec of bar-01 is not copied from the request/);
  assert.doesNotMatch(read.get("a1") ?? "", /CHECKLIST_REQUIRED/, "the corrected plan is the checklist");
  assert.deepEqual(checklistOfRig(rig).items.map((item) => item.id), ["bar-01", "bar-02", "rev-1"]);
  assert.deepEqual(jobs(rig).map((job) => job.status), ["completed"]);
});

test("long job: a planner failure falls back to the checklist nudge and never blocks the job; it is not asked twice", async (t) => {
  const planner = new MockProvider({ script: () => text("sorry, no JSON today") });
  const { read, script } = owner([call("a0", "ae_queue_add", TRIM("bar-01")), call("list", "ae_workflow_checklist", { items: [{ id: "bar-01", title: "Title bar", spec: `build the title bar. ${PAD}` }] }), call("a1", "ae_queue_add", TRIM("bar-01")), call("f1", "ae_queue_finish"), call("done", "ae_workflow_complete")]);
  const rig = await rigWith(t, script, "plan-fail", [["set_layer_timing"]], { workflowFreeRun: true, workflowSpecialistProviders: { planner } });
  await post(rig.base, "/v1/chat", { requestId: "plan-fail-turn", message: LONG("build the title bar"), history: [], autoApply: true });
  await finished(rig);
  assert.match(read.get("a0") ?? "", /CHECKLIST_REQUIRED[^]*Write the checklist first/, "the nudge is the fallback");
  assert.equal(planner.calls, 2, "asked once more with the reason, then never again");
  assert.deepEqual(jobs(rig).map((job) => job.status), ["completed"]);
  const throwing = new MockProvider({ script: () => { throw new Error("provider exploded"); } });
  const second = owner([call("a0", "ae_queue_add", TRIM())]);
  const rigTwo = await rigWith(t, second.script, "plan-throw", [["set_layer_timing"]], { workflowFreeRun: true, workflowSpecialistProviders: { planner: throwing } });
  await post(rigTwo.base, "/v1/chat", { requestId: "plan-throw-turn", message: LONG("build the title bar"), history: [], autoApply: true });
  assert.match(second.read.get("a0") ?? "", /CHECKLIST_REQUIRED/, "a provider error falls back the same way");
});

test("review fix: the owner is told what to fix, the review runs again after new covered work, and a second fix verdict closes it as unbuilt", async (t) => {
  const planner = new MockProvider({ script: (step) => text(planFor(step)) });
  let verdicts = 0;
  const reviewer = new MockProvider({ script: () => { verdicts += 1; return text(JSON.stringify({ verdict: "fix", fixes: [{ itemId: "bar-02", problem: `subtitle is grey (round ${verdicts})`, expected: "white" }] })); } });
  const { users, script } = owner([...BUILD_AND_END, call("a3", "ae_queue_add", TRIM("bar-02")), call("f3", "ae_queue_finish"), "end", call("done", "ae_workflow_complete")]);
  const rig = await rigWith(t, script, "review-fix", [["set_layer_timing"], ["set_layer_timing"], ["set_layer_timing"]], { workflowFreeRun: true, workflowSpecialistProviders: { planner, reviewer } });
  await post(rig.base, "/v1/chat", { requestId: "review-fix-turn", message: LONG("build the title bar and the subtitle bar"), history: [], autoApply: true });
  await finished(rig);
  assert.ok([...users].some((message) => /reviewer looked at frames[^]*- bar-02: subtitle is grey \(round 1\) \(expected: white\)[^]*runs again after you seal a verified batch/.test(message)), "the fix list reaches the next message");
  assert.ok([...users].some((message) => /review rev-1: 1 problem\(s\) to fix/.test(message)), "and the sidecar-action ledger");
  assert.equal(reviewer.calls, 2, "it ran again only after new covered work, and not a third time");
  assert.match(checklistOfRig(rig).unbuilt["rev-1"] ?? "", /^review: bar-02: subtitle is grey \(round 2\)/);
  assert.deepEqual(jobs(rig).map((job) => job.status), ["completed"], "a closed review does not block completion");
});

test("review failure: a reviewer that errors closes the review as done with a 'review skipped' line, and the job goes on", async (t) => {
  const planner = new MockProvider({ script: (step) => text(planFor(step)) });
  const reviewer = new MockProvider({ script: () => { throw new Error("reviewer offline"); } });
  const { users, script } = owner([...BUILD_AND_END, call("done", "ae_workflow_complete")]);
  const rig = await rigWith(t, script, "review-skip", [["set_layer_timing"], ["set_layer_timing"]], { workflowFreeRun: true, workflowSpecialistProviders: { planner, reviewer } });
  await post(rig.base, "/v1/chat", { requestId: "review-skip-turn", message: LONG("build the title bar and the subtitle bar"), history: [], autoApply: true });
  await finished(rig);
  assert.ok([...users].some((message) => /review skipped: reviewer offline/.test(message)));
  assert.equal(present(present(checklistOfRig(rig).reviews)["rev-1"]).result, "skipped");
  assert.deepEqual(jobs(rig).map((job) => job.status), ["completed"]);
});

test("a small job never calls the planner or the reviewer", async (t) => {
  const planner = new MockProvider({ script: (step) => text(planFor(step)) }), reviewer = new MockProvider({ script: () => text('{"verdict":"pass"}') });
  const { script } = owner([call("a", "ae_queue_add", TRIM()), call("f", "ae_queue_finish"), call("done", "ae_workflow_complete")]);
  const rig = await rigWith(t, script, "small-job", [["set_layer_timing"]], { workflowFreeRun: true, workflowSpecialistProviders: { planner, reviewer } });
  await post(rig.base, "/v1/chat", { requestId: "small-job-turn", message: "trim the title to two seconds", history: [], autoApply: true });
  await finished(rig);
  assert.deepEqual([planner.calls, reviewer.calls], [0, 0]);
  assert.deepEqual(jobs(rig).map((job) => job.status), ["completed"]);
});

test("expression: the owner asks and gets expressions written against the real layout; planner and reviewer are not the owner's to launch", async (t) => {
  const expression = new MockProvider({ script: () => text('{"expressions":[{"layer":"Original","property":"Opacity","expression":"thisComp.layer(\\"Original\\").marker.key(\\"hit\\").time","note":"fade on hit"}]}') });
  const { read, script } = owner([call("expr", "ae_consult_specialist", { action: "launch", role: "expression", instruction: "Fade the title on the hit marker" }), call("planner", "ae_consult_specialist", { action: "launch", role: "planner", instruction: "plan" }), call("a", "ae_queue_add", TRIM()), call("f", "ae_queue_finish"), call("done", "ae_workflow_complete")]);
  const rig = await rigWith(t, script, "expression", [["set_layer_timing"]], { workflowFreeRun: true, workflowSpecialistProviders: { expression } });
  await post(rig.base, "/v1/chat", { requestId: "expression-turn", message: "trim the title to two seconds", history: [], autoApply: true });
  await finished(rig);
  const prompt = String(present(present(expression.stepInputs[0]).messages[0]).content);
  assert.match(prompt, /Fade the title on the hit marker/);
  assert.match(prompt, /"composition":\{"name":"Main","duration":10,"frameRate":24\}/);
  assert.match(prompt, /"name":"Original"/, "the real layers are sent");
  assert.match(read.get("expr") ?? "", /"expressions":\[\{"layer":"Original","property":"Opacity"/);
  assert.match(read.get("planner") ?? "", /INVALID_SPECIALIST_REQUEST[^]*run by the sidecar itself/);
  assert.deepEqual(jobs(rig).map((job) => job.status), ["completed"]);
});
