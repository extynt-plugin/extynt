/** The chat history and model-settings routes: what each refuses, the project logs and the guards that need a settings file. */
import { decodeOrThrow, jsonValue, type JsonValue } from "@extynt/decode";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { maybeTextOf, parseJson, numberOf } from "./http-json.js";
import { authorization, sidecarFor, token } from "./sidecar-fixture.js";

type Test = { after: (fn: () => void | Promise<void>) => void };

async function start(t: Test): Promise<{ root: string; call: (method: string, path: string, body?: string) => Promise<{ status: number; json: JsonValue }> }> {
  const root = mkdtempSync(join(tmpdir(), "extynt-history-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sidecar = sidecarFor({ port: 0, token, stateDirectory: root, quietAgentLog: true, now: () => new Date("2026-09-22T12:00:00.000Z") });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const call = async (method: string, path: string, body?: string) => {
    const response = await fetch(`http://${address.host}:${address.port}${path}`, { method, headers: { ...authorization, "content-type": "application/json" }, ...(body === undefined ? {} : { body }) });
    return { status: response.status, json: decodeOrThrow(jsonValue, parseJson(await response.text())) };
  };
  return { root, call };
}

const PROJECT_ID = "a".repeat(64);
const link = { schemaVersion: "extynt.project-link/1", projectId: PROJECT_ID, kind: "saved", stem: `saved-${PROJECT_ID}`, databaseFile: `saved-${PROJECT_ID}.extynt`, chatLogFile: `saved-${PROJECT_ID}.jsonl` };
const batchOf = (events: JsonValue[]) => ({ schemaVersion: "extynt.chat-log/0.1", sessionId: " session-1 ", name: "Badge", events });
const message = (eventId: string, data: JsonValue) => ({ type: "message", eventId, revision: 1, data });

test("a chat-log batch that is not valid is refused as one kind of mistake", async (t) => {
  const { call } = await start(t);
  const valid = message("m1", { text: "hi" });
  const bad = [
    "not json", JSON.stringify(batchOf([])), JSON.stringify({ ...batchOf([valid]), schemaVersion: "other" }), JSON.stringify({ ...batchOf([valid]), sessionId: "  " }),
    JSON.stringify(batchOf([{ ...valid, revision: 0 }])), JSON.stringify(batchOf([{ ...valid, eventId: "has space" }])), JSON.stringify(batchOf([{ ...valid, type: "other" }])),
    JSON.stringify(batchOf([message("m1", { projectLinks: [{ ...link, stem: "saved-other" }] })])), JSON.stringify(batchOf([message("m1", { projectLinks: "no" })])),
  ];
  for (const body of bad) {
    const refused = await call("POST", "/v1/chat-logs", body);
    assert.equal(refused.status, 422, body.slice(0, 80));
    assert.equal(maybeTextOf(refused.json, "error.code"), "INVALID_CHAT_LOG");
  }
});

test("a message that names a project is also logged in that project's file, once", async (t) => {
  const { root, call } = await start(t);
  const body = JSON.stringify(batchOf([message("m1", { text: "hi", projectLinks: [link, link] }), { type: "session", eventId: "session", revision: 1, data: { projectLinks: [link] } }]));
  const first = await call("POST", "/v1/chat-logs", body);
  assert.equal(first.status, 200);
  assert.equal(numberOf(first.json, "accepted"), 2);
  assert.equal(numberOf(first.json, "projectAccepted"), 1, "duplicate links collapse and a session record has no project row");
  assert.equal(numberOf((await call("POST", "/v1/chat-logs", body)).json, "projectAccepted"), 0);
  const rows = readFileSync(join(root, "chat-logs", "projects", link.chatLogFile), "utf8").trim().split("\n");
  assert.equal(rows.length, 1);
  assert.equal(maybeTextOf(parseJson(rows[0] ?? ""), "sessionId"), "session-1", "the session id is stored trimmed");
});

test("an export needs an absolute .jsonl path outside the archive and never follows an alias", async (t) => {
  const { root, call } = await start(t);
  await call("POST", "/v1/chat-logs", JSON.stringify(batchOf([message("m1", { text: "hi" })])));
  const refused = async (destination: JsonValue, pattern: string) => {
    const response = await call("POST", "/v1/chat-logs/export", JSON.stringify({ destination }));
    assert.equal(response.status, 422);
    assert.equal(maybeTextOf(response.json, "error.code"), "INVALID_CHAT_EXPORT_PATH");
    assert.match(maybeTextOf(response.json, "error.message") ?? "", new RegExp(pattern));
  };
  await refused("relative.jsonl", "absolute .jsonl");
  await refused(join(root, "notes.txt"), "absolute .jsonl");
  await refused(7, "absolute .jsonl");
  await refused(join(root, "chat-logs", "copy.jsonl"), "cannot overwrite extynt's automatic chat archive");
  mkdirSync(join(root, "elsewhere"));
  const written = await call("POST", "/v1/chat-logs/export", JSON.stringify({ destination: join(root, "elsewhere", "all.jsonl") }));
  assert.equal(written.status, 200);
  assert.equal(numberOf(written.json, "sessions"), 1);
  const failed = await call("POST", "/v1/chat-logs/export", JSON.stringify({ destination: join(root, "missing-folder", "all.jsonl") }));
  assert.equal(failed.status, 500);
  assert.equal(maybeTextOf(failed.json, "error.code"), "CHAT_EXPORT_FAILED");
  assert.equal(existsSync(join(root, "missing-folder")), false);
});

test("a steering message is checked before it joins a turn", async (t) => {
  const { call } = await start(t);
  const code = async (body: string) => { const response = await call("POST", "/v1/chat/steer", body); return [response.status, maybeTextOf(response.json, "error.code")]; };
  assert.deepEqual(await code("not json"), [400, "INVALID_JSON"]);
  assert.deepEqual(await code(""), [422, "INVALID_STEER"]);
  assert.deepEqual(await code("[]"), [422, "INVALID_STEER"]);
  assert.deepEqual(await code(JSON.stringify({ requestId: "r1", message: "   " })), [422, "INVALID_STEER"]);
  assert.deepEqual(await code(JSON.stringify({ requestId: "r1", message: "go on" })), [409, "NO_RUNNING_TURN"]);
  assert.deepEqual(await code(JSON.stringify({ requestId: "r1", message: "x".repeat(5000) })), [400, "INVALID_JSON"]);
});

test("the settings routes answer 404 when the sidecar has no settings file, and the connectivity check reads a blank body", async (t) => {
  const { call } = await start(t);
  for (const [method, path] of [["GET", "/v1/settings/model"], ["POST", "/v1/settings/model"], ["GET", "/v1/settings/model/catalog"], ["POST", "/v1/settings/model/catalog"]] as const) {
    const response = await call(method, path, method === "POST" ? "{" : undefined);
    assert.equal(response.status, 404, `${method} ${path}`);
    assert.equal(maybeTextOf(response.json, "error.code"), "SETTINGS_UNAVAILABLE");
  }
  const check = await call("POST", "/v1/settings/model/test", "{ broken");
  assert.equal(check.status, 200);
  assert.equal(maybeTextOf(check.json, "error.code"), "LLM_NOT_CONFIGURED");
  const efforts = await call("GET", "/v1/settings/model/efforts?slot=fallback");
  assert.equal(efforts.status, 422);
  assert.equal(maybeTextOf(efforts.json, "error.code"), "LLM_NOT_CONFIGURED");
});
