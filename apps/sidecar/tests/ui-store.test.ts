/** The UI store: defaults, validation, the session bounds, atomic writes and recovery from a corrupt file. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { decode, type JsonValue } from "@extynt/decode";
import { DEFAULT_UI_PREFS, MAX_SESSION_BYTES, type UiMessage, type UiSession, type UiSessionInput } from "../src/ui-contract.js";
import { prefsPatch, sessionBody } from "../src/ui-decoders.js";
import { UiStore, autoApplyPolicyOf, uiStoreFor } from "../src/ui-store.js";

const directory = (): string => mkdtempSync(join(tmpdir(), "ae-ui-store-"));
const message = (text: string, extra: Readonly<Record<string, JsonValue>> = {}): UiMessage => ({ kind: "user", text, ...extra });
const session = (title: string, messages: readonly UiMessage[] = [message("hi")]): UiSessionInput => ({ title, project: null, messages });

function clocked(root: string): { store: UiStore; tick: () => number } {
  let now = 1_000;
  return { store: new UiStore(root, () => now), tick: () => { now += 10; return now; } };
}

function stored(store: UiStore, id: string): UiSession {
  const found = store.getSession(id);
  assert.ok(found, `session ${id} exists`);
  return found;
}

test("prefs default, validate and persist", () => {
  const root = directory();
  const { store } = clocked(root);
  assert.deepEqual(store.prefs(), DEFAULT_UI_PREFS);
  assert.deepEqual(DEFAULT_UI_PREFS, { askBeforeApplying: "risky", suggestPrompts: true, showThumbnails: true, rateLimit: true, diagnostics: false, language: "auto" });
  for (const bad of [{ unknown: true }, { askBeforeApplying: "sometimes" }, { diagnostics: "yes" }, [], null, "x", { rateLimit: 1 }, { language: "klingon" }, { language: "zh-Hant" }]) assert.equal(decode(prefsPatch, bad).ok, false, JSON.stringify(bad));
  assert.deepEqual(decode(prefsPatch, {}), { ok: true, value: {} });
  assert.equal(store.patchPrefs({ askBeforeApplying: "never", diagnostics: true }).askBeforeApplying, "never");
  const reopened = new UiStore(root, () => 0).prefs();
  assert.deepEqual(reopened, { ...DEFAULT_UI_PREFS, askBeforeApplying: "never", diagnostics: true });
  assert.equal(autoApplyPolicyOf(reopened), "never");
});

test("the 21st session evicts the least recently updated one that is not current", () => {
  const { store, tick } = clocked(directory());
  for (let index = 0; index < 20; index += 1) { tick(); assert.ok(store.putSession(`s${index}`, session(`S${index}`)).ok); }
  assert.ok(store.setCurrentSessionId("s0").ok);
  tick();
  assert.ok(store.putSession("s20", session("S20")).ok);
  const ids = store.listSessions().map((entry) => entry.id);
  assert.equal(ids.length, 20);
  assert.ok(ids.includes("s0") && ids.includes("s20"));
  assert.equal(ids.includes("s1"), false);
  assert.equal(ids[0], "s20");
  assert.equal(store.currentSessionId(), "s0");
});

test("a session keeps its newest 60 messages and its createdAt", () => {
  const { store, tick } = clocked(directory());
  const messages = Array.from({ length: 61 }, (_unused, index) => message(`m${index}`));
  const first = store.putSession("long", session("Long", messages));
  assert.ok(first.ok);
  const kept = stored(store, "long");
  assert.equal(kept.messages.length, 60);
  assert.equal(kept.messages[0]?.text, "m1");
  tick();
  const again = store.putSession("long", { ...session("Renamed"), createdAt: 5 });
  assert.ok(again.ok);
  assert.equal(stored(store, "long").createdAt, kept.createdAt);
  assert.ok(stored(store, "long").updatedAt > kept.updatedAt);
});

test("an oversize session drops its oldest messages and a single huge message is refused", () => {
  const { store } = clocked(directory());
  const big = (label: string) => message(`${label}${"x".repeat(100_000)}`);
  const result = store.putSession("big", session("Big", Array.from({ length: 10 }, (_unused, index) => big(`m${index}-`))));
  assert.ok(result.ok);
  const kept = stored(store, "big");
  assert.ok(Buffer.byteLength(JSON.stringify(kept)) <= MAX_SESSION_BYTES);
  assert.ok(kept.messages.length >= 1 && kept.messages.length < 10);
  assert.ok(String(kept.messages.at(-1)?.text).startsWith("m9-"));
  const refused = store.putSession("huge", session("Huge", [message("ok", { blob: "y".repeat(MAX_SESSION_BYTES) })]));
  assert.equal(refused.ok, false);
  assert.equal(!refused.ok && refused.status, 413);
  assert.equal(!refused.ok && refused.code, "UI_SESSION_TOO_LARGE");
  assert.equal(store.getSession("huge"), null);
});

test("a session body that does not fit the contract is refused by its decoder", () => {
  let deep: JsonValue = "leaf";
  for (let level = 0; level < 40; level += 1) deep = { deeper: deep };
  const base = { title: "T", project: null, messages: [{ kind: "user", text: "hi" }] };
  const cases: JsonValue[] = [
    { ...base, title: "t".repeat(201) }, { ...base, project: "p".repeat(301) }, { ...base, createdAt: -1 },
    { ...base, messages: [{ kind: "user" }] }, { ...base, messages: [{ kind: "k".repeat(33), text: "x" }] }, { ...base, messages: [{ kind: "user", text: "x".repeat(200_001) }] },
    { ...base, messages: [{ kind: "user", text: "x", deep }] }, { ...base, messages: "nope" }, [1, 2], null,
  ];
  for (const body of cases) assert.equal(decode(sessionBody, body).ok, false, JSON.stringify(body)?.slice(0, 80));
  assert.equal(decode(sessionBody, base).ok, true);
});

test("a session stored under an id that is not a valid id is refused", () => {
  const { store } = clocked(directory());
  const refused = store.putSession("bad id!", session("T"));
  assert.equal(!refused.ok && refused.status, 422);
  assert.equal(store.listSessions().length, 0);
});

test("deleting, clearing and choosing the current session", () => {
  const { store } = clocked(directory());
  store.putSession("a", session("A"));
  store.putSession("b", session("B"));
  assert.ok(store.setCurrentSessionId("a").ok);
  const missing = store.setCurrentSessionId("zzz");
  assert.equal(!missing.ok && missing.status, 404);
  assert.equal(store.deleteSession("a"), true);
  assert.equal(store.deleteSession("a"), false);
  assert.equal(store.currentSessionId(), null);
  assert.ok(store.setCurrentSessionId("b").ok);
  store.clearSessions();
  assert.deepEqual([store.listSessions(), store.currentSessionId()], [[], null]);
});

test("writes are atomic and a stray temp file from a crash is ignored", () => {
  const root = directory();
  const { store } = clocked(root);
  store.putSession("a", session("A"));
  store.setCurrentSessionId("a");
  store.patchPrefs({ suggestPrompts: false });
  assert.deepEqual(readdirSync(root).sort(), ["ui-prefs.json", "ui-sessions.json"]);
  if (process.platform !== "win32") assert.equal(statSync(join(root, "ui-sessions.json")).mode & 0o777, 0o600);
  writeFileSync(join(root, "ui-sessions.json.4242.deadbeef.tmp"), "{ torn");
  const reopened = new UiStore(root, () => 0);
  assert.equal(reopened.currentSessionId(), "a");
  assert.equal(reopened.getSession("a")?.title, "A");
  assert.equal(reopened.prefs().suggestPrompts, false);
  assert.equal(readdirSync(root).some((name) => name.includes("corrupt")), false);
});

test("a corrupt file is set aside and the store starts empty", () => {
  const root = directory();
  writeFileSync(join(root, "ui-sessions.json"), "{ not json");
  writeFileSync(join(root, "ui-prefs.json"), JSON.stringify({ askBeforeApplying: "nonsense" }));
  const reopened = new UiStore(root, () => Date.parse("2026-10-04T00:00:00Z"));
  assert.deepEqual(reopened.listSessions(), []);
  assert.deepEqual(reopened.prefs(), DEFAULT_UI_PREFS);
  const aside = readdirSync(root).filter((name) => name.includes(".corrupt-"));
  assert.equal(aside.length, 2);
  const sessionsAside = aside.find((name) => name.startsWith("ui-sessions.json"));
  assert.equal(readFileSync(join(root, sessionsAside ?? ""), "utf8"), "{ not json");
  assert.match(sessionsAside ?? "", /^ui-sessions\.json\.corrupt-2026-10-04T00-00-00-000Z$/);
  assert.ok(reopened.putSession("fresh", session("Fresh")).ok);
});

test("uiStoreFor returns one store per state", () => {
  const first = { options: { token: "t", stateDirectory: directory() }, now: () => new Date(0) };
  const second = { options: { token: "t", stateDirectory: directory() }, now: () => new Date(0) };
  assert.equal(uiStoreFor(first), uiStoreFor(first));
  assert.notEqual(uiStoreFor(first), uiStoreFor(second));
});
