/** Panel contract: chats live in the sidecar's store: loading, saving, switching, deleting, and a running turn's own chat. */
import assert from "node:assert/strict";
import test from "node:test";
import type { StubResponder } from "./contract-xhr.js";
import { buttonsNamed, element, firstAnswer, noticeTexts, nth, output, required, rowsOf } from "./contract-helpers.js";
import { createPanelHarness, type PanelHarness } from "./contract.test.js";
import { arrayOf, fieldOf, numberAt, readJson, recordAt, recordsAt, textAt } from "./json-narrow.js";
import { type JsonValue } from "@extynt/decode";
import { MINUTE, activityLog, answered, itemFor, listRows, openChats, putsTo, rowTitles, stored, titleOf, withSessions } from "./contract-sessions-fixtures.js";

test("boot loads the chat list, then the chat the store says is open", () => {
  const harness = withSessions(
    [stored("s1", "First chat", 5 * MINUTE, { texts: ["hello from one", "hi"] }), stored("s2", "Second chat", 2 * MINUTE)],
    "s1",
  );
  const paths = harness.requests.map((record) => record.method + " " + record.url.replace("http://127.0.0.1:3210", ""));
  assert.ok(paths.indexOf("GET /v1/ui/sessions") > paths.indexOf("GET /v1/ui/bootstrap"));
  assert.ok(paths.indexOf("GET /v1/ui/sessions/s1") > paths.indexOf("GET /v1/ui/sessions"));
  assert.equal(titleOf(harness), "First chat");
  assert.match(output(harness).textContent, /hello from one/);
  assert.ok(!paths.includes("GET /v1/ui/sessions/s2"), "the other chat is not read until it is opened");
});

test("a chat the store cannot open is replaced by an empty new chat", () => {
  const harness = withSessions([], "gone");
  assert.equal(titleOf(harness), "New chat");
  assert.equal(rowsOf(harness, "user").length, 0);
});

test("sending saves the chat to the store, named for its first message, with its project, and marks it current", () => {
  const harness = createPanelHarness({
    respond: answered("Done."),
    sidecar: (sidecar) => {
      sidecar.focus = {
        project: "Other.aep",
        compositionId: null,
        compositionName: null,
        selected: 0,
        layerNames: [],
        kinds: [],
        selectionFingerprint: null,
        at: 1,
      };
    },
  });
  harness.send("make the title bounce");
  const [session] = [...harness.sidecar.sessions.values()];
  assert.equal(required(session).title, "make the title bounce");
  assert.equal(required(session).project, "Other.aep");
  assert.deepEqual(
    required(session).messages.map((row) => fieldOf(row, "kind")),
    ["user", "assistant"],
  );
  assert.equal(harness.sidecar.current, required(session).id);
  const body = recordAt(readJson(required(putsTo(harness, required(session).id).at(-1)).body));
  assert.deepEqual(Object.keys(body).sort(), ["createdAt", "messages", "project", "title"]);
  assert.equal(titleOf(harness), "make the title bounce");
});

test("a long first message becomes a one-line title of at most 50 characters ending in an ellipsis", () => {
  const harness = createPanelHarness({ respond: answered("ok") });
  harness.send("please animate every single layer in this composition with a gentle ease\nthen render it");
  const title = nth([...harness.sidecar.sessions.values()], 0).title;
  assert.ok(title.length <= 50 && title.length > 40);
  assert.ok(title.endsWith("…") && !title.includes("\n"));
});

test("a change made while a save is in flight is sent once the save ends, never in parallel", () => {
  let heldOnce = false;
  const holdFirstSave: StubResponder = (record) => {
    if (record.method !== "PUT" || !record.url.includes("/v1/ui/sessions/") || heldOnce) return undefined;
    heldOnce = true;
    return { hold: true };
  };
  const harness = createPanelHarness({ respond: firstAnswer(holdFirstSave, answered("Done.")) });
  harness.send("one");
  const [id] = [
    ...harness.sidecar.sessions.keys(),
    ...harness.requests.filter((r) => r.method === "PUT").map((r) => decodeURIComponent(r.url.split("/").pop() ?? "")),
  ];
  assert.equal(putsTo(harness, required(id)).length, 1, "the answer arrived during the save but no second PUT started");
  required(harness.held().find((xhr) => xhr.method === "PUT")).respond(200, '{"ok":true}');
  const puts = putsTo(harness, required(id));
  assert.ok(puts.length >= 2, "the change made meanwhile is sent after");
  const last = recordAt(readJson(nth(puts, 1).body));
  assert.equal(arrayOf(fieldOf(last, "messages")).length, 2);
  assert.equal(fieldOf(last, "title"), "one");
});

