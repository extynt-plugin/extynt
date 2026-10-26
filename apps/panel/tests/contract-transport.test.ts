/** Panel contract: the request path to the sidecar: headers, errors, the 401 reload, reachability, Stop and the heavy-use guard. */
import assert from "node:assert/strict";
import test from "node:test";
import { bar, barButton, chatBodies, chatReply, nth, output, required, textsOf } from "./contract-helpers.js";
import { createPanelHarness, type PanelHarness, type StubRequestRecord, type StubResponse } from "./contract.test.js";
import { fieldOf } from "./json-narrow.js";

const BUILD = "0123456789abcdef";

function bannerText(harness: PanelHarness): string {
  return bar(harness).text;
}
function bannerShown(harness: PanelHarness): boolean {
  return bar(harness).state === "offline";
}
function openDebug(harness: PanelHarness): void {
  harness.click("open-settings");
  harness.click("open-developer");
}
function isChat(record: StubRequestRecord): boolean {
  return record.method === "POST" && record.url.endsWith("/v1/chat");
}
function errorTexts(harness: PanelHarness): string[] {
  return textsOf(output(harness), "error").map((text) => text.replace(/Try again$/, ""));
}
function noticeTexts(harness: PanelHarness): string[] {
  return textsOf(output(harness), "notice");
}
function answerChat(response: StubResponse): (record: StubRequestRecord) => StubResponse | undefined {
  return (record) => (isChat(record) ? response : undefined);
}
function lastChat(harness: PanelHarness): StubRequestRecord {
  return required(harness.requests.filter(isChat).at(-1));
}

test("every request carries the bearer, a request id, a correlation id and the panel instance the bootstrap named", () => {
  const harness = createPanelHarness();
  const [boot] = harness.requestsTo("/v1/ui/bootstrap");
  assert.equal(required(boot).headers["X-AE-Panel-Instance"], undefined, "the bootstrap is what names the instance");
  const calls = harness.requests.filter((record) => !record.url.endsWith("/v1/ui/events"));
  for (const record of calls) {
    assert.equal(record.headers.Authorization, "Bearer test-token", record.url);
    assert.ok(record.headers["X-AE-Request-Id"], "request id on " + record.url);
    assert.ok(record.headers["X-AE-Correlation-Id"], "correlation id on " + record.url);
  }
  const after = calls.slice(calls.indexOf(required(boot)) + 1);
  assert.ok(after.length > 0);
  for (const record of after) assert.equal(record.headers["X-AE-Panel-Instance"], "native:1:1", record.url);
  assert.match(required(boot).headers["X-AE-Request-Id"] ?? "", /^bootstrap-/);
  assert.match(required(boot).headers["X-AE-Correlation-Id"] ?? "", /^correlation-/);
});

test("every request goes to the sidecar origin the host injected", () => {
  const harness = createPanelHarness();
  harness.send("hello");
  assert.ok(harness.requests.length > 5);
  for (const record of harness.requests) assert.ok(record.url.startsWith("http://127.0.0.1:3210/"), record.url);
});

test("the chat request id in the body is the one in the X-AE-Request-Id header", () => {
  const harness = createPanelHarness();
  harness.send("hello");
  const record = lastChat(harness);
  assert.equal(fieldOf(nth(chatBodies(harness), 0), "requestId"), record.headers["X-AE-Request-Id"]);
  assert.equal(record.headers["Content-Type"], "application/json");
  assert.equal(nth(harness.requestsTo("/v1/ui/bootstrap"), 0).headers["Content-Type"], undefined, "a GET has no body type");
});

test("the panel build header is sent only when the build id is 16 hex characters", () => {
  const calls = (harness: PanelHarness): StubRequestRecord[] => harness.requests.filter((record) => !record.url.endsWith("/v1/ui/events"));
  const sent = createPanelHarness({ buildId: BUILD });
  assert.ok(calls(sent).length > 0);
  for (const record of calls(sent)) assert.equal(record.headers["X-AE-Panel-Build"], BUILD, record.url);
  for (const record of calls(createPanelHarness()))
    assert.match(record.headers["X-AE-Panel-Build"] ?? "", /^[a-f0-9]{16}$/, "the bundle's own stamp is sent");
  for (const bad of ["0123456789ABCDEF", "0123456789abcde", "0123456789abcdef0", "zzzzzzzzzzzzzzzz", 123, null]) {
    const harness = createPanelHarness({ buildId: bad });
    assert.ok(
      calls(harness).every((record) => record.headers["X-AE-Panel-Build"] === undefined),
      "rejected " + String(bad),
    );
  }
});

