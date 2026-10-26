/**
 * Panel contract: "Paused after N steps — Continue". A long job that stops at the automatic window cap makes the status bar
 * amber with the one Continue, instead of asking the user to type the word or drawing a card with its own button. The press is
 * the typed word through the normal send, naming the job the pause belonged to; it sends once, is not offered while a turn
 * runs, and is gone once anything newer has been said.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { StubElement, createPanelHarness, type StubResponse } from "./contract.test.js";
import { bar, barButton, bodyOf, buttonsNamed, openSheet } from "./contract-helpers.js";
import { type JsonObject, type JsonValue } from "@extynt/decode";
import { fieldOf } from "./json-narrow.js";

const PAUSE = { kind: "window-cap", steps: 8, jobId: "job-A" };
const CAP_TEXT =
  "This workflow already ran 8 authoring cycles on its own, so extynt stopped to avoid spending more without your say-so. Applied work is kept. Reply 'continue' to keep going.";
const reply = (extra: JsonObject): StubResponse => ({ status: 200, text: JSON.stringify({ ok: true, ...extra }) });
const pausedReply = (pause: JsonValue = PAUSE): StubResponse =>
  reply({ outcome: "failed", answer: CAP_TEXT, failure: { code: "WORKFLOW_CYCLE_LIMIT", message: CAP_TEXT }, pause });
const answered = (): StubResponse => reply({ outcome: "answered", answer: "Done." });

interface Chat {
  id: string;
  title: string;
  messages: Array<JsonObject>;
}
interface World {
  harness: ReturnType<typeof createPanelHarness>;
  bodies: Array<JsonObject>;
  status: { pause: JsonValue };
  composer: StubElement;
  output: () => StubElement;
}
interface Setup {
  chats?: Chat[];
  current?: string;
  pauseAtBoot?: JsonValue;
}

function world(replies: StubResponse[], setup: Setup = {}): World {
  const bodies: Array<JsonObject> = [];
  const status = { pause: setup.pauseAtBoot ?? null };
  const harness = createPanelHarness({
    sidecar: (fake) => {
      const at = Date.now();
      for (const chat of setup.chats ?? [])
        fake.sessions.set(chat.id, {
          id: chat.id,
          title: chat.title,
          project: null,
          createdAt: at,
          updatedAt: at,
          messages: chat.messages.map((row, index) => ({ at: at + index, ...row })),
        });
      fake.current = setup.current ?? setup.chats?.[0]?.id ?? null;
    },
    respond: (record) => {
      if (record.url.endsWith("/v1/chat") && record.method === "POST") {
        bodies.push(bodyOf(record));
        return replies.shift() ?? answered();
      }
      if (record.url.includes("/v1/workflow/status"))
        return {
          status: 200,
          text: JSON.stringify({ ok: true, projection: { jobs: [], batches: [] }, resume: null, pause: status.pause }),
        };
      return undefined;
    },
  });
  const composer = harness.el("chat-message");
  assert.ok(composer, "the composer exists");
  return { harness, bodies, status, composer, output: () => harness.el("chat-output") ?? harness.body() };
}

const send = (w: World, text: string): void => {
  w.composer.value = text;
  w.harness.click("chat");
};
const poll = (w: World): number => w.harness.runIntervals((timer) => timer.ms === 10000);
const continueButtons = (w: World): StubElement[] =>
  w.harness.body().all((node) => node.tagName === "BUTTON" && node.textContent === "Continue");
const pausedBar = (w: World): string => (bar(w.harness).state === "needs-you" ? bar(w.harness).text : "");
const only = (nodes: StubElement[]): StubElement => {
  assert.equal(nodes.length, 1, "exactly one");
  const [first] = nodes;
  assert.ok(first);
  return first;
};

const PAUSE_ROW = {
  kind: "assistant",
  text: "extynt stopped here instead of spending more without your say-so. Applied work is kept.",
  failed: true,
  pause: PAUSE,
};
const USER_ROW = { kind: "user", text: "animate the title" };
const chat = (messages: Array<JsonObject>, id = "s1", title = "Long job"): Chat => ({ id, title, messages });

test("a turn that ends paused at the cap makes the bar amber: how many steps, and the one Continue, not the line asking to type it", () => {
  const w = world([pausedReply()]);
  send(w, "animate the whole sequence");
  assert.equal(pausedBar(w), "Paused after 8 steps");
  assert.equal(bar(w.harness).tone, "amber");
  const button = only(continueButtons(w));
  assert.equal(button, barButton(w.harness, "continue"), "the button is the bar's");
  assert.equal(button.disabled, false);
  assert.equal(button.className.split(" ")[0], "primary", "the one action is the primary one");
  assert.doesNotMatch(w.output().textContent, /Reply 'continue'/, "the button replaces the typed instruction");
  assert.equal(buttonsNamed(w.output(), "Continue").length, 0, "the thread has no card with its own button");
  assert.ok(
    w.output().all((node) => node.className === "msg assistant").length >= 1 &&
      w.output().all((node) => node.className === "msg error").length === 0,
    "a pause is not drawn as an error",
  );
  assert.match(openSheet(w.harness).textContent, /Paused after 8 steps/, "the sheet's Waiting section holds the detail");
});

test("a sidecar that reports no pause keeps the typed instruction and gets no button", () => {
  const w = world([reply({ outcome: "failed", answer: CAP_TEXT, failure: { code: "WORKFLOW_CYCLE_LIMIT", message: CAP_TEXT } })]);
  send(w, "animate the whole sequence");
  assert.match(w.output().textContent, /Reply 'continue' to keep going\./);
  assert.equal(continueButtons(w).length, 0);
  const odd = world([
    pausedReply({ kind: "something-else", steps: 8, jobId: "job-A" }),
    pausedReply({ kind: "window-cap", steps: 0, jobId: "job-A" }),
    pausedReply({ kind: "window-cap", steps: 8, jobId: "../x" }),
  ]);
  for (const text of ["one", "two", "three"]) send(odd, text);
  assert.equal(continueButtons(odd).length, 0, "an unreadable pause never makes a button");
});

test("clicking Continue sends the word once, naming the paused job, and leaves the draft alone", () => {
  const w = world([pausedReply()]);
  send(w, "animate the whole sequence");
  const button = only(continueButtons(w));
  w.composer.value = "a half-typed idea";
  button.click();
  assert.equal(w.bodies.length, 2, "one more chat request");
  assert.equal(fieldOf(w.bodies[1], "message"), "continue", "the same word typing it sends");
  assert.equal(fieldOf(w.bodies[1], "continueJobId"), "job-A", "the job this card was drawn for");
  assert.equal(w.composer.value, "a half-typed idea", "the draft is put back");
  assert.match(w.output().textContent, /continue/);
  button.click();
  button.click();
  assert.equal(w.bodies.length, 2, "the card cannot send again");
  assert.equal(continueButtons(w).length, 0, "and its button is gone");
  assert.equal(pausedBar(w), "", "the pause is history");
});

test("typing continue still works, sends no job, and retires the button", () => {
  const w = world([pausedReply()]);
  send(w, "animate the whole sequence");
  assert.equal(continueButtons(w).length, 1);
  send(w, "continue");
  assert.equal(w.bodies.length, 2);
  assert.equal(fieldOf(w.bodies[1], "message"), "continue");
  assert.equal(
    "continueJobId" in (w.bodies[1] ?? {}),
    false,
    "typed words carry no job; the sidecar picks the latest paused one as before",
  );
  assert.equal(continueButtons(w).length, 0);
});

test("saying anything else retires the button of the card that came before", () => {
  const w = world([pausedReply()]);
  send(w, "animate the whole sequence");
  assert.equal(continueButtons(w).length, 1);
  send(w, "actually make the title blue");
  assert.equal(continueButtons(w).length, 0);
  assert.equal(w.bodies.length, 2);
});

test("a card from an earlier conversation point has no button when it is reopened, and the latest one does", () => {
  const stale = world([], {
    chats: [chat([USER_ROW, PAUSE_ROW, { kind: "user", text: "make the title blue" }, { kind: "assistant", text: "Done." }])],
  });
  assert.equal(continueButtons(stale).length, 0, "newer words were said after this pause");
  assert.equal(pausedBar(stale), "");
  const latest = world([], { chats: [chat([USER_ROW, PAUSE_ROW])] });
  const button = only(continueButtons(latest));
  button.click();
  assert.equal(fieldOf(latest.bodies[0], "continueJobId"), "job-A");
  assert.equal(fieldOf(latest.bodies[0], "message"), "continue");
});

test("while a turn is running Continue is not offered, and is back when it ends", () => {
  const second = chat([{ kind: "user", text: "hello" }], "s2", "Other chat");
  const w = world([{ hold: true }], { chats: [chat([USER_ROW, PAUSE_ROW]), second], current: "s2" });
  send(w, "do another thing");
  assert.equal(w.bodies.length, 1);
  w.harness.click("chat-title");
  const back = w.harness.el("sessions-list")?.find((node) => node.tagName === "BUTTON" && node.textContent.startsWith("Long job"));
  assert.ok(back, "the paused chat is listed");
  back.click();
  assert.equal(continueButtons(w).length, 0, "a turn is running: the bar is the working bar");
  assert.equal(bar(w.harness).state, "working");
  assert.equal(w.bodies.length, 1, "nothing else was sent");
  const held = w.harness.held().filter((xhr) => xhr.url.endsWith("/v1/chat"))[0];
  assert.ok(held);
  held.respond(200, JSON.stringify({ ok: true, outcome: "answered", answer: "Done." }));
  assert.equal(only(continueButtons(w)).disabled, false, "the turn ended");
  only(continueButtons(w)).click();
  assert.equal(w.bodies.length, 2);
  assert.equal(fieldOf(w.bodies[1], "continueJobId"), "job-A");
});

test("when the sidecar says the job is no longer paused, nothing continues and the reader is told", () => {
  const w = world(
    [
      reply({
        outcome: "failed",
        answer: "I couldn't start this workflow: That job is no longer paused at the step limit, so nothing was continued.",
        failure: { code: "PAUSE_STALE", message: "That job is no longer paused at the step limit, so nothing was continued." },
      }),
    ],
    { chats: [chat([USER_ROW, PAUSE_ROW])] },
  );
  only(continueButtons(w)).click();
  assert.equal(w.bodies.length, 1);
  assert.match(w.output().textContent, /no longer paused/);
  assert.equal(continueButtons(w).length, 0);
});

test("a job that stops at the cap in the background gets its Continue from the status poll, once, and not for an old pause", () => {
  const old = world([], { pauseAtBoot: { kind: "window-cap", steps: 4, jobId: "job-OLD" } });
  poll(old);
  poll(old);
  assert.equal(pausedBar(old), "", "a pause that was already there when the panel opened is not replayed into a new chat");

  const w = world([]);
  poll(w);
  assert.equal(pausedBar(w), "", "nothing paused yet");
  w.status.pause = { kind: "window-cap", steps: 12, jobId: "job-B" };
  poll(w);
  assert.equal(pausedBar(w), "Paused after 12 steps");
  poll(w);
  poll(w);
  assert.equal(
    w
      .output()
      .all(
        (node) => node.className === "msg assistant failed" || (node.classList.has("assistant") && /stopped here/.test(node.textContent)),
      ).length,
    1,
    "polling again does not add another line",
  );
  only(continueButtons(w)).click();
  assert.equal(w.bodies.length, 1);
  assert.equal(fieldOf(w.bodies[0], "continueJobId"), "job-B");
  assert.equal(fieldOf(w.bodies[0], "message"), "continue");
});

test("the status is read once at boot and then every ten seconds", () => {
  const w = world([]);
  const reads = (): number => w.harness.requestsTo("/v1/workflow/status").length;
  assert.equal(reads(), 1, "one read at boot");
  assert.equal(
    w.harness.runIntervals((timer) => timer.ms === 10000),
    1,
    "one ten-second poll is running",
  );
  assert.equal(reads(), 2);
});
