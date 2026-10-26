/** Panel contract: sending a message, the composer, the answer on screen, and what a failed turn says. */
import assert from "node:assert/strict";
import test from "node:test";
import { answered, barButton, buttonsNamed, cards, chatBodies, chatReply, chatResponder, element, firstAnswer, holdChat, noticeTexts, nth, output, planCard, pressKey, progressResponder, required, rowsOf, textsOf, typeInComposer } from "./contract-helpers.js";
import { createPanelHarness, PNG, type StubRequestRecord } from "./contract.test.js";
import { fieldOf, readJson, recordAt, type Found } from "./json-narrow.js";
import { type JsonObject } from "@extynt/decode";

const composerOf = (harness: ReturnType<typeof createPanelHarness>) => element(harness, "chat-message");

test("Send posts the message with its history, the session and autoApply on for risky-only", () => {
  const harness = createPanelHarness({ respond: answered("Done.") });
  harness.send("make the title bounce");
  const [body] = chatBodies(harness);
  assert.equal(fieldOf(required(body), "schemaVersion"), "0.1");
  assert.equal(fieldOf(required(body), "message"), "make the title bounce");
  assert.match(String(fieldOf(required(body), "requestId")), /^chat-/);
  assert.equal(fieldOf(required(body), "autoApply"), true);
  assert.equal(typeof fieldOf(required(body), "sessionId"), "string");
  assert.ok(Array.isArray(fieldOf(required(body), "history")));
  assert.ok(!("image" in required(body)) && !("continueJobId" in required(body)), "no frame and no continuation unless asked for");
  assert.equal(nth(harness.requestsTo("/v1/chat"), 0).headers.Authorization, "Bearer test-token");
});

test("autoApply is off only when the reader chose to be asked about every change", () => {
  const sent = (ask: string): Found => {
    const harness = createPanelHarness({
      sidecar: (sidecar) => {
        sidecar.prefs.askBeforeApplying = ask;
      },
      respond: answered("ok"),
    });
    harness.send("hello");
    return fieldOf(nth(chatBodies(harness), 0), "autoApply");
  };
  assert.deepEqual([sent("risky"), sent("always"), sent("never")], [true, false, true]);
});

test("the history holds the earlier turns and never the message being sent", () => {
  const harness = createPanelHarness({ respond: answered("First answer.") });
  harness.send("first question");
  harness.send("second question");
  const [first, second] = chatBodies(harness);
  assert.deepEqual(fieldOf(required(first), "history"), [], "nothing came before the first message");
  assert.deepEqual(fieldOf(required(second), "history"), [
    { role: "user", content: "first question" },
    { role: "assistant", content: "First answer." },
  ]);
});

test("the message and the answer appear as bubbles, and the composer empties", () => {
  const harness = createPanelHarness({ respond: answered("Opacity now fades in over one second.") });
  harness.send("fade the title in");
  assert.equal(composerOf(harness).value, "");
  assert.match(nth(rowsOf(harness, "user"), 0).textContent, /fade the title in/);
  assert.match(nth(rowsOf(harness, "assistant"), 0).textContent, /Opacity now fades in over one second\./);
  assert.equal(element(harness, "status-bar").getAttribute("data-state"), "idle", "the working bar settles once the answer is in");
});

test("an answer draws the markdown subset: code, bold, lists, fences, headings and links", () => {
  const answer = [
    "## Plan",
    "Set **Opacity** to `100` then see [the docs](https://example.com).",
    "- first",
    "- second",
    "1. one",
    "```",
    "const a = 1;",
    "```",
  ].join("\n");
  const harness = createPanelHarness({ respond: answered(answer) });
  harness.send("explain");
  const row = nth(rowsOf(harness, "assistant"), 0);
  assert.deepEqual(textsOf(row, "md-heading"), ["Plan"]);
  assert.deepEqual(
    row.all((node) => node.tagName === "STRONG").map((node) => node.textContent),
    ["Opacity"],
  );
  assert.deepEqual(
    row.all((node) => node.tagName === "CODE").map((node) => node.textContent),
    ["100"],
  );
  assert.deepEqual(
    row.all((node) => node.tagName === "LI").map((node) => node.textContent),
    ["first", "second", "one"],
  );
  assert.equal(row.all((node) => node.tagName === "UL").length + row.all((node) => node.tagName === "OL").length, 2);
  assert.deepEqual(textsOf(row, "code-block"), ["const a = 1;"]);
  const link = row.find((node) => node.classList.has("md-link"));
  assert.equal(link?.textContent, "the docs");
  assert.equal(link?.title, "https://example.com");
});

