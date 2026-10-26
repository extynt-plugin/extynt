/** Panel contract: the sidecar's jobs and MCP calls. A running job is the working bar whichever request started it; outside agents are tagged rows, not a tab. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { allButtonsFor, bar, barButton, bodyOf, chatBodies, element, firstAnswer, holdChat, jobPayload, noticeTexts, nth, openSheet, output, planRow, pressKey, rowsOf, typeInComposer } from "./contract-helpers.js";
import { createPanelHarness } from "./contract.test.js";
import { type JsonObject } from "@extynt/decode";
import { fieldOf } from "./json-narrow.js";

function job(extra: JsonObject = {}): JsonObject {
  return jobPayload({
    jobId: "wf-job-1",
    requestId: "req-1",
    goal: "Build the title card",
    via: "apply-resume",
    activity: "applying plan",
    cycle: 3,
    step: 41,
    plansApplied: 27,
    ...extra,
  });
}
function call(extra: JsonObject = {}): JsonObject {
  return {
    id: 1,
    rev: 1,
    at: new Date().toISOString(),
    tool: "ae_propose_plan",
    client: "claude-code",
    args: 'summary: "Fade"',
    state: "ok",
    code: null,
    ms: 250,
    planIds: [],
    ...extra,
  };
}

test("a job the sidecar is running is the working bar with Stop, though no request of the panel is open", () => {
  const harness = createPanelHarness();
  harness.sse("activity", { jobs: [job()] });
  const view = bar(harness);
  assert.deepEqual([view.state, view.tone, view.text, view.actions], ["working", "accent", "applying plan", ["Stop"]]);
  assert.equal(element(harness, "chat").textContent, "Steer", "the composer button never stops: it steers");
  harness.sse("activity", { jobs: [job({ step: 42, status: "waiting-apply", activity: "waiting for your Apply" })] });
  assert.equal(bar(harness).state, "working", "the job alone does not make a decision: a held plan does");
  harness.sse("activity", { jobs: [] });
  assert.equal(element(harness, "chat").textContent, "Send");
  assert.equal(bar(harness).state, "finished", "a job that did something settles to a summary");
  assert.equal(
    noticeTexts(harness).some((text) => text.startsWith("The job is no longer running")),
    false,
    "the bar says it; the thread does not repeat it",
  );
});

test("a reloaded panel reattaches to a job that is already running", () => {
  const harness = createPanelHarness({
    sidecar: (sidecar) => {
      sidecar.jobs = [job()];
    },
  });
  assert.equal(element(harness, "chat").textContent, "Steer");
  assert.equal(bar(harness).state, "working");
});

test("a message steers the job instead of starting a second request, and Stop is the bar's", () => {
  const harness = createPanelHarness();
  harness.sse("activity", { jobs: [job()] });
  typeInComposer(harness, "make it blue");
  pressKey(harness, "Enter");
  assert.equal(chatBodies(harness).length, 0, "no parallel chat request");
  const steer = harness.requestsTo("/v1/chat/steer");
  assert.equal(steer.length, 1);
  assert.deepEqual([fieldOf(bodyOf(nth(steer, 0)), "requestId"), fieldOf(bodyOf(nth(steer, 0)), "message")], ["req-1", "make it blue"]);
  harness.click("chat");
  assert.equal(harness.requestsTo("/v1/ui/jobs/wf-job-1/stop").length, 0, "the composer button is not Stop");
  barButton(harness, "stop")?.click();
  assert.equal(harness.requestsTo("/v1/ui/jobs/wf-job-1/stop").length, 1);
});

test("plans the job lands join the thread as one fold line, not cards", () => {
  const harness = createPanelHarness({
    sidecar: (sidecar) => {
      sidecar.plans = [planRow("plan-9")];
    },
  });
  harness.sse("activity", { jobs: [job({ plans: ["plan-9"] })] });
  assert.equal(output(harness).all((node) => node.classList.has("plan-fold")).length, 1);
  assert.equal(output(harness).all((node) => node.classList.has("plan-card")).length, 0);
});

test("plans a job landed in one chat never reappear in a new chat, and the old chat keeps them", () => {
  const harness = createPanelHarness({
    sidecar: (sidecar) => {
      sidecar.plans = [planRow("plan-9")];
    },
  });
  harness.sse("activity", { jobs: [job({ plans: ["plan-9"] })] });
  assert.equal(output(harness).all((node) => node.classList.has("plan-fold")).length, 1);
  harness.sse("activity", { jobs: [] });
  harness.click("chat-clear");
  harness.sse("activity", { jobs: [job({ plans: [] })] });
  harness.sse("activity", { jobs: [] });
  assert.equal(output(harness).all((node) => node.classList.has("plan-fold")).length, 0, "the new chat shows no plan from the old one");
  const [first] = [...harness.sidecar.sessions.values()];
  assert.ok((first?.messages ?? []).some((row) => fieldOf(row, "kind") === "plan"), "the old chat keeps its card");
  const rows = [...harness.sidecar.sessions.values()].flatMap((session) => session.messages.filter((row) => fieldOf(row, "kind") === "plan"));
  assert.equal(rows.length, 1, "no second copy is written anywhere");
});

test("an outside agent working alone is a dashed eye bar with its name and no Stop", () => {
  const harness = createPanelHarness();
  harness.sse("mcp", { calls: [call({ state: "running", ms: null, tool: "ae_propose_plan" })] });
  const view = bar(harness);
  assert.deepEqual(
    [view.state, view.tone, view.text, view.sub, view.actions],
    ["outside", "dashed", "Claude Code · propose plan", "watching", []],
  );
  assert.notEqual(element(harness, "chat").textContent, "Steer", "your message starts your own request");
  harness.sse("mcp", { calls: [call({ state: "ok" })] });
  assert.equal(bar(harness).state, "idle", "nothing outside is running any more");
});

test("when your own job runs too, the bar shows your job with a small dashed chip for the outside agent", () => {
  const harness = createPanelHarness();
  harness.sse("activity", { jobs: [job()] });
  harness.sse("mcp", { calls: [call({ state: "running", ms: null })] });
  assert.equal(bar(harness).state, "working");
  const chip = element(harness, "status-bar").all((node) => node.classList.has("bar-chip"));
  assert.deepEqual(
    chip.map((node) => node.textContent),
    ["Claude Code"],
  );
});

test("MCP has no tab: outside calls are tagged rows in the sheet's Now, with no controls", () => {
  const harness = createPanelHarness();
  assert.equal(harness.el("tab-mcp"), null);
  assert.equal(harness.el("main-tabs"), null);
  harness.sse("mcp", {
    calls: [
      call({ id: 1, tool: "ae_inspect_composition", state: "ok", ms: 400 }),
      call({ id: 2, rev: 2, tool: "ae_approve_plan", state: "error", code: "NO_SNAPSHOT", ms: 9 }),
      call({ id: 3, rev: 3, tool: "ae_propose_plan", state: "running", ms: null }),
    ],
  });
  const sheet = openSheet(harness);
  const rows = sheet.all((node) => node.classList.has("now-row") && node.classList.has("outside"));
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.find((node) => node.classList.has("source-tag"))?.textContent === "Claude Code"));
  assert.match(nth(rows, 0).textContent, /propose plan.*applying/, "newest first");
  assert.match(nth(rows, 1).textContent, /approve plan.*NO_SNAPSHOT/);
  assert.match(nth(rows, 2).textContent, /inspect composition.*0\.4 s|inspect composition.*400 ms/);
  assert.equal(
    rows.flatMap((row) => row.all((node) => node.tagName === "BUTTON")).length,
    0,
    "watch-only: nothing to press on an outside row",
  );
});

function stopAnswer(answer: {
  status?: number;
  text: string;
}): (record: { url: string; method: string }) => { status?: number; text?: string } | undefined {
  return (record) => (record.method === "POST" && /\/v1\/ui\/(jobs\/[^/]+\/)?stop$/.test(record.url) ? answer : undefined);
}

test("there is one Stop: the bar's, and it is the only control that stops a job", () => {
  const harness = createPanelHarness();
  harness.sse("activity", { jobs: [job()] });
  const stops = harness.body().all((node) => node.tagName === "BUTTON" && /^(stop|cancel job)/i.test(node.textContent));
  assert.deepEqual(
    stops.map((node) => node.textContent),
    ["Stop"],
    "exactly one Stop control is on screen",
  );
  assert.equal(stops[0], barButton(harness, "stop"));
  openSheet(harness);
  assert.equal(allButtonsFor(harness, "Stop").length, 1, "opening the sheet does not add a second Stop: the bar is its header");
  const html = readFileSync("apps/panel/index.html", "utf8");
  assert.equal(html.match(/>\s*(Stop|Cancel job)\b/gi)?.length ?? 0, 0, "no static Stop control in the markup");
  assert.doesNotMatch(
    readFileSync("apps/panel/styles/components/composer.css", "utf8"),
    /#chat\.danger/,
    "the composer button has no Stop face",
  );
});

test("Stop with no job known to the panel still asks the sidecar to stop whatever runs, shows Stopping… and then the outcome", () => {
  const harness = createPanelHarness({
    respond: firstAnswer(holdChat, stopAnswer({ text: JSON.stringify({ ok: true, outcome: "stopped", message: "Stopped." }) })),
  });
  harness.send("fade the title in");
  assert.equal(bar(harness).state, "working");
  barButton(harness, "stop")?.click();
  assert.equal(harness.requestsTo("/v1/ui/stop").length, 1, "no job id known: the general stop is sent");
  assert.equal(harness.requestsTo("/v1/ui/jobs/").length, 0);
  assert.match(bar(harness).text + " " + bar(harness).sub, /Stopped\. Anything already applied|Stopping…/);
});

test("Stop shows Stopping… while the request is out, then the sidecar's real outcome", () => {
  let answered = false;
  const harness = createPanelHarness({
    respond: (record) =>
      record.method === "POST" && /\/v1\/ui\/jobs\/[^/]+\/stop$/.test(record.url)
        ? answered
          ? { text: JSON.stringify({ ok: true, outcome: "stopped", message: "Stopped." }) }
          : { hold: true }
        : undefined,
  });
  harness.sse("activity", { jobs: [job()] });
  barButton(harness, "stop")?.click();
  const during = bar(harness);
  assert.deepEqual(
    [during.sub, during.actions],
    ["Stopping…", ["Stopping…"]],
    "the button waits for the answer; there is still exactly one",
  );
  answered = true;
  const held = harness.held().filter((xhr) => /\/stop$/.test(xhr.url));
  nth(held, 0).respond(
    200,
    JSON.stringify({ ok: true, outcome: "stopped", message: "Stopped. Anything already applied is listed above and can be undone." }),
  );
  harness.sse("activity", { jobs: [] });
  assert.match(bar(harness).text, /^Stopped\. Anything already applied/);
  assert.equal(bar(harness).state, "idle");
});

test("a Stop the sidecar could not carry out is shown, never silent, and the bar still offers Stop", () => {
  const harness = createPanelHarness({
    respond: firstAnswer(
      stopAnswer({ status: 500, text: JSON.stringify({ ok: false, error: { code: "JOB_STOP_FAILED", message: "The stop failed." } }) }),
    ),
  });
  harness.sse("activity", { jobs: [job()] });
  barButton(harness, "stop")?.click();
  assert.equal(harness.requestsTo("/v1/ui/jobs/wf-job-1/stop").length, 1);
  assert.match(bar(harness).sub, /Stop failed/);
  assert.deepEqual(bar(harness).actions, ["Stop"]);
});

test("when the sidecar has nothing running, Stop says so and the composer goes back to Send", () => {
  const harness = createPanelHarness({
    respond: firstAnswer(stopAnswer({ text: JSON.stringify({ ok: true, outcome: "nothing-running", message: "Nothing was running." }) })),
  });
  harness.sse("activity", { jobs: [job()] });
  barButton(harness, "stop")?.click();
  assert.match(bar(harness).sub, /Nothing was running\./);
  assert.equal(element(harness, "chat").textContent, "Send");
  harness.sse("activity", { jobs: [] });
  assert.match(bar(harness).text, /Nothing was running\./);
  assert.equal(bar(harness).state, "idle");
});

test("the reply that closes an Apply-resumed job arrives as a stream event and lands in its chat, once", () => {
  const harness = createPanelHarness();
  harness.sse("activity", { jobs: [job()] });
  harness.sse("closing", { requestId: "req-1", text: "Applied: Brewmoss logo popped in at the centre." });
  harness.sse("activity", { jobs: [] });
  harness.sse("closing", { requestId: "req-1", text: "Applied: Brewmoss logo popped in at the centre." });
  const texts = rowsOf(harness, "assistant").map((node) => node.textContent);
  assert.deepEqual(texts, ["Applied: Brewmoss logo popped in at the centre."]);
  assert.equal(harness.requestsTo("/v1/chat/closing").length, 0, "the event made the read unnecessary");
});

test("a panel that missed the closing event reads it once when the job ends", () => {
  const closing = (record: { url: string }) => record.url.includes("/v1/chat/closing") ? { status: 200, text: JSON.stringify({ ok: true, closing: "Applied: Brewmoss logo popped in at the centre." }) } : undefined;
  const harness = createPanelHarness({ respond: closing });
  harness.sse("activity", { jobs: [job({ requestId: "req-2" })] });
  harness.sse("activity", { jobs: [] });
  harness.sse("activity", { jobs: [] });
  assert.deepEqual(rowsOf(harness, "assistant").map((node) => node.textContent), ["Applied: Brewmoss logo popped in at the centre."]);
  const asked = harness.requestsTo("/v1/chat/closing");
  assert.equal(asked.length, 1);
  assert.ok(nth(asked, 0).url.endsWith("requestId=req-2"));
});
