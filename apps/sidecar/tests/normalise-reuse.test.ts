/** A scoped read normalises and fingerprints only what it replaced: the rest is the earlier read's own objects, and the result is exactly what a from-scratch pass gives. */
import assert from "node:assert/strict";
import test from "node:test";
import { graphFingerprint, type ProjectSnapshot } from "@extynt/project-graph";
import { normalizeProbeSnapshot } from "../src/server-normalize.js";
import type { ProbeSnapshot } from "../src/server-types.js";
import { benchProbe, rawCompositions, rawLayers, rawProperties, scopedProbeOnto, storedProbe } from "./fingerprint-bench-support.js";
import { present } from "./present.js";

const AT = "2026-10-05T12:00:00.000Z";
const normalised = (probe: ProbeSnapshot): ProjectSnapshot => normalizeProbeSnapshot(probe, AT);
const rebuilt = (probe: ProbeSnapshot): ProbeSnapshot => structuredClone(probe);
const layersOf = (snapshot: ProjectSnapshot, comp: number) => present(snapshot.compositions[comp]).layers;

test("a scoped read reuses the layers it did not replace and replaces the ones it read", () => {
  const base = benchProbe("full", 1, 1), before = normalised(base);
  const merged = scopedProbeOnto(storedProbe(base), 4, 2), after = normalised(merged);
  for (let comp = 0; comp < before.compositions.length; comp += 1) {
    const reused = layersOf(after, comp).every((layer, index) => layer === layersOf(before, comp)[index]);
    assert.equal(reused, comp !== 4, `composition ${comp}`);
  }
  assert.notEqual(after.fingerprint, before.fingerprint, "the replaced layers carry new content");
});

test("the fingerprint after a scoped read equals the from-scratch fingerprint of the same project", () => {
  const base = benchProbe("full", 1, 1);
  normalised(base);
  const merged = scopedProbeOnto(storedProbe(base), 4, 2);
  const incremental = normalised(merged);
  assert.equal(incremental.fingerprint, normalised(rebuilt(merged)).fingerprint, "a pass over objects nothing remembers agrees");
  assert.equal(incremental.fingerprint, graphFingerprint(structuredClone(incremental)), "so does hashing an unfrozen copy of the result");
});

test("a read that returns the same content as new objects keeps the fingerprint, and one real change moves it", () => {
  const base = benchProbe("full", 1, 1), before = normalised(base).fingerprint;
  assert.equal(normalised(benchProbe("again", 2, 1)).fingerprint, before, "same content, new objects");
  const scopedSame = scopedProbeOnto(storedProbe(base), 4, 1);
  assert.equal(normalised(scopedSame).fingerprint, before, "a scoped read of unchanged content");
  assert.notEqual(normalised(benchProbe("changed", 3, 2)).fingerprint, before);
  const edited = rebuilt(base);
  present(rawProperties(rawLayers(rawCompositions(edited)[7])[2])[5]).value = 123456;
  assert.notEqual(normalised(edited).fingerprint, before, "one property of one layer");
});

test("a normalised layer and its raw row cannot be edited, so a reused result cannot go stale", () => {
  const base = benchProbe("full", 1, 1), snapshot = normalised(base);
  assert.throws(() => { present(layersOf(snapshot, 0)[0]).name = "Edited"; }, TypeError);
  assert.throws(() => { present(present(layersOf(snapshot, 0)[0]).properties[0]).displayName = "Edited"; }, TypeError);
  const raw = present(rawLayers(rawCompositions(base)[0])[0]);
  assert.throws(() => { raw.name = "Edited"; }, TypeError);
});

test("the selection flag is not content: selecting another layer in the read keeps the fingerprint", () => {
  const base = benchProbe("full", 1, 1), before = normalised(base).fingerprint, other = rebuilt(base);
  for (const layer of rawLayers(rawCompositions(other)[0])) layer.selected = !layer.selected;
  assert.equal(normalised(other).fingerprint, before);
});