test("a save the sidecar refuses is reported without losing the chat on screen", () => {
  const refuse: StubResponder = (record) =>
    record.method === "PUT" && record.url.includes("/v1/ui/sessions/") ? { status: 500, text: JSON.stringify({ ok: false }) } : undefined;
  const harness = createPanelHarness({ respond: firstAnswer(refuse, answered("Done.")) });
  harness.send("hello");
  assert.match(activityLog(harness), /Chat history could not be saved/);
  assert.match(output(harness).textContent, /Done\./);
});

const SAVE_FAILED = "Chat history could not be saved; the automatic archive still holds what was recorded.";
const saveFailedCount = (harness: PanelHarness): number =>
  noticeTexts(harness).filter((text) => text.startsWith("Chat history could not be saved")).length;
const isSessionPut = (record: { method: string; url: string }): boolean =>
  record.method === "PUT" && record.url.includes("/v1/ui/sessions/");
const messageTexts = (body: JsonValue): string[] => recordsAt(body, "messages").map((message) => textAt(message, "text"));

test("the save-failed notice is shown in the thread but never sent to the store", () => {
  let failing = true;
  const flaky: StubResponder = (record) =>
    failing && isSessionPut(record) ? { status: 500, text: JSON.stringify({ ok: false }) } : undefined;
  const harness = createPanelHarness({ respond: firstAnswer(flaky, answered("Done.")) });
  harness.send("hello");
  assert.equal(saveFailedCount(harness), 1, "the reader is told");
  failing = false;
  harness.send("again");
  for (const record of harness.requests.filter(isSessionPut))
    assert.ok(!messageTexts(readJson(record.body)).includes(SAVE_FAILED), "no stored copy of the notice");
  const [kept] = [...harness.sidecar.sessions.values()];
  assert.ok(kept && !kept.messages.some((message) => fieldOf(message, "text") === SAVE_FAILED));
  assert.equal(saveFailedCount(harness), 0, "a save that went through takes the stale warning away");
});

test("two failure streaks leave at most one notice, and none once a save lands", () => {
  let failing = true;
  const flaky: StubResponder = (record) =>
    failing && isSessionPut(record) ? { status: 500, text: JSON.stringify({ ok: false }) } : undefined;
  const harness = createPanelHarness({ respond: firstAnswer(flaky, answered("Done.")) });
  harness.send("one");
  harness.send("two");
  assert.equal(saveFailedCount(harness), 1, "one streak, one notice");
  failing = false;
  harness.send("three");
  assert.equal(saveFailedCount(harness), 0);
  failing = true;
  harness.send("four");
  harness.send("five");
  assert.equal(saveFailedCount(harness), 1, "the second streak says it once, not on top of the first");
});

test("a chat stored with save-failed notices opens without them, and a clean copy is written back", () => {
  const session = stored("old", "Old chat", MINUTE, { texts: ["hello", "hi"] });
  session.messages.push(...[1, 2, 3].map((n) => ({ kind: "notice", text: SAVE_FAILED, tone: "warn", at: Date.now() + n })), {
    kind: "notice",
    text: "Stopped.",
    tone: "quiet",
    at: Date.now() + 9,
  });
  const harness = withSessions([session], "old");
  assert.equal(saveFailedCount(harness), 0, "the replayed notices are gone");
  assert.ok(noticeTexts(harness).includes("Stopped."), "a notice that is part of the conversation stays");
  const [put] = putsTo(harness, "old");
  assert.ok(put, "the store is healed on load");
  assert.deepEqual(messageTexts(readJson(put.body)), ["hello", "hi", "Stopped."]);
});

test("a save answered by a restarted sidecar reloads the page for a fresh token and is not called a failure", () => {
  const restarted: StubResponder = (record) => (isSessionPut(record) ? { status: 401, text: JSON.stringify({ ok: false }) } : undefined);
  const harness = createPanelHarness({ respond: firstAnswer(restarted, answered("Done.")) });
  harness.send("hello");
  assert.equal(harness.reloads(), 1, "the page reloads to pick up the new token");
  assert.equal(saveFailedCount(harness), 0, "a reload for a fresh token is not a failed save");
});

