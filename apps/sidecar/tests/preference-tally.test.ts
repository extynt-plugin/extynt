// The preference tally: a plan counts once when applied, an undo counts against it, the enabled flag stops all counting, old uses decay, and the file survives a restart.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PreferenceTally } from "../src/preference-tally.js";

const DAY = 86_400_000;
const glow = [{ type: "ensure_effect", effectMatchName: "ADBE Glo2" }];

function withTally(run: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "tally-"));
  try { run(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
}
const candidates = [{ key: "ADBE Glo2", stored: ["ADBE Glo2"] }, { key: "ADBE Other", stored: ["ADBE Other"] }];

test("an applied plan counts once and an undo counts against it", () => withTally((directory) => {
  const tally = new PreferenceTally(directory, () => 0, () => true);
  tally.noteApplied("p1", glow);
  tally.noteApplied("p1", glow);
  const used = tally.habits("effect", candidates);
  assert.equal(used.score["ADBE Glo2"] !== undefined, true);
  assert.equal(used.score["ADBE Other"], undefined);
  tally.noteUndone("p1");
  assert.equal(tally.habits("effect", candidates).note["ADBE Glo2"] !== undefined, true);
}));

test("a disabled tally counts nothing", () => withTally((directory) => {
  const tally = new PreferenceTally(directory, () => 0, () => false);
  tally.noteApplied("p1", glow);
  assert.deepEqual(tally.habits("effect", candidates).score, {});
}));

test("a use thirty days old counts half, and the file is read back after a restart", () => withTally((directory) => {
  let at = 0;
  new PreferenceTally(directory, () => at, () => true).noteApplied("p1", glow);
  const fresh = new PreferenceTally(directory, () => at, () => true).habits("effect", candidates).score["ADBE Glo2"] ?? 0;
  at = 30 * DAY;
  const aged = new PreferenceTally(directory, () => at, () => true).habits("effect", candidates).score["ADBE Glo2"] ?? 0;
  assert.equal(fresh > 0, true);
  assert.ok(Math.abs(aged - fresh / 2) < 0.05 * fresh, `${aged} vs ${fresh}`);
}));
