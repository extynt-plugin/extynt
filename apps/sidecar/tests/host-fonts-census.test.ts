/** The census in two parts: the effects first, the fonts when the lane is idle and from a cache when the host's font key is unchanged, and an honest "still loading" while they run. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { jsonOf } from "@extynt/mcp-server";
import { ok, refuse, toWire } from "@extynt/fake-plugin";
import { present } from "./present.js";
import { loadHostProfile } from "../src/profile-store.js";
import { censusAnswer, fontCensus } from "./sidecar-fixture.js";
import { fieldOf, parseJson } from "./http-json.js";
import { startHostRig, type HostRig } from "./host-rig.js";
import { enqueueHostWork } from "../src/host/work-queue.js";
import { nativeRig, until } from "./native-rig.js";

const argsOf = (rig: HostRig) => rig.plugin.requestsFor("host_call").map((request) => parseJson(String(request.body.args)));
const partsOf = (rig: HostRig): string[] => argsOf(rig).map((args) => String(fieldOf(args, "parts")));
const fontsHeld = (rig: HostRig) => rig.sidecar.hostProfile?.fontInventory;
const startRig = (): Promise<HostRig> => startHostRig({ plugin: { hostCalls: { aeHostCensus: (args) => ok(toWire(censusAnswer(args, 3))) } } });

async function pairedWithCensus(rig: HostRig): Promise<void> {
  rig.pair(); await rig.settle(); rig.timers.fire(); await rig.drain();
}

test("the effects census is asked for alone and lands first; the fonts are a second call after it", async () => {
  const seen: Array<{ phase: string; loading: boolean | undefined }> = [];
  const rig = await startRig();
  try {
    rig.plugin.hostCalls.set("aeHostCensus", (args) => {
      seen.push({ phase: rig.sidecar.hostFacts.fonts.phase, loading: fontsHeld(rig)?.loading });
      return ok(toWire(censusAnswer(args, 3)));
    });
    await pairedWithCensus(rig);
    assert.deepEqual(partsOf(rig), ["effects", "fonts"]);
    assert.deepEqual(seen, [{ phase: "unknown", loading: undefined }, { phase: "loading", loading: true }], "the fonts are asked for after the effects are recorded, with the list marked as loading");
    assert.equal(rig.sidecar.inventory?.items.length, 3);
    assert.equal(rig.sidecar.hostFacts.fonts.phase, "ready");
    assert.equal(fontsHeld(rig)?.loading, undefined);
    assert.deepEqual(fontsHeld(rig)?.items.map((font) => font.postScriptName), ["Arial-Black", "Georgia-Bold"]);
    assert.equal(rig.sidecar.hostFacts.checks.census?.ok, true);
  } finally { await rig.close(); }
});

test("the fonts wait for the lane to be idle: nothing is claimed while the mailbox holds work or something runs", async () => {
  const rig = await startRig();
  try {
    rig.pair(); await rig.settle(); rig.timers.fire();
    assert.deepEqual(await rig.drain(), ["refresh_snapshot", "host_census", "host_census"]);
    rig.readers.queueCensus();
    const effects = present(rig.sidecar.agentMailbox.shift());
    rig.sidecar.hostFacts.fonts = { phase: "pending", at: 0 };
    enqueueHostWork(rig.sidecar, effects);
    assert.equal(rig.readers.claimBackground(rig.context.now()), undefined, "queued work goes first");
    rig.sidecar.agentMailbox.length = 0;
    rig.sidecar.inFlight = { kind: "apply_plan", id: "p", claimedAt: 0 };
    assert.equal(rig.readers.claimBackground(rig.context.now()), undefined, "and a running item holds the lane");
    rig.sidecar.inFlight = undefined;
    const claim = rig.readers.claimBackground(rig.context.now());
    assert.deepEqual([claim?.kind, claim?.item.part], ["host_census", "fonts"]);
    assert.equal(rig.sidecar.hostFacts.fonts.phase, "loading");
  } finally { await rig.close(); }
});

test("a font list the host still holds the key of is not read again: the cache stands and the profile does not change", async () => {
  const unchanged: string[] = [], rig = await startRig();
  try {
    rig.plugin.hostCalls.set("aeHostCensus", (args) => {
      const answer = censusAnswer(args, 3);
      if (String(args.parts) === "fonts") unchanged.push(String(fieldOf(answer, "result.fontsUnchanged")));
      return ok(toWire(answer));
    });
    await pairedWithCensus(rig);
    const before = present(rig.sidecar.hostProfile), keyed = before.fontInventory.hostFingerprint;
    assert.ok(keyed, "the first read kept the host's key with the list");
    rig.readers.queueCensus();
    await rig.drain();
    const asked = argsOf(rig);
    assert.deepEqual(asked.map((request) => fieldOf(request, "parts")), [["effects"], ["fonts"], ["effects"], ["fonts"]]);
    assert.equal(fieldOf(asked[1], "fontFingerprint"), undefined, "no list held, no key sent");
    assert.equal(fieldOf(asked[3], "fontFingerprint"), keyed, "the held list's key goes with the next fonts call");
    const after = present(rig.sidecar.hostProfile);
    assert.equal(after.profileId, before.profileId);
    assert.deepEqual(after.fontInventory.items, before.fontInventory.items);
    assert.deepEqual(unchanged, ["false", "true"], "the second fonts call came back unchanged and carried no list");
    assert.equal(after.fontInventory.loading, undefined);
  } finally { await rig.close(); }
});

test("a font list that changed is replaced, and it is a different profile", async () => {
  const rig = await startRig();
  try {
    await pairedWithCensus(rig);
    const before = present(rig.sidecar.hostProfile);
    rig.plugin.hostCalls.set("aeHostCensus", (args) => ok(toWire(censusAnswer(args, 3, ["Arial-Black", "Georgia-Bold", "Inter-Black"]))));
    rig.readers.queueCensus();
    await rig.drain();
    assert.deepEqual(fontsHeld(rig)?.items.map((font) => font.postScriptName), ["Arial-Black", "Georgia-Bold", "Inter-Black"]);
    assert.notEqual(present(rig.sidecar.hostProfile).profileId, before.profileId);
  } finally { await rig.close(); }
});

test("the stored profile keeps the list and the host's key, and never the loading marker, so a restart starts from the cache", async () => {
  const unchanged: string[] = [], rig = await startRig();
  try {
    rig.plugin.hostCalls.set("aeHostCensus", (args) => {
      if (String(args.parts) === "fonts") {
        unchanged.push(String(fieldOf(censusAnswer(args, 3), "result.fontsUnchanged")));
        const stored = parseJson(readFileSync(join(present(rig.sidecar.options.stateDirectory), "host-capability-profile.json"), "utf8"));
        assert.equal(fieldOf(stored, "fontInventory.loading"), undefined, "the marker is a fact about this process");
      }
      return ok(toWire(censusAnswer(args, 3)));
    });
    await pairedWithCensus(rig);
    const restored = loadHostProfile(rig.sidecar.options.stateDirectory);
    assert.equal(restored?.fontInventory.items.length, 2);
    assert.equal(restored?.fontInventory.hostFingerprint, fontsHeld(rig)?.hostFingerprint);
    assert.equal(restored?.fontInventory.loading, undefined);
    rig.sidecar.hostProfile = restored;
    rig.sidecar.hostFacts.fonts = { phase: "unknown", at: null };
    rig.readers.queueCensus();
    await rig.drain();
    assert.deepEqual(unchanged, ["false", "true"], "the restarted sidecar sent the stored key and the host kept its list");
  } finally { await rig.close(); }
});

test("a font call the host refuses leaves the effects census standing, the held list unmarked, and the failure visible", async () => {
  const rig = await startRig();
  try {
    rig.plugin.hostCalls.set("aeHostCensus", (args) => (String(args.parts) === "fonts" ? refuse("SCRIPT_FAILED", "no fonts") : ok(toWire(censusAnswer(args, 3)))));
    await pairedWithCensus(rig);
    assert.deepEqual(partsOf(rig), ["effects", "fonts"], "asked once, not in a loop");
    assert.equal(rig.sidecar.inventory?.items.length, 3);
    assert.equal(rig.sidecar.hostFacts.checks.census?.ok, true, "the effects census did run");
    assert.deepEqual([rig.sidecar.hostFacts.fonts.phase, rig.sidecar.hostFacts.fonts.code], ["failed", "SCRIPT_FAILED"]);
    assert.equal(fontsHeld(rig)?.loading, undefined);
    assert.ok(rig.logs.some((entry) => entry.event === "host.fonts-failed" && entry.fields.code === "SCRIPT_FAILED"));
  } finally { await rig.close(); }
});

test("a host library that answers a fonts request with the whole census is a failure, not a loop", async () => {
  const rig = await startRig();
  try {
    rig.plugin.hostCalls.set("aeHostCensus", () => ok(toWire(censusAnswer({}, 3))));
    await pairedWithCensus(rig);
    assert.deepEqual(partsOf(rig), ["effects", "fonts"]);
    assert.deepEqual([rig.sidecar.hostFacts.fonts.phase, rig.sidecar.hostFacts.fonts.code], ["failed", "FONTS_PART_UNSUPPORTED"]);
  } finally { await rig.close(); }
});

test("a fonts census that arrives before any effects census is refused and nothing is half-recorded", async () => {
  const rig = await startRig();
  try {
    const answer = await rig.receivers.acceptHostCensus(jsonOf(fontCensus()), 10);
    assert.deepEqual([answer.outcome, answer.errorCode], ["rejected", "CENSUS_ORDER"]);
    assert.equal(rig.sidecar.hostProfile?.fontInventory.items.length ?? 0, 0);
  } finally { await rig.close(); }
});

test("ae_search_fonts says the fonts are still loading while they are read, ae_status says the same, and both settle when they land", async (t) => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const rig = await nativeRig(t, { skipRefresh: true, plugin: { hostCalls: { aeHostCensus: async (args) => { if (String(args.parts) === "fonts") await gate; return ok(toWire(censusAnswer(args, 3))); } } } });
  await until(() => rig.sidecar.hostFacts.fonts.phase === "loading");
  const searching = await rig.agent("ae_search_fonts", { query: "arial" });
  assert.equal(fieldOf(searching.body, "data.fontsLoading"), true);
  assert.deepEqual(fieldOf(searching.body, "data.entries"), [], "no result is not an answer: the note says why");
  assert.match(String(fieldOf(searching.body, "data.note")), /still loading/i);
  const status = await rig.agent("ae_status");
  assert.equal(fieldOf(status.body, "data.hostLibrary.census.ok"), true, "the effects census is complete");
  assert.equal(fieldOf(status.body, "data.hostLibrary.fonts.state"), "loading", "the fonts are not");
  release();
  await until(() => rig.sidecar.hostFacts.fonts.phase === "ready");
  const found = await rig.agent("ae_search_fonts", { query: "arial" });
  assert.equal(fieldOf(found.body, "data.fontsLoading"), undefined);
  assert.equal(fieldOf(found.body, "data.entries.0.postScriptName"), "Arial-Black");
  assert.equal(fieldOf((await rig.agent("ae_status")).body, "data.hostLibrary.fonts.state"), "ready");
});
