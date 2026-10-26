/** Panel contract: a running turn writes into the chat that started it, whichever chat the reader has open. */
import assert from "node:assert/strict";
import test from "node:test";
import { bar, chatBodies, element, firstAnswer, holdChat, nth, output, progressResponder, required, typeInComposer } from "./contract-helpers.js";
import { MINUTE, activityLog, itemFor, listRows, openChats, stored, withSessions } from "./contract-sessions-fixtures.js";
import type { PanelHarness } from "./contract.test.js";
import { fieldOf, readJson, recordsAt, textAt } from "./json-narrow.js";
import { type JsonObject } from "@extynt/decode";

type World = { harness: PanelHarness; turnRequestId: () => string };

function turnInFirstChat(): World {
  const progress = progressResponder((requestId) => ({
    requestId,
    label: "Reading the composition",
    step: 2,
    usage: { totalTokens: 5200 },
  }));
  const harness = withSessions(
    [
      stored("s1", "First chat", 5 * MINUTE, { texts: ["hello from one", "hi"] }),
      stored("s2", "Second chat", 9 * MINUTE, { texts: ["hello from two"] }),
    ],
    "s1",
    firstAnswer(progress, holdChat),
  );
  typeInComposer(harness, "animate the title");
  harness.click("chat");
  harness.runIntervals((timer) => timer.ms === 900);
  return { harness, turnRequestId: () => String(fieldOf(nth(chatBodies(harness), 0), "requestId")) };
}

function answerHeld(world: World, extra: JsonObject): void {
  const xhr = required(world.harness.held().find((entry) => entry.url.endsWith("/v1/chat")));
  xhr.respond(200, JSON.stringify({ ok: true, outcome: "answered", answer: "Done.", requestId: world.turnRequestId(), ...extra }));
}

test("a turn keeps writing into the chat that started it while the reader looks at another", () => {
  const world = turnInFirstChat(),
    { harness } = world;
  const composer = element(harness, "chat-message");
  openChats(harness);
  itemFor(harness, "Second chat").click();
  assert.equal(harness.sidecar.current, "s2");
  assert.match(output(harness).textContent, /hello from two/);
  assert.doesNotMatch(output(harness).textContent, /hello from one|animate the title|Reading the composition/);
  assert.match(composer.title, /Steers the turn running in “First chat”\. Stop is in the status bar\./);
  assert.equal(bar(harness).text, "Reading the composition", "the bar follows the turn wherever the reader looks");
  assert.equal(bar(harness).state, "working");
  assert.equal(
    fieldOf(required(required(harness.sidecar.sessions.get("s1")).messages.at(-1)), "text"),
    "animate the title",
    "the message is in the chat that sent it",
  );
  answerHeld(world, {});
  const first = required(harness.sidecar.sessions.get("s1")).messages,
    second = required(harness.sidecar.sessions.get("s2")).messages;
  assert.equal(
    first.filter((row) => fieldOf(row, "kind") === "assistant" && fieldOf(row, "text") === "Done.").length,
    1,
    "the answer lands in the chat that asked",
  );
  assert.equal(second.filter((row) => fieldOf(row, "kind") === "assistant").length, 0, "and not in the one on screen");
  assert.equal(bar(harness).state, "idle", "the turn is over");
  itemFor(harness, "First chat").click();
  assert.match(output(harness).textContent, /animate the title/);
  assert.match(output(harness).textContent, /Done\./);
});

test("the chat a turn is running in cannot be deleted from under it", () => {
  const { harness } = turnInFirstChat();
  openChats(harness);
  required(
    required(listRows(harness).find((row) => row.textContent.startsWith("First chat"))).find((node) => node.classList.has("menu-row")),
  ).click();
  assert.match(activityLog(harness), /That chat has a turn running\. Wait for it, or press Stop first\./);
  assert.equal(harness.requests.filter((record) => record.method === "DELETE").length, 0);
  assert.ok(harness.sidecar.sessions.has("s1"));
});

test("project links in the reply attach to that turn's rows in the chat that asked, and to the archive", () => {
  const world = turnInFirstChat(),
    { harness } = world,
    links = [{ kind: "saved", name: "Intro.aep" }];
  openChats(harness);
  itemFor(harness, "Second chat").click();
  answerHeld(world, { projectLinks: links });
  const rows = required(harness.sidecar.sessions.get("s1")).messages.filter((row) => fieldOf(row, "requestId") === world.turnRequestId());
  assert.equal(rows.length, 2, "the user row and the answer row");
  assert.ok(rows.every((row) => JSON.stringify(fieldOf(row, "projectLinks")) === JSON.stringify(links)));
  assert.ok(required(harness.sidecar.sessions.get("s2")).messages.every((row) => fieldOf(row, "projectLinks") === undefined));
  const linked = harness
    .requestsTo("/v1/chat-logs")
    .map((record) => readJson(record.body))
    .flatMap((batch) =>
      recordsAt(batch, "events")
        .filter((event) => fieldOf(event, "data", "projectLinks"))
        .map(() => textAt(batch, "sessionId")),
    );
  assert.ok(linked.length >= 2 && linked.every((id) => id === "s1"));
});

test("a reply whose request id is not the turn's cannot attach project links to either row", () => {
  const world = turnInFirstChat(),
    { harness } = world;
  answerHeld(world, { requestId: "wrong-request", projectLinks: [{ kind: "saved" }] });
  const messages = required(harness.sidecar.sessions.get("s1")).messages;
  assert.ok(messages.every((row) => fieldOf(row, "projectLinks") === undefined));
  assert.ok(messages.every((row) => fieldOf(row, "requestId") !== "wrong-request"));
});