test("Enter sends, Shift+Enter does not, and an empty composer sends nothing", () => {
  const harness = createPanelHarness({ respond: answered("ok") });
  typeInComposer(harness, "line one");
  pressKey(harness, "Enter", { shiftKey: true });
  assert.equal(chatBodies(harness).length, 0, "Shift+Enter starts a new line");
  pressKey(harness, "Enter", { isComposing: true });
  assert.equal(chatBodies(harness).length, 0, "Enter inside an IME composition is left alone");
  pressKey(harness, "Enter");
  assert.equal(chatBodies(harness).length, 1);
  typeInComposer(harness, "   ");
  pressKey(harness, "Enter");
  harness.click("chat");
  assert.equal(chatBodies(harness).length, 1, "blank text is not a message");
});

test("focus stays in the composer after Send", () => {
  const harness = createPanelHarness({ respond: answered("ok") });
  const before = composerOf(harness).focused;
  harness.send("hello");
  assert.ok(composerOf(harness).focused > before);
});

test("Enter during a turn steers it instead of starting a second chat", () => {
  const harness = createPanelHarness({ respond: holdChat });
  harness.send("start a long job");
  typeInComposer(harness, "also keep it short");
  pressKey(harness, "Enter");
  assert.equal(chatBodies(harness).length, 1, "no second /v1/chat");
  const steer = harness.requestsTo("/v1/chat/steer");
  assert.equal(steer.length, 1);
  const body = recordAt(readJson(nth(steer, 0).body));
  assert.equal(fieldOf(body, "requestId"), fieldOf(nth(chatBodies(harness), 0), "requestId"));
  assert.equal(fieldOf(body, "message"), "also keep it short");
  assert.equal(composerOf(harness).value, "");
  assert.ok(rowsOf(harness, "user").some((row) => row.textContent.includes("also keep it short")));
});

test("a steer the sidecar refuses says so, with Try again, instead of looking delivered", () => {
  const refuse = (record: { url: string }) =>
    record.url.endsWith("/v1/chat/steer") ? { status: 200, text: JSON.stringify({ ok: false }) } : undefined;
  const harness = createPanelHarness({ respond: firstAnswer(refuse, holdChat) });
  harness.send("start");
  typeInComposer(harness, "and then");
  pressKey(harness, "Enter");
  assert.match(nth(rowsOf(harness, "error"), 0).textContent, /That turn had already finished\./);
  assert.equal(buttonsNamed(nth(rowsOf(harness, "error"), 0), "Try again").length, 1);
});

test("while a turn runs the composer invites steering and the button becomes Steer; Stop is the bar's", () => {
  const harness = createPanelHarness({ respond: holdChat });
  harness.send("start");
  assert.equal(composerOf(harness).placeholder, "Steer: add to this request…");
  assert.equal(element(harness, "chat").textContent, "Steer");
  nth(harness.held(), 1).respond(200, chatReply({ requestId: String(fieldOf(nth(chatBodies(harness), 0), "requestId")) }).text ?? "");
  assert.equal(composerOf(harness).placeholder, "Ask, or describe a change…");
  assert.equal(element(harness, "chat").textContent, "Send");
});

test("Stop (in the bar) aborts the request and says anything already applied can be undone", () => {
  const harness = createPanelHarness({ respond: holdChat });
  harness.send("start");
  harness.click("chat");
  assert.equal(
    harness.held().some((xhr) => xhr.url.endsWith("/v1/chat") && xhr.aborted),
    false,
    "the composer button only steers",
  );
  barButton(harness, "stop")?.click();
  assert.ok(
    harness.held().some((xhr) => xhr.url.endsWith("/v1/chat") && xhr.aborted),
    "the chat request was aborted",
  );
  assert.ok(noticeTexts(harness).includes("Stopped. Anything already applied is listed above and can be undone."));
  assert.equal(element(harness, "chat").textContent, "Send");
  assert.equal(rowsOf(harness, "error").length, 0, "a stop is not an error");
});

test("a turn that goes quiet is abandoned with the sidecar's own words", () => {
  const progress = progressResponder((requestId) => ({ requestId, label: "Reading the composition", step: 1 }));
  const harness = createPanelHarness({ respond: firstAnswer(progress, holdChat) });
  harness.send("start");
  harness.runIntervals((timer) => timer.ms === 900);
  assert.equal(
    harness.runTimeouts((timer) => timer.ms === 180000),
    1,
    "one idle watchdog is armed by a progress report",
  );
  assert.match(noticeTexts(harness).join("\n"), /The sidecar stopped reporting progress, so authoring was abandoned\./);
});

test("HTTP 503 means no model: the notice says so and offers Set up model", () => {
  const harness = createPanelHarness({
    respond: (record) =>
      record.url.endsWith("/v1/chat")
        ? { status: 503, text: JSON.stringify({ ok: false, error: { code: "NO_MODEL", message: "x" } }) }
        : undefined,
  });
  harness.send("hello");
  const [row] = rowsOf(harness, "notice");
  assert.match(required(row).textContent, /Set up a model to start\./);
  assert.equal(buttonsNamed(required(row), "Set up model").length, 1);
  assert.equal(rowsOf(harness, "error").length, 0);
});

