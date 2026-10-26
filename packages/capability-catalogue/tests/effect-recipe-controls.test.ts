// The briefing's recipe controls stay pinned to the control census, so a rename in the evidence cannot leave the briefing teaching a stale matchName.
import assert from "node:assert/strict";
import test from "node:test";
import { RECIPE_EFFECT_MATCH_NAMES, recipeEffect } from "../src/index.js";
import type { EffectProbeRow } from "../src/catalogue-model.js";
import { loadFixtureEffectEvidence } from "./effect-evidence-fixture.js";

test("every recipe control exists in the AE 26 control census under the same name", () => {
  const evidence = loadFixtureEffectEvidence();
  assert.ok(evidence, "the census fixture loads");
  for (const matchName of RECIPE_EFFECT_MATCH_NAMES) {
    const effect = recipeEffect(matchName);
    assert.ok(effect, `${matchName} resolves to a curated capability`);
    const rows: EffectProbeRow[] = evidence.effects[matchName]?.controls ?? [];
    for (const control of effect.controls) {
      const row: EffectProbeRow | undefined = rows.find((candidate) => candidate.m === control.matchName);
      assert.ok(row, `${control.matchName} is in the census`);
      assert.equal(row.n, control.name, `${control.matchName} is still called ${control.name}`);
    }
  }
});

test("recipe effects resolve their catalogue capability ids", () => {
  assert.deepEqual(RECIPE_EFFECT_MATCH_NAMES.map((name) => recipeEffect(name)?.capabilityId), ["adobe.glow", "adobe.drop-shadow", "adobe.gaussian-blur", "adobe.gradient-ramp"]);
  assert.equal(recipeEffect("ADBE Not An Effect"), undefined);
});