test("plan tool calls identify themselves as the panel; other calls do not", () => {
  const harness = createPanelHarness();
  harness.send("hello");
  const tools = harness.requestsTo("/v1/mcp/tools/call");
  assert.ok(tools.length > 0);
  for (const record of tools) assert.equal(record.headers["X-AE-Client"], "panel");
  assert.equal(lastChat(harness).headers["X-AE-Client"], undefined);
});

test("a refused request keeps its status and body, so the panel can show the sidecar's own words", () => {
  const body = JSON.stringify({ ok: false, error: { code: "SOMETHING_ELSE", message: "The sidecar says no." } });
  const harness = createPanelHarness({ respond: answerChat({ status: 500, text: body }) });
  harness.send("hello");
  assert.deepEqual(errorTexts(harness), ["The sidecar says no."]);
});

test("an error answer that is not JSON is shown with its HTTP status", () => {
  const harness = createPanelHarness({ respond: answerChat({ status: 502, text: "Bad gateway" }) });
  harness.send("hello");
  assert.deepEqual(errorTexts(harness), ["The sidecar answered HTTP 502: Bad gateway"]);
});

test("a success answer that is not JSON is reported as invalid, not as an empty reply", () => {
  const harness = createPanelHarness({ respond: answerChat({ status: 200, text: "<html>" }) });
  harness.send("hello");
  assert.match(errorTexts(harness)[0] ?? "", /^The sidecar returned invalid JSON/);
});

test("a 401 reloads the page for a fresh token, once, however many answers say so", () => {
  const harness = createPanelHarness({ respond: answerChat({ status: 401, text: '{"ok":false}' }) });
  harness.send("one");
  harness.send("two");
  harness.send("three");
  assert.equal(harness.reloads(), 1);
  assert.deepEqual(errorTexts(harness), [], "a 401 is not shown as a failure");
});

test("a 401 on the bootstrap reloads too", () => {
  const harness = createPanelHarness({
    respond: (record) => (record.url.endsWith("/v1/ui/bootstrap") ? { status: 401, text: "{}" } : undefined),
  });
  assert.equal(harness.reloads(), 1);
});

test("a timeout names how long the panel waited, and the chat turn waits 24 h (effectively no limit; only the idle watchdog abandons it) and no request ever sets timeout 0 while others wait thirty seconds", () => {
  const harness = createPanelHarness({ respond: answerChat({ timeout: true }) });
  harness.send("hello");
  assert.equal(lastChat(harness).timeoutMs, 86_400_000);
  assert.ok(
    harness.requests.filter((record) => !record.url.endsWith("/v1/ui/events")).every((record) => record.timeoutMs !== 0),
    "the transport never sets xhr.timeout to 0 (the SSE stream is not a transport request)",
  );
  assert.equal(nth(harness.requestsTo("/v1/ui/bootstrap"), 0).timeoutMs, 30000);
  assert.match(errorTexts(harness)[0] ?? "", /did not answer within \d+ ms/);
});

