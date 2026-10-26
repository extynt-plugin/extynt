/** ADR 0044 rule 8 end to end: the checklist is asked for once, stage ids attribute batches, completion waits for every item. */
import assert from "node:assert/strict";
import test from "node:test";
import type { AgentStepInput } from "@extynt/llm";
import { readJson, type JsonObject } from "./http-json.js";
import { post, rigWith, step } from "./single-loop-rig.js";

const TIMING = { type: "set_layer_timing", target: { compositionId: "comp-1", layerId: "layer-1" }, inPoint: 0, outPoint: 2 };
const LONG = (goal: string): string => `${goal}. ${"Keep every layer named and the timing exact, and leave the rest of the project alone. ".repeat(5)}`;
const PAD = "Keep every layer named and the timing exact, and leave the rest of the project alone.";
const itemsFor = (goal: string) => [{ id: "bar-01", title: "Trim the title", spec: goal }, { id: "bar-02", title: "Trim the subtitle", spec: PAD }];

function answers(input: AgentStepInput): Map<string, string> {
  const found = new Map<string, string>();
  for (const message of input.messages) if (message.role === "tool") found.set(message.toolCallId, message.content);
  return found;
}

type Next = { id: string; name: string; args: JsonObject };
function sequence(actions: Next[]) {
  const read = new Map<string, string>();
  let index = 0;
  const script = (input: AgentStepInput) => {
    if (input.tools.length === 0) return { text: "no plan", toolCalls: [] };
    for (const [id, content] of answers(input)) read.set(id, content);
    const next = actions[index];
    index += 1;
    return next ? step(next.id, next.name, next.args) : { text: "Done.", toolCalls: [] };
  };
  return { read, script };
}
const call = (id: string, name: string, args: JsonObject = {}): Next => ({ id, name, args });
const TRIM = (stage?: string) => ({ ...(stage ? { stage } : {}), summary: "Trim", operations: [TIMING] });

const offered = new Map<string, string[]>();
function withTools(script: (input: AgentStepInput) => ReturnType<typeof step> | { text: string; toolCalls: never[] }) {
  return (input: AgentStepInput) => {
    const reply = script(input);
    for (const toolCall of reply.toolCalls) offered.set(toolCall.id, input.tools.map((tool) => tool.name));
    return reply;
  };
}

const said = (read: Map<string, string>, id: string): string => read.get(id) ?? "";

function assertFirstRun(read: Map<string, string>): void {
  assert.match(said(read, "add-0"), /CHECKLIST_REQUIRED/);
  assert.match(said(read, "add-0"), /Write the checklist first with ae_workflow_checklist/);
  assert.match(said(read, "list"), /"bar-01"/);
  assert.match(said(read, "finish-1"), /Checklist 1\/2 done; open: bar-02/, "the seal receipt carries the status line");
  assert.match(said(read, "complete-1"), /Only call this when every checklist item is built, or closed as unbuilt with a reason\. Keep building the checklist\./, "a completion call while the tool is withheld gets the short refusal");
  assert.doesNotMatch(said(read, "complete-1"), /CHECKLIST_INCOMPLETE/);
  assert.match(said(read, "close-2"), /no batch was attempted/, "unbuilt needs an attempt");
  assert.match(said(read, "finish-2"), /Checklist 2\/2 done/);
}

function assertOffered(): void {
  assert.equal(offered.get("complete-1")?.includes("ae_workflow_complete"), false, "withheld at 1 of 2");
  assert.equal(offered.get("complete-1")?.includes("ae_workflow_unbuilt"), true, "the unbuilt tool is always offered");
  assert.equal(offered.get("complete-3")?.includes("ae_workflow_complete"), true, "offered once the list is built");
}

