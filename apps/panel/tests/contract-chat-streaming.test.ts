/** Panel contract: the working bar while a turn runs (its step line is the bar's), and the one Details disclosure under the answer. */
import assert from "node:assert/strict";
import test from "node:test";
import { bar, barButton, buttonsNamed, chatBodies, chatReply, chatResponder, element, firstAnswer, holdChat, noticeTexts, nth, openSheet, output, progressResponder, required, rowsOf, textsOf } from "./contract-helpers.js";
import { type JsonObject } from "@extynt/decode";
import { createPanelHarness } from "./contract.test.js";
import { fieldOf } from "./json-narrow.js";

const STEP = {
  label: "Reading the composition",
  step: 2,
  usage: { totalTokens: 3100, inputTokens: 3000, outputTokens: 100 },
  notes: ["narration text"],
  reasoning: "thinking",
};
const poll = (harness: ReturnType<typeof createPanelHarness>): number => harness.runIntervals((timer) => timer.ms === 900);
const detailsIn = (root: ReturnType<typeof output>) => root.all((node) => node.tagName === "DETAILS");

function runningTurn(progress: (requestId: string) => JsonObject | null = (requestId) => ({ requestId, ...STEP })) {
  const harness = createPanelHarness({ respond: firstAnswer(progressResponder(progress), holdChat) });
  harness.send("rework the intro");
  return harness;
}

test("the working bar says Thinking until the first progress report arrives, and there is no live line element", () => {
  const harness = runningTurn();
  assert.deepEqual([bar(harness).state, bar(harness).text], ["working", "Thinking…"]);
  assert.equal(harness.el("chat-live"), null);
  assert.equal(output(harness).all((node) => node.classList.has("typing")).length, 0, "the step is not a chat row");
});

test("the bar shows only the progress label; the step is its count, the reasoning is in the sheet's Now", () => {
  const harness = runningTurn();
  poll(harness);
  const node = element(harness, "status-bar");
  assert.equal(bar(harness).text, "Reading the composition");
  assert.deepEqual(textsOf(node, "bar-count"), ["step 2"]);
  assert.doesNotMatch(node.textContent, /narration text|thinking/, "neither the narration nor the reasoning is in the bar");
  const sheet = openSheet(harness);
  assert.doesNotMatch(sheet.textContent, /narration text/, "the model's notes are never the label");
  sheet.find((entry) => entry.classList.contains("now-row") && entry.getAttribute("role") === "button")?.click();
  assert.deepEqual(textsOf(element(harness, "sheet"), "now-detail"), ["thinking"]);
  assert.doesNotMatch(node.textContent, /backstop|authoring/i, "no internal footer text");
});

test("narration only shows as the detail when there is no reasoning, never as the label", () => {
  const harness = runningTurn((requestId) => ({ requestId, label: "Editing the layer", step: 1, notes: ["first note", "second note"] }));
  poll(harness);
  assert.equal(bar(harness).text, "Editing the layer");
  openSheet(harness)
    .find((entry) => entry.classList.contains("now-row") && entry.getAttribute("role") === "button")
    ?.click();
  assert.deepEqual(textsOf(element(harness, "sheet"), "now-detail"), ["second note"]);
});

test("each report repaints the one bar in place, creates no chat rows and no per-batch notices", () => {
  let step = 0;
  const harness = runningTurn((requestId) => {
    step += 1;
    return { requestId, label: "Batch step " + step, step, phase: "applying", notes: ["Applied batch " + step] };
  });
  poll(harness);
  poll(harness);
  poll(harness);
  assert.equal(element(harness, "status-bar").all((node) => node.classList.has("bar-text")).length, 1);
  assert.equal(bar(harness).text, "Batch step 3");
  assert.equal(rowsOf(harness, "assistant").length, 0);
  assert.deepEqual(noticeTexts(harness), []);
  assert.doesNotMatch(output(harness).textContent, /Applied batch/);
});

