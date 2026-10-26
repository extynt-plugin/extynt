/** The persisted layer-details store: what it keeps, what it refuses to reuse, and what it does with a file it cannot trust. */
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DETAIL_KINDS, KEY_DIGEST_FORMAT } from "../src/native-snapshot/index.js";
import { createDetailsStore, DETAILS_STORE_FILE, DETAILS_STORE_FORMAT, MAX_BYTES, MAX_ENTRIES, MAX_ENTRY_BYTES, parseStore, type DetailsStore, type LayerAsk } from "../src/host/details-store.js";
import { witnessHolds, type Witness } from "../src/host/details-witness.js";

type After = { after(callback: () => void): void };
const SESSION: Witness = { session: "s|25.0|1|1|100|/p.aep", file: null };
const ask = (layerId: string, hash = "h1", projectKey = "file:/p.aep"): LayerAsk => ({ projectKey, compId: "5", layerId, hash });
const detail = (text: string) => [{ path: "ADBE Text Properties/ADBE Text Document", value: { text } }];

function directoryFor(t: After): string {
  const directory = mkdtempSync(join(tmpdir(), "extynt-details-store-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

const reopened = (directory: string): DetailsStore => createDetailsStore({ directory });

test("details recorded and flushed come back from a fresh store when the hash and the witness hold", async (t) => {
  const directory = directoryFor(t), store = createDetailsStore({ directory });
  store.record([{ ...ask("11"), properties: detail("hello") }], SESSION);
  await store.flush();
  const found = await reopened(directory).lookup([ask("11")], SESSION);
  assert.deepEqual(found, [{ compId: "5", layerId: "11", properties: detail("hello") }]);
});

test("a stored entry is not reused when the layer's hash moved, the witness does not hold, or the project differs", async (t) => {
  const directory = directoryFor(t), store = createDetailsStore({ directory });
  store.record([{ ...ask("11"), properties: detail("hello") }], SESSION);
  await store.flush();
  const fresh = reopened(directory);
  assert.deepEqual(await fresh.lookup([ask("11", "h2")], SESSION), [], "a different hash is a different layer");
  assert.deepEqual(await fresh.lookup([ask("11")], { session: "s|25.0|1|1|101|/p.aep", file: null }), [], "the revision moved: something was edited");
  assert.deepEqual(await fresh.lookup([ask("11", "h1", "file:/other.aep")], SESSION), [], "another project's layer 11 is not this one");
  assert.equal((await fresh.lookup([ask("11")], SESSION)).length, 1, "and the entry itself was not harmed by the misses");
});

test("the witness holds for the same session, or for the same clean saved file, and for nothing else", () => {
  const recorded: Witness = { session: "s1", file: "f1" };
  assert.equal(witnessHolds(recorded, { session: "s1", file: null }), true);
  assert.equal(witnessHolds(recorded, { session: "s2", file: "f1" }), true);
  assert.equal(witnessHolds(recorded, { session: "s2", file: "f2" }), false);
  assert.equal(witnessHolds(recorded, { session: null, file: null }), false);
  assert.equal(witnessHolds({ session: null, file: null }, { session: null, file: null }), false, "two absent witnesses prove nothing");
});

test("a corrupt, truncated or foreign file is ignored and the next write replaces it", async (t) => {
  const directory = directoryFor(t), file = join(directory, DETAILS_STORE_FILE);
  for (const content of ["", "{", "not json at all", "[]", "null", '{"format":1}', JSON.stringify({ format: DETAILS_STORE_FORMAT, digest: KEY_DIGEST_FORMAT, kinds: DETAIL_KINDS.join(","), entries: "nope" })]) {
    writeFileSync(file, content);
    const store = reopened(directory);
    assert.deepEqual(await store.lookup([ask("11")], SESSION), [], `ignored: ${content.slice(0, 20)}`);
    assert.equal(store.size(), 0);
  }
  const store = reopened(directory);
  store.record([{ ...ask("11"), properties: detail("x") }], SESSION);
  await store.flush();
  assert.equal((await reopened(directory).lookup([ask("11")], SESSION)).length, 1);
});

test("one malformed entry is dropped without losing its neighbours", () => {
  const header = { format: DETAILS_STORE_FORMAT, digest: KEY_DIGEST_FORMAT, kinds: DETAIL_KINDS.join(",") };
  const good = { p: "file:/p.aep", c: "5", l: "11", h: "h1", s: "s1", f: null, d: detail("ok") };
  const bad = [{ ...good, l: 11 }, { ...good, d: [{ value: 1 }] }, { ...good, h: "" }, { ...good, s: 3 }, "x", null];
  const entries = parseStore(JSON.stringify({ ...header, entries: [good, ...bad, { ...good, l: "12" }] }));
  assert.deepEqual(entries.map((entry) => entry.layerId), ["11", "12"]);
});

test("a change of format, key digest tag or detail kinds invalidates the whole file", async (t) => {
  const directory = directoryFor(t), store = createDetailsStore({ directory });
  store.record([{ ...ask("11"), properties: detail("hello") }], SESSION);
  await store.flush();
  const file = join(directory, DETAILS_STORE_FILE), original = readFileSync(file, "utf8");
  assert.equal(parseStore(original).length, 1);
  for (const [field, was, now] of [["format", `"format":${DETAILS_STORE_FORMAT}`, '"format":0'], ["digest", `"digest":"${KEY_DIGEST_FORMAT}"`, '"digest":"kd1"'], ["kinds", `"kinds":"${DETAIL_KINDS.join(",")}"`, '"kinds":"textDocument,keyDigest"']] as const) {
    assert.ok(original.includes(was), field);
    writeFileSync(file, original.replace(was, now));
    assert.deepEqual(await reopened(directory).lookup([ask("11")], SESSION), [], `${field} changed: the store is not trusted`);
  }
});

test("a file written before the layer hash covered key, text, marker and path content is never trusted", async (t) => {
  const directory = directoryFor(t), store = createDetailsStore({ directory });
  store.record([{ ...ask("11"), properties: detail("hello") }], SESSION);
  await store.flush();
  const file = join(directory, DETAILS_STORE_FILE);
  assert.equal(DETAILS_STORE_FORMAT, 2, "the hash format changed with format 2; its entries key on hashes of the old kind");
  writeFileSync(file, readFileSync(file, "utf8").replace(`"format":${DETAILS_STORE_FORMAT}`, '"format":1'));
  assert.deepEqual(await reopened(directory).lookup([ask("11")], SESSION), []);
});

test("the host's key digest tag is the one the store is keyed by", () => {
  const source = readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "apps", "panel", "host", "host-shared.jsx"), "utf8");
  assert.match(source, new RegExp(`var AE_KEY_DIGEST_VERSION = "${KEY_DIGEST_FORMAT}";`), "host-shared.jsx and KEY_DIGEST_FORMAT must change together");
});

test("the entry cap holds, least recently used first out", async (t) => {
  const directory = directoryFor(t), store = createDetailsStore({ directory });
  store.record(Array.from({ length: MAX_ENTRIES + 50 }, (_, index) => ({ ...ask(String(index)), properties: detail("t") })), SESSION);
  assert.equal(store.size(), MAX_ENTRIES);
  await store.flush();
  const fresh = reopened(directory);
  assert.deepEqual(await fresh.lookup([ask("0"), ask("49")], SESSION), [], "the oldest fifty went");
  assert.equal((await fresh.lookup([ask("50"), ask(String(MAX_ENTRIES + 49))], SESSION)).length, 2);
});

test("a hit counts as a use, so a layer read often outlives newer ones that were not", async (t) => {
  const directory = directoryFor(t), store = createDetailsStore({ directory });
  store.record(Array.from({ length: MAX_ENTRIES }, (_, index) => ({ ...ask(String(index)), properties: detail("t") })), SESSION);
  assert.equal((await store.lookup([ask("0")], SESSION)).length, 1);
  store.record([{ ...ask("new"), properties: detail("t") }], SESSION);
  assert.equal((await store.lookup([ask("0")], SESSION)).length, 1, "layer 0 was used last, layer 1 went");
  assert.deepEqual(await store.lookup([ask("1")], SESSION), []);
});

test("the byte cap holds on disk, and one layer larger than the entry cap is never stored", async (t) => {
  const directory = directoryFor(t), store = createDetailsStore({ directory });
  const big = (index: number) => ({ ...ask(String(index)), properties: detail("x".repeat(MAX_ENTRY_BYTES / 2)) });
  store.record(Array.from({ length: 200 }, (_, index) => big(index)), SESSION);
  store.record([{ ...ask("huge"), properties: detail("x".repeat(MAX_ENTRY_BYTES + 1)) }], SESSION);
  await store.flush();
  assert.ok(statSync(join(directory, DETAILS_STORE_FILE)).size <= MAX_BYTES + 4096, "the file stays within the byte cap");
  assert.ok(store.size() < 200 && store.size() > 0);
  assert.deepEqual(await reopened(directory).lookup([ask("huge")], SESSION), []);
});

test("a store with no directory, or nothing to vouch with, keeps and writes nothing", async (t) => {
  const none = createDetailsStore({ directory: undefined });
  none.record([{ ...ask("11"), properties: detail("x") }], SESSION);
  assert.deepEqual(await none.lookup([ask("11")], SESSION), []);
  const directory = directoryFor(t), store = createDetailsStore({ directory });
  store.record([{ ...ask("11"), properties: detail("x") }], { session: null, file: null });
  await store.flush();
  assert.equal(store.size(), 0);
  assert.throws(() => statSync(join(directory, DETAILS_STORE_FILE)));
});

test("writes are debounced into one atomic file and leave no temporary file behind", async (t) => {
  const directory = directoryFor(t), store = createDetailsStore({ directory, writeDelayMs: 20 });
  for (let index = 0; index < 5; index += 1) store.record([{ ...ask(String(index)), properties: detail("x") }], SESSION);
  assert.throws(() => statSync(join(directory, DETAILS_STORE_FILE)), "nothing is written on the hot path");
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(parseStore(readFileSync(join(directory, DETAILS_STORE_FILE), "utf8")).length, 5);
  assert.deepEqual(readdirSync(directory), [DETAILS_STORE_FILE]);
});