test("the automatic archive posts each message revision once and retries a failed post", () => {
  let failing = true;
  const flaky: StubResponder = (record) => (failing && record.url.endsWith("/v1/chat-logs") ? { status: 500, text: "{}" } : undefined);
  const harness = createPanelHarness({ respond: firstAnswer(flaky, answered("Done.")) });
  harness.send("first");
  const before = harness.requestsTo("/v1/chat-logs").length;
  assert.ok(before >= 1);
  failing = false;
  assert.equal(
    harness.runTimeouts((timer) => timer.ms === 1500),
    1,
    "the retry is scheduled 1.5 s out",
  );
  const batches = harness.requestsTo("/v1/chat-logs").map((record) => recordAt(readJson(record.body)));
  assert.equal(batches.length, before + 1);
  assert.equal(fieldOf(required(batches.at(-1)), "schemaVersion"), "extynt.chat-log/0.1");
  assert.deepEqual(
    recordsAt(batches.at(-1), "events").map((event) => fieldOf(event, "type")),
    ["session", "message", "message"],
  );
  harness.send("second");
  const recorded = harness.requestsTo("/v1/chat-logs").slice(before);
  const keys = recorded
    .flatMap((record) => recordsAt(readJson(record.body), "events"))
    .map((event) => textAt(event, "eventId") + "@" + numberAt(event, "revision"));
  assert.equal(new Set(keys).size, keys.length, "no revision is posted twice after it was recorded");
});

test("a chat is kept to its newest 60 messages", () => {
  const texts = Array.from({ length: 70 }, (_, index) => "message " + index);
  const harness = withSessions([stored("s1", "Long chat", MINUTE, { texts })], "s1", answered("newest"));
  harness.send("one more");
  const session = required(harness.sidecar.sessions.get("s1"));
  assert.equal(session.messages.length, 60);
  assert.equal(fieldOf(session.messages.at(-1), "text"), "newest");
  assert.equal(fieldOf(session.messages[0], "text"), "message 12");
});

test("the title bar names the chat, or says New chat when there is nothing yet", () => {
  const harness = createPanelHarness({ respond: answered("ok") });
  assert.equal(titleOf(harness), "New chat");
  harness.send("rename me");
  assert.equal(titleOf(harness), "rename me");
});

test("a chat started in this session is in the Chats view, under its title, the next time it is opened", () => {
  const harness = createPanelHarness({ respond: answered("Done.") });
  harness.send("a brand new chat");
  openChats(harness);
  assert.deepEqual(rowTitles(harness), ["a brand new chat"]);
  harness.click("chat-clear");
  harness.send("another one");
  openChats(harness);
  assert.deepEqual(rowTitles(harness).sort(), ["a brand new chat", "another one"]);
});

test("the Chats view lists earlier chats newest first with title, project and how long ago", () => {
  const harness = withSessions(
    [
      stored("s1", "Oldest", 3 * 86400000, { project: null }),
      stored("s2", "Newest", 5 * MINUTE),
      stored("s3", "Middle", 2 * 3600000, { project: "Other.aep" }),
    ],
    "s2",
  );
  openChats(harness);
  assert.equal(element(harness, "page").classList.has("open"), true);
  assert.equal(element(harness, "page-title").textContent, "Chats");
  assert.deepEqual(rowTitles(harness), ["Newest", "Middle", "Oldest"]);
  const subs = listRows(harness).map((row) => required(row.find((node) => node.classList.has("plan-sub"))).textContent);
  assert.deepEqual(subs, ["Fixture.aep · 1 message · 5 min ago", "Other.aep · 1 message · 2 h ago", "1 message · 3 d ago"]);
});

test("pressing an earlier chat opens it and makes it the current one", () => {
  const harness = withSessions(
    [
      stored("s1", "First chat", 5 * MINUTE, { texts: ["hello from one"] }),
      stored("s2", "Second chat", 9 * MINUTE, { texts: ["hello from two"] }),
    ],
    "s1",
  );
  openChats(harness);
  itemFor(harness, "Second chat").click();
  assert.ok(harness.requests.some((record) => record.method === "GET" && record.url.endsWith("/v1/ui/sessions/s2")));
  assert.equal(harness.sidecar.current, "s2");
  assert.equal(titleOf(harness), "Second chat");
  assert.match(output(harness).textContent, /hello from two/);
  assert.doesNotMatch(output(harness).textContent, /hello from one/);
  assert.ok(!element(harness, "page").classList.has("open"), "the Chats page closes so the opened chat is on screen");
});