test("checklist run: refused once before the list, attributes batches by stage, and completion waits for every item", async (t) => {
  const { read, script } = sequence([
    call("add-0", "ae_queue_add", TRIM("bar-01")), call("list", "ae_workflow_checklist", { items: itemsFor("trim the title and the subtitle to two seconds") }),
    call("add-1", "ae_queue_add", TRIM("bar-01")), call("finish-1", "ae_queue_finish"),
    call("complete-1", "ae_workflow_complete"), call("close-2", "ae_workflow_unbuilt", { items: [{ id: "bar-02", reason: "skipped" }] }),
    call("add-2", "ae_queue_add", TRIM("bar-02")), call("finish-2", "ae_queue_finish"),
    call("complete-3", "ae_workflow_complete"),
  ]);
  const rig = await rigWith(t, withTools(script), "checklist-run", [["set_layer_timing"], ["set_layer_timing"]], { workflowFreeRun: true });
  const reply = await readJson(await post(rig.base, "/v1/chat", { requestId: "checklist-run-turn", message: LONG("trim the title and the subtitle to two seconds"), history: [], autoApply: true }));
  const jobs = () => Object.values(rig.sidecar.workflowCoordinator.workflowStore.getState().jobs);
  for (let attempt = 0; attempt < 400 && jobs()[0]?.status === "active"; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  assertFirstRun(read);
  assertOffered();
  assert.deepEqual(jobs().map((job) => job.status), ["completed"], JSON.stringify(reply));
});

test("checklist run: the first queue call is refused only once, and a long job's completion without a list is CHECKLIST_MISSING, as feedback", async (t) => {
  const { read, script } = sequence([call("add-0", "ae_queue_add", TRIM()), call("add-1", "ae_queue_add", TRIM()), call("finish", "ae_queue_finish"), call("complete", "ae_workflow_complete")]);
  const rig = await rigWith(t, script, "checklist-once", [["set_layer_timing"]], { workflowFreeRun: true });
  await post(rig.base, "/v1/chat", { requestId: "checklist-once-turn", message: LONG("trim the title to two seconds"), history: [], autoApply: true });
  assert.match(read.get("add-0") ?? "", /CHECKLIST_REQUIRED/);
  assert.match(read.get("add-1") ?? "", /"queued"/, "the second call goes through without a checklist");
  for (let attempt = 0; attempt < 100 && !read.has("complete"); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.match(read.get("complete") ?? "", /CHECKLIST_MISSING/);
});

test("event log full: a seal the log could not record fails with EVENT_LOG_FULL, never 'sealed, queued to the panel'", async (t) => {
  const { read, script } = sequence([call("list", "ae_workflow_checklist", { items: itemsFor("trim the title to two seconds") }), call("add", "ae_queue_add", TRIM("bar-01")), call("finish", "ae_queue_finish")]);
  const rig = await rigWith(t, script, "event-log-full", [["set_layer_timing"]], { workflowFreeRun: true });
  Object.assign(rig.sidecar.workflowCoordinator, { admitPlan: () => ({ ok: false, code: "EVENT_LOG_FULL", message: "The bounded workflow event log is full." }) });
  await post(rig.base, "/v1/chat", { requestId: "event-log-full-turn", message: LONG("trim the title to two seconds"), history: [], autoApply: true });
  const finish = read.get("finish") ?? "";
  assert.match(finish, /EVENT_LOG_FULL/);
  assert.match(finish, /event log is full/);
  assert.doesNotMatch(finish, /queued to the panel/i);
});

test("small request: no checklist is asked for, and completion is not refused for a missing one", async (t) => {
  const { read, script } = sequence([call("add", "ae_queue_add", TRIM()), call("finish", "ae_queue_finish"), call("complete", "ae_workflow_complete")]);
  const rig = await rigWith(t, script, "checklist-small", [["set_layer_timing"]], { workflowFreeRun: true });
  const reply = await readJson(await post(rig.base, "/v1/chat", { requestId: "checklist-small-turn", message: "trim the title to two seconds", history: [], autoApply: true }));
  const jobs = () => Object.values(rig.sidecar.workflowCoordinator.workflowStore.getState().jobs);
  for (let attempt = 0; attempt < 400 && jobs()[0]?.status === "active"; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.doesNotMatch(read.get("add") ?? "", /CHECKLIST/);
  assert.doesNotMatch(read.get("finish") ?? "", /Checklist \d/, "no status line without a checklist");
  assert.doesNotMatch(read.get("complete") ?? "", /CHECKLIST/);
  assert.deepEqual(jobs().map((job) => job.status), ["completed"], JSON.stringify([reply, [...read]]));
});

const GOAL_TWO = "trim the title and the subtitle to two seconds";
const NUDGE = "Sidecar wake event: 1 of 2 checklist items are still open; the next is bar-02";
const wakesIn = (input: AgentStepInput): number => input.messages.filter((message) => message.role === "user" && message.content.includes(NUDGE)).length;

function proseModel(prose: number) {
  const seen = { maxWakes: 0, proseAnswers: 0, nudgedThenTool: false };
  const actions: Next[] = [call("list", "ae_workflow_checklist", { items: itemsFor(GOAL_TWO) }), call("add-1", "ae_queue_add", TRIM("bar-01")), call("finish-1", "ae_queue_finish")];
  const later: Next[] = [call("add-2", "ae_queue_add", TRIM("bar-02")), call("finish-2", "ae_queue_finish"), call("complete", "ae_workflow_complete")];
  let index = 0, lastWasProse = false;
  const script = (input: AgentStepInput) => {
    if (input.tools.length === 0) return { text: "no plan", toolCalls: [] };
    const wakes = wakesIn(input);
    seen.maxWakes = Math.max(seen.maxWakes, wakes);
    const scripted = actions[index];
    if (scripted) { index += 1; return step(scripted.id, scripted.name, scripted.args); }
    if (seen.proseAnswers < prose) { seen.proseAnswers += 1; lastWasProse = true; return { text: "Bar one is built.", toolCalls: [] }; }
    if (lastWasProse && wakes > 0) seen.nudgedThenTool = true;
    lastWasProse = false;
    const next = later[index - actions.length];
    index += 1;
    return next ? step(next.id, next.name, next.args) : { text: "Done.", toolCalls: [] };
  };
  return { seen, script };
}

test("checklist run: prose with items open is answered in the same cycle and the next tool call proceeds", async (t) => {
  const { seen, script } = proseModel(1);
  const rig = await rigWith(t, script, "prose-nudge", [["set_layer_timing"], ["set_layer_timing"]], { workflowFreeRun: true });
  await readJson(await post(rig.base, "/v1/chat", { requestId: "prose-nudge-turn", message: LONG(GOAL_TWO), history: [], autoApply: true }));
  const jobs = () => Object.values(rig.sidecar.workflowCoordinator.workflowStore.getState().jobs);
  for (let attempt = 0; attempt < 400 && jobs()[0]?.status === "active"; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(seen.proseAnswers, 1);
  assert.equal(seen.nudgedThenTool, true, "the model's next tool call came after the nudge, in the same conversation");
  assert.equal(seen.maxWakes, 1);
  assert.deepEqual(jobs().map((job) => job.status), ["completed"]);
});

test("checklist run: the third consecutive prose reply is not nudged and ends the cycle as before", async (t) => {
  const { seen, script } = proseModel(3);
  const rig = await rigWith(t, script, "prose-bounded", [["set_layer_timing"], ["set_layer_timing"]], { workflowFreeRun: true });
  await readJson(await post(rig.base, "/v1/chat", { requestId: "prose-bounded-turn", message: LONG(GOAL_TWO), history: [], autoApply: true }));
  assert.equal(seen.proseAnswers, 3);
  assert.equal(seen.maxWakes, 2, "two nudges in one cycle, never a third");
});