test("a network error shows the bar state only after three seconds, and the next good answer clears it", () => {
  let down = true;
  const harness = createPanelHarness({ respond: (record) => (down && !record.url.endsWith("/v1/ui/events") ? { fail: true } : undefined) });
  harness.send("hello");
  assert.equal(bannerShown(harness), false, "a blip is not worth a bar state");
  harness.advance(3000);
  harness.runTimeouts((timer) => timer.ms <= 3000);
  assert.equal(bannerShown(harness), true);
  assert.equal(bannerText(harness), "Reconnecting to extynt…");
  assert.match(errorTexts(harness)[0] ?? "", /Could not reach extynt's helper\./);
  down = false;
  harness.send("hello again");
  assert.equal(bannerShown(harness), false, "the sidecar answered, so it is reachable again");
});

test("without a native session nothing is sent, and a message says why", () => {
  const harness = createPanelHarness({ native: null });
  harness.send("hello");
  assert.equal(harness.requests.length, 0);
  assert.match(noticeTexts(harness).join(" "), /Open this panel from After Effects/);
});

test("Stop (in the bar) aborts the running turn, says so plainly, and does not count as a failed request", () => {
  const harness = createPanelHarness({ respond: (record) => (isChat(record) ? { hold: true } : undefined) });
  openDebug(harness);
  harness.send("hello");
  assert.equal(harness.el("chat")?.textContent, "Steer");
  required(barButton(harness, "stop")).click();
  assert.equal(harness.held().find((xhr) => xhr.url.endsWith("/v1/chat"))?.aborted, true);
  assert.deepEqual(noticeTexts(harness), ["Stopped. Anything already applied is listed above and can be undone."]);
  assert.equal(harness.el("chat")?.textContent, "Send");
  assert.match(harness.el("telemetry-display")?.textContent ?? "", /errors 0/);
});

test("a turn that stops reporting progress for three minutes is abandoned with the receipts hint", () => {
  const progress = (record: StubRequestRecord): StubResponse | undefined => {
    if (!record.url.includes("/v1/chat/progress")) return undefined;
    const id = new URL(record.url).searchParams.get("requestId");
    return { status: 200, text: JSON.stringify({ ok: true, progress: { requestId: id, label: "Working", step: 1 } }) };
  };
  const harness = createPanelHarness({ respond: (record) => (isChat(record) ? { hold: true } : progress(record)) });
  harness.send("hello");
  harness.runIntervals((timer) => timer.ms === 900);
  assert.equal(harness.pendingTimeouts().filter((timer) => timer.ms === 180000).length, 1, "progress arms the idle watchdog");
  harness.runTimeouts((timer) => timer.ms === 180000);
  assert.match(noticeTexts(harness).join(" "), /stopped reporting progress, so authoring was abandoned/);
  assert.equal(harness.el("chat")?.textContent, "Send");
});

test("a failed request is counted as an error in Debug's telemetry, a good one is not", () => {
  const harness = createPanelHarness({ respond: answerChat({ status: 500, text: '{"ok":false,"error":{"message":"x"}}' }) });
  openDebug(harness);
  harness.send("hello");
  assert.match(harness.el("telemetry-display")?.textContent ?? "", /errors 1\b/);
});

test("heavy model use pauses the next message, and Pause after heavy use off lets it through", () => {
  const heavy = (steps: number): ReturnType<typeof chatReply> => chatReply({ usage: { inputTokens: 5, outputTokens: 5 }, steps });
  const guarded = createPanelHarness({ respond: answerChat(heavy(130)) });
  guarded.send("first");
  guarded.send("second");
  assert.equal(guarded.requests.filter(isChat).length, 1, "the second message is not sent");
  assert.match(noticeTexts(guarded).join(" "), /Rate limit reached\. Wait a minute, or turn off “Pause after heavy use” in Settings\./);
  guarded.advance(61000);
  guarded.send("third");
  assert.equal(guarded.requests.filter(isChat).length, 2, "a quiet minute lifts the pause");

  const free = createPanelHarness({
    sidecar: (sidecar) => {
      sidecar.prefs.rateLimit = false;
    },
    respond: answerChat(heavy(130)),
  });
  free.send("first");
  free.send("second");
  assert.equal(free.requests.filter(isChat).length, 2);
});

test("approaching the guard rail warns but still sends", () => {
  const harness = createPanelHarness({ respond: answerChat(chatReply({ usage: { inputTokens: 5, outputTokens: 5 }, steps: 100 })) });
  harness.send("first");
  harness.send("second");
  assert.equal(harness.requests.filter(isChat).length, 2);
  assert.match(noticeTexts(harness).join(" "), /Approaching the model-call guard rail \(83%\)\./);
});