test("Delete chat sits behind the row's menu and removes the chat in one press", () => {
  const harness = withSessions([stored("s1", "Keep me", MINUTE), stored("s2", "Drop me", 2 * MINUTE)], "s1");
  openChats(harness);
  const row = required(listRows(harness).find((entry) => entry.textContent.startsWith("Drop me")));
  assert.ok(
    row.all((node) => node.tagName === "BUTTON").every((node) => !["×", "!"].includes(node.textContent)),
    "no x or ! double-press control",
  );
  const pop = required(row.find((node) => node.classList.has("card-menu-pop")));
  assert.equal(pop.hidden, true);
  required(row.find((node) => node.classList.has("card-menu-btn"))).click();
  assert.equal(pop.hidden, false);
  assert.equal(buttonsNamed(row, "Delete chat").length, 1, "the menu names what it does");
  required(row.find((node) => node.classList.has("menu-row"))).click();
  assert.ok(harness.requests.some((record) => record.method === "DELETE" && record.url.endsWith("/v1/ui/sessions/s2")));
  assert.deepEqual(rowTitles(harness), ["Keep me"]);
  assert.equal(harness.sidecar.sessions.has("s2"), false);
});

test("deleting the chat on screen leaves a fresh empty chat", () => {
  const harness = withSessions([stored("s1", "Only chat", MINUTE, { texts: ["hello from one"] })], "s1");
  openChats(harness);
  required(nth(listRows(harness), 0).find((node) => node.classList.has("menu-row"))).click();
  assert.equal(titleOf(harness), "New chat");
  assert.doesNotMatch(output(harness).textContent, /hello from one/);
});

test("Clear history on the Chats page takes two presses and then deletes every saved chat", () => {
  const harness = withSessions([stored("s1", "One", MINUTE), stored("s2", "Two", 2 * MINUTE)], "s1");
  harness.click("benchmark-history-clear");
  assert.equal(element(harness, "benchmark-history-clear").textContent, "Press again to clear");
  assert.equal(harness.requests.filter((record) => record.method === "DELETE").length, 0, "the first press only arms it");
  harness.click("benchmark-history-clear");
  assert.equal(harness.requests.filter((record) => record.method === "DELETE" && record.url.endsWith("/v1/ui/sessions")).length, 1);
  assert.equal(harness.sidecar.sessions.size, 0);
  assert.equal(titleOf(harness), "New chat");
  assert.equal(element(harness, "benchmark-history-clear").textContent, "Clear history…");
});

test("New chat starts an empty chat, keeps the old one in the list, and closes the drawer", () => {
  const harness = createPanelHarness({ respond: answered("Done.") });
  harness.send("first chat message");
  const before = element(harness, "chat-message").focused;
  harness.click("chat-clear");
  assert.equal(titleOf(harness), "New chat");
  assert.equal(rowsOf(harness, "user").length, 0);
  assert.ok(element(harness, "chat-message").focused > before, "the composer is ready for the next message");
  assert.equal(element(harness, "page").classList.has("open"), false);
  assert.deepEqual(rowTitles(harness), ["first chat message"]);
  harness.send("second chat message");
  assert.equal(harness.sidecar.sessions.size, 2, "the new chat is a chat of its own");
});

test("a very long turn saves within the store's body limit and the archive keeps the whole reasoning", () => {
  const steps = Array.from({ length: 218 }, (_, index) => ({ step: index + 1, text: "x".repeat(8000), tools: ["ae_status"] }));
  const harness = createPanelHarness({ respond: answered("Done.", { reasoning: steps }) });
  harness.send("a very long job");
  const [session] = [...harness.sidecar.sessions.values()];
  const lastPut = required(putsTo(harness, required(session).id).at(-1));
  assert.ok(lastPut.body.length < 1024 * 1024, "the save body stays under the store's limit: " + lastPut.body.length);
  const kept = arrayOf(fieldOf(nth(required(session).messages, 1), "reasoning"));
  assert.equal(numberAt(kept.at(-1), "step"), 218);
  const logged = harness.requests.filter((record) => record.method === "POST" && record.url.endsWith("/v1/chat-logs")).map((record) => record.body.length);
  assert.ok(logged.some((size) => size > 1_700_000), "the automatic log still carries every step");
});