test("any other failure is an error bubble whose Try again puts the words back and sends them again", () => {
  let failing = true;
  const flaky = (record: { url: string; method: string }) =>
    failing && record.url.endsWith("/v1/chat") && record.method === "POST"
      ? { status: 500, text: JSON.stringify({ ok: false, error: { message: "The model timed out." } }) }
      : undefined;
  const harness = createPanelHarness({ respond: firstAnswer(flaky, answered("Back now.")) });
  harness.send("animate the logo");
  const [row] = rowsOf(harness, "error");
  assert.match(required(row).textContent, /The model timed out\./);
  failing = false;
  nth(buttonsNamed(required(row), "Try again"), 0).click();
  const bodies = chatBodies(harness);
  assert.equal(bodies.length, 2);
  assert.equal(fieldOf(nth(bodies, 1), "message"), "animate the logo");
  assert.match(nth(rowsOf(harness, "assistant"), 0).textContent, /Back now\./);
});

test("a busy workflow engine tells the reader to resend once the last change settles", () => {
  const busy = { status: 409, text: JSON.stringify({ ok: false, error: { code: "WORKFLOW_ENGINE_BUSY", message: "busy" } }) };
  const harness = createPanelHarness({ respond: (record) => (record.url.endsWith("/v1/chat") ? busy : undefined) });
  harness.send("go");
  const [row] = rowsOf(harness, "error");
  assert.match(
    required(row).textContent,
    /extynt is still finishing an earlier request: its last change is waiting to be applied or checked\. Send this again once that settles\./,
  );
  assert.equal(buttonsNamed(required(row), "Try again").length, 1);
});

test("a reply that is not ok shows its message as an error and keeps the words for Try again", () => {
  const harness = createPanelHarness({
    respond: chatResponder(() => ({ ok: false, error: { message: "The model returned no answer." } })),
  });
  harness.send("go");
  assert.match(nth(rowsOf(harness, "error"), 0).textContent, /The model returned no answer\./);
  assert.equal(fieldOf(chatBodies(harness)[0], "message"), "go");
});

test("with no model set up Send is blocked with the setup notice and nothing is posted", () => {
  const harness = createPanelHarness({
    sidecar: (sidecar) => {
      sidecar.modelConfigured = false;
    },
  });
  harness.send("hello");
  assert.equal(chatBodies(harness).length, 0);
  const [row] = rowsOf(harness, "notice");
  assert.match(required(row).textContent, /Set up a model to start\./);
  assert.equal(buttonsNamed(required(row), "Set up model").length, 1);
  assert.equal(composerOf(harness).value, "hello", "the words are still there once a model is connected");
});

test("the rate-limit guard warns near the limit, then blocks, and is off when the reader turned it off", () => {
  const heavy = answered("ok", { steps: 100, usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } });
  const harness = createPanelHarness({ respond: heavy });
  harness.send("one");
  harness.send("two");
  assert.match(noticeTexts(harness).join("\n"), /Approaching the model-call guard rail \(\d+%\)\./);
  assert.equal(chatBodies(harness).length, 2, "a warning still sends");
  harness.send("three");
  assert.match(noticeTexts(harness).join("\n"), /Rate limit reached\. Wait a minute, or turn off “Pause after heavy use” in Settings\./);
  assert.equal(chatBodies(harness).length, 2, "the blocked message was not sent");
  assert.equal(composerOf(harness).value, "three", "and its words are kept");
  const relaxed = createPanelHarness({
    sidecar: (sidecar) => {
      sidecar.prefs.rateLimit = false;
    },
    respond: heavy,
  });
  for (const text of ["a", "b", "c", "d"]) relaxed.send(text);
  assert.equal(chatBodies(relaxed).length, 4);
});

test("a plan in the reply becomes one fold line in the chat under the answer, not a card", () => {
  const harness = createPanelHarness({ respond: chatResponder(() => ({ answer: "Here is the change.", plans: [planCard("p1")] })) });
  harness.send("fade the title in");
  assert.equal(cards(harness).length, 0);
  const kinds = output(harness).childNodes.map((node) => ("className" in node ? node.className : ""));
  assert.ok(kinds.some((name) => name.includes("assistant")) && kinds.some((name) => name.includes("plan-fold")));
});

const FOCUS = {
  project: "Fixture.aep",
  compositionId: "comp-1",
  compositionName: "Main",
  selected: 0,
  layerNames: [],
  kinds: [],
  selectionFingerprint: null,
  at: 1,
};
const captured = (record: StubRequestRecord) =>
  record.url.endsWith("/v1/host/capture")
    ? { status: 200, text: JSON.stringify({ ok: true, dataUrl: PNG, width: 1, height: 1, captureId: "cap-1", time: 12 }) }
    : undefined;