test("a progress report for some other request is ignored", () => {
  const harness = runningTurn(() => ({ requestId: "someone-else", ...STEP }));
  poll(harness);
  assert.equal(bar(harness).text, "Thinking…");
});

test("the progress poll runs every 900 ms for the running turn and stops when the answer lands", () => {
  const harness = runningTurn();
  assert.equal(harness.requestsTo("/v1/chat/progress").length, 0);
  poll(harness);
  const requestId = String(fieldOf(nth(chatBodies(harness), 0), "requestId"));
  assert.ok(nth(harness.requestsTo("/v1/chat/progress"), 0).url.endsWith("requestId=" + encodeURIComponent(requestId)));
  required(harness.held().find((xhr) => xhr.url.endsWith("/v1/chat"))).respond(200, chatReply({ requestId }).text ?? "");
  const polls = harness.requestsTo("/v1/chat/progress").length;
  poll(harness);
  assert.equal(harness.requestsTo("/v1/chat/progress").length, polls, "settled: no more polls");
  assert.equal(bar(harness).state, "idle", "the turn is over: the bar settles");
  assert.equal(barButton(harness, "stop"), null);
});

test("one Details disclosure holds Reasoning, Tools with error codes, and Usage; nothing else discloses", () => {
  const reply: JsonObject = {
    answer: "Changed the opacity.",
    reasoning: [{ step: 1, text: "Check the layer first.", tools: ["ae_inspect_layer"] }],
    tools: [
      { name: "ae_inspect_layer", ok: true },
      { name: "ae_propose_plan", ok: false, code: "STALE_SNAPSHOT", message: "The project changed." },
    ],
    usage: { inputTokens: 5000, cachedInputTokens: 4000, outputTokens: 200, totalTokens: 5200 },
    provider: { label: "DeepSeek" },
  };
  const harness = createPanelHarness({ respond: chatResponder(() => reply) });
  harness.send("fade it");
  const [row] = rowsOf(harness, "assistant");
  const [details] = detailsIn(required(row));
  assert.equal(detailsIn(output(harness)).length, 1, "one disclosure per answer, no separate reasoning, tool or usage ones");
  assert.deepEqual(textsOf(required(details), "answer-details-title"), ["Reasoning", "Tools", "Usage"]);
  assert.equal(required(details).find((node) => node.tagName === "SUMMARY")?.textContent, "Details");
  assert.match(required(details).textContent, /Step 1 · ae_inspect_layer/);
  assert.match(required(details).textContent, /Check the layer first\./);
  assert.match(required(details).textContent, /ae_propose_plan: refused \(STALE_SNAPSHOT\) The project changed\./);
  assert.match(required(details).textContent, /DeepSeek · 5\.2K tokens · cache hit 80% · output 200/);
});

test("an answer with nothing to disclose has no Details", () => {
  const harness = createPanelHarness({ respond: chatResponder(() => ({ answer: "Just words." })) });
  harness.send("hi");
  assert.equal(detailsIn(output(harness)).length, 0);
});

test("a pause says extynt stopped on purpose in the thread, and the amber bar offers the one Continue", () => {
  const pause = { kind: "window-cap", steps: 40, jobId: "job-1" };
  const harness = createPanelHarness({ respond: chatResponder(() => ({ answer: "Reply 'continue' to keep going.", pause })) });
  harness.send("big job");
  const [row] = rowsOf(harness, "assistant");
  assert.match(required(row).textContent, /extynt stopped here instead of spending more without your say-so\. Applied work is kept\./);
  assert.doesNotMatch(required(row).textContent, /Reply 'continue'/, "the button makes the sidecar's sentence untrue");
  assert.equal(buttonsNamed(required(row), "Continue").length, 0, "no second Continue in the thread");
  assert.deepEqual(
    [bar(harness).state, bar(harness).tone, bar(harness).text, bar(harness).actions],
    ["needs-you", "amber", "Paused after 40 steps", ["Continue"]],
  );
  assert.equal(rowsOf(harness, "error").length, 0, "a pause is not a failure");
});
