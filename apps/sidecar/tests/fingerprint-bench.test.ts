/**
 * The cost of identity on a project the size of the owner's (15 compositions, 126 layers, about 20k properties). It
 * asserts only ratios, which a loaded machine does not move; EXTYNT_BENCH=1 prints the milliseconds.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { graphFingerprint } from "@extynt/project-graph";
import { normalizeProbeSnapshot } from "../src/server-normalize.js";
import { BENCH_SIZE, benchProbe, minMs, scopedProbeOnto, storedProbe } from "./fingerprint-bench-support.js";
import { present } from "./present.js";

const AT = "2026-10-05T12:00:00.000Z";

function measure(): Record<string, number> {
  const cold = (): number => { const probes = Array.from({ length: 5 }, (_, index) => benchProbe(`cold-${index}`, 1, index + 100)); let next = 0; return minMs(4, () => { normalizeProbeSnapshot(present(probes[next % probes.length]), AT); next += 1; }); };
  const base = benchProbe("full", 1, 1), normalised = normalizeProbeSnapshot(base, AT);
  let stored = storedProbe(base), revision = 1;
  const scopedProbes = Array.from({ length: 12 }, () => { revision += 1; const merged = scopedProbeOnto(stored, 4, revision); stored = storedProbe(merged); return merged; });
  let step = 0;
  return {
    coldNormalise: cold(),
    unchangedNormalise: minMs(7, () => { normalizeProbeSnapshot(base, AT); }),
    fingerprintFromScratch: minMs(5, () => { graphFingerprint(normalised); }),
    scopedNormalise: minMs(10, () => { normalizeProbeSnapshot(present(scopedProbes[step % scopedProbes.length]), AT); step += 1; }),
  };
}

test("a scoped read costs a fraction of a full one, and a full fingerprint stays cheap", () => {
  const numbers = measure();
  if (process.env.EXTYNT_BENCH) console.log(`fingerprint bench ${JSON.stringify(BENCH_SIZE)} ms: ${JSON.stringify(Object.fromEntries(Object.entries(numbers).map(([name, ms]) => [name, Number(ms.toFixed(2))])))}`);
  assert.ok(present(numbers.scopedNormalise) * 3 < present(numbers.coldNormalise), "a scoped read rehashes only the layers it replaced");
  assert.ok(present(numbers.unchangedNormalise) < present(numbers.scopedNormalise), "an unchanged read costs nothing but the shell");
  assert.ok(present(numbers.fingerprintFromScratch) < present(numbers.coldNormalise), "a from-scratch fingerprint costs less than normalising the whole project");
});