const withComposition = (respond?: (record: StubRequestRecord) => ReturnType<typeof captured>) =>
  createPanelHarness({
    sidecar: (sidecar) => {
      sidecar.focus = FOCUS;
    },
    respond: firstAnswer(respond, answered("I see it.")),
  });
const modelWithImages = (acceptsImages: boolean) => (record: StubRequestRecord) => {
  if (!record.url.endsWith("/v1/settings/model") || record.method !== "GET") return undefined;
  const slot = { service: "deepseek", model: "deepseek-v4", displayName: "DeepSeek", keyConfigured: true, acceptsImages };
  return {
    status: 200,
    text: JSON.stringify({
      ok: true,
      slots: { primary: slot, fallback: null },
      active: { primary: slot, fallback: null },
      services: [],
      formats: {},
    }),
  };
};

test("Attach captures the open composition, shows the chip with Remove, and the next message carries the frame", () => {
  const harness = withComposition(captured);
  harness.click("snapshot");
  const [call] = harness.requestsTo("/v1/host/capture");
  const body = recordAt(readJson(required(call).body));
  assert.equal(fieldOf(body, "compositionId"), "comp-1");
  assert.equal(typeof fieldOf(body, "preview", "maxWidth"), "number");
  const chip = element(harness, "attach");
  assert.equal(chip.hidden, false);
  assert.match(chip.textContent, /Frame at 0:12 will be sent with your message\./);
  assert.equal(buttonsNamed(chip, "Remove").length, 1);
  harness.send("what is wrong here");
  const image = recordAt(chatBodies(harness)[0], "image");
  assert.deepEqual(image, { mediaType: "image/png", base64: PNG.slice(PNG.indexOf(",") + 1) });
  assert.equal(element(harness, "attach").hidden, true, "the chip is spent once the message is sent");
  assert.equal(nth(rowsOf(harness, "user"), 0).all((node) => node.classList.has("frame-image")).length, 1, "the bubble shows the frame");
});

test("Remove drops the attached frame so the next message goes without it", () => {
  const harness = withComposition(captured);
  harness.click("snapshot");
  nth(buttonsNamed(element(harness, "attach"), "Remove"), 0).click();
  assert.equal(element(harness, "attach").hidden, true);
  harness.send("never mind");
  assert.ok(!("image" in nth(chatBodies(harness), 0)));
});

test("a capture the sidecar could not make says so and attaches nothing", () => {
  const harness = withComposition();
  harness.click("snapshot");
  assert.ok(noticeTexts(harness).includes("The frame could not be captured."));
  assert.equal(element(harness, "attach").hidden, true);
});

test("with a model that cannot take images the button explains and offers Switch model, without capturing", () => {
  const harness = withComposition(modelWithImages(false));
  harness.click("snapshot");
  assert.equal(harness.requestsTo("/v1/host/capture").length, 0);
  const [row] = rowsOf(harness, "notice");
  assert.match(required(row).textContent, /This model can't take images, so a frame can't be sent\./);
  assert.equal(buttonsNamed(required(row), "Switch model").length, 1);
});

test("with no composition open the button says to open one", () => {
  const harness = createPanelHarness({ respond: answered("ok") });
  harness.click("snapshot");
  assert.equal(harness.requestsTo("/v1/host/capture").length, 0);
  assert.ok(noticeTexts(harness).includes("Open a composition in After Effects to attach a frame of it."));
});

test("a prompt the sidecar refuses as too long goes back in the composer, and Send anyway sends it past the limit", () => {
  const harness = createPanelHarness({
    respond: chatResponder((body): JsonObject =>
      fieldOf(body, "allowLongPrompt") === true
        ? { answer: "Started." }
        : {
            outcome: "failed",
            answer: "Your prompt is 41 KB; the limit is 32 KB. Shorten the prompt, or choose Send anyway.",
            failure: { code: "PROMPT_TOO_LONG", message: "too long" },
          },
    ),
  });
  harness.send("a very long brief");
  assert.ok(output(harness).textContent.includes("Shorten the prompt"));
  assert.equal(composerOf(harness).value, "a very long brief", "the prompt is back to be shortened");
  const [sendAnyway] = buttonsNamed(output(harness), "Send anyway");
  assert.ok(sendAnyway, "Send anyway is offered");
  required(sendAnyway).click();
  const bodies = chatBodies(harness);
  assert.equal(bodies.length, 2);
  assert.ok(!("allowLongPrompt" in nth(bodies, 0)));
  assert.equal(fieldOf(nth(bodies, 1), "allowLongPrompt"), true);
  assert.equal(fieldOf(nth(bodies, 1), "message"), "a very long brief");
});
