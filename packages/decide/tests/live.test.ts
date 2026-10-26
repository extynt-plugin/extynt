// A live smoke test against the real TypeSafe API; it runs only when TYPESAFE_API_KEY is set (or the test runner loaded the developer's key from jev.env) and is skipped otherwise.
import assert from "node:assert/strict";
import test from "node:test";
import { decideAll, decisionModelsFromEnvironment, liveSkipReason } from "../src/index.js";
import { IS_SCENE, URGENCY } from "./support.js";

const key = process.env.TYPESAFE_API_KEY || process.env.EXTYNT_LIVE_TYPESAFE_API_KEY || "";

test("Jev answers a real batch in one request", { skip: await liveSkipReason(key) }, async () => {
  const models = decisionModelsFromEnvironment({ TYPESAFE_API_KEY: key });
  const results = await decideAll({ text: "draw a night skyline, quickly" }, { scene: IS_SCENE, urgency: URGENCY }, { models, decisionTimeoutMs: 20_000 });
  assert.equal(results.scene.fallback, null);
  assert.equal(results.scene.source, "decision-model");
});
