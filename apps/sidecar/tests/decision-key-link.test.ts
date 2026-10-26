// The key page: a failed test keeps the link and writes nothing, a good key writes once and shows the confirmation, other origins and expiry are refused, and no key reaches a response or a log.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { boolean, decodeOrThrow, object, optional, string } from "@extynt/decode";
import { createKeyLinks, KEY_LINK_ATTEMPTS, KEY_LINK_LIFETIME_MS } from "../src/decision-link.js";
import { loadLlmEnvFile } from "../src/llm-env-file.js";
import { decisionRig, type DecisionRig } from "./decision-fixture.js";

const SECRET = "sk-test-9f3a77c1d2";
const linkReply = object({ ok: boolean(), url: string(), expiresAt: string(), panelNotified: boolean() });
const attemptReply = object({ ok: boolean(), next: optional(string()), receipt: optional(string()) });
const JSON_HEADERS = { "content-type": "application/json", accept: "application/json" };

async function issue(rig: DecisionRig): Promise<string> {
  const answer = await rig.call("POST", "/v1/settings/decision/link", "{}");
  const reply = decodeOrThrow(linkReply, JSON.parse(answer.text));
  assert.match(reply.url, /^http:\/\/127\.0\.0\.1:\d+\/decision-key\/[A-Za-z0-9_-]{20,}$/);
  return new URL(reply.url).pathname;
}

const attempt = (rig: DecisionRig, path: string, headers: Readonly<Record<string, string>> = {}) =>
  rig.open("POST", path, { body: JSON.stringify({ provider: "jev", apiKey: SECRET }), headers: { ...JSON_HEADERS, ...headers } });

test("the form is a page with one script, and a good key is saved once and confirmed", async (t) => {
  const rig = await decisionRig(t, { modelAnswers: true });
  const path = await issue(rig);
  const page = await rig.open("GET", path);
  assert.equal(page.status, 200);
  assert.match(page.text, /type="password"/);
  const reply = decodeOrThrow(attemptReply, JSON.parse((await attempt(rig, path)).text));
  assert.deepEqual(reply, { ok: true, next: path });
  assert.equal(loadLlmEnvFile(rig.filePath).TYPESAFE_API_KEY, SECRET);
  const confirmation = await rig.open("GET", path);
  assert.equal(confirmation.status, 200);
  assert.match(confirmation.text, /test ok/);
  assert.equal((await attempt(rig, path)).status, 410);
  assert.equal(confirmation.text.includes(SECRET), false);
});

test("a failed test shows the receipt line, writes nothing and keeps the link usable", async (t) => {
  const rig = await decisionRig(t);
  const path = await issue(rig);
  const failed = await attempt(rig, path);
  assert.equal(failed.status, 422);
  const reply = decodeOrThrow(attemptReply, JSON.parse(failed.text));
  assert.equal(reply.ok, false);
  assert.match(reply.receipt ?? "", /test failed/);
  assert.deepEqual(loadLlmEnvFile(rig.filePath), {});
  assert.equal((await rig.open("GET", path)).status, 200);
  assert.equal((await attempt(rig, path)).status, 422);
});

test("a link takes ten tries and then stops", async (t) => {
  const rig = await decisionRig(t);
  const path = await issue(rig);
  for (let tries = 0; tries < KEY_LINK_ATTEMPTS; tries += 1) assert.equal((await attempt(rig, path)).status, 422);
  assert.equal((await attempt(rig, path)).status, 410);
});

test("a post from another origin is refused and costs no try", async (t) => {
  const rig = await decisionRig(t, { modelAnswers: true });
  const path = await issue(rig);
  assert.equal((await attempt(rig, path, { origin: "https://evil.example" })).status, 403);
  assert.equal((await attempt(rig, path, { "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await attempt(rig, path, { origin: rig.base })).status, 200);
});

test("an unknown link is the same form switched off, and a post without script still works", async (t) => {
  const rig = await decisionRig(t, { modelAnswers: true });
  const gone = await rig.open("GET", "/decision-key/not-a-link");
  assert.equal(gone.status, 410);
  assert.match(gone.text, /<fieldset disabled>/);
  const path = await issue(rig);
  const plain = await rig.open("POST", path, { body: `provider=jev&apiKey=${SECRET}`, headers: { "content-type": "application/x-www-form-urlencoded" } });
  assert.equal(plain.status, 200);
  assert.match(plain.text, /test ok/);
});

test("the key appears in no response, event or log line, and the token is not logged", async (t) => {
  const rig = await decisionRig(t);
  const path = await issue(rig);
  const failed = await attempt(rig, path);
  const state = await rig.call("GET", "/v1/settings/decision");
  for (const text of [failed.text, state.text, ...rig.logs]) assert.equal(text.includes(SECRET), false);
  assert.ok(rig.logs.length > 0);
  assert.equal(rig.logs.some((line) => line.includes(path.split("/").pop() ?? "")), false);
});

test("a link request tells a connected panel to open its section, and a save tells it things changed", async (t) => {
  const rig = await decisionRig(t, { modelAnswers: true });
  const path = await issue(rig);
  assert.deepEqual(rig.events, [{ type: "decision", reason: "open" }]);
  await attempt(rig, path);
  assert.deepEqual(rig.events.map((event) => event.reason), ["open", "changed"]);
  assert.match(readFileSync(rig.filePath, "utf8"), /TYPESAFE_API_KEY/);
});

test("links expire after ten minutes and the store holds a handful", () => {
  let now = 1_000;
  const links = createKeyLinks(() => now);
  const first = links.issue("jev");
  assert.notEqual(links.peek(first.token), null);
  now += KEY_LINK_LIFETIME_MS;
  assert.equal(links.peek(first.token), null);
  assert.equal(links.attempt(first.token), false);
  const issued = Array.from({ length: 12 }, () => links.issue(null).token);
  assert.equal(links.peek(issued[0] ?? ""), null);
  assert.notEqual(links.peek(issued[11] ?? ""), null);
});
