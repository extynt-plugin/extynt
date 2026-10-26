// Tests for the deterministic tier of the property, orchestration decisions: property, route, specialists and model tier.
import assert from "node:assert/strict";
import test from "node:test";
import { SPECIALIST_ROLES, decide, propertyChoice, routeOf, specialistsOf, MODEL_TIER, REQUEST_ROUTE } from "../src/index.js";

test("a property is the ranked name match, else the synonym of the request, else none", () => {
  const spec = propertyChoice([
    { key: "t/opacity", title: "Opacity", group: "Transform" },
    { key: "t/rotation", title: "Rotation", group: "Transform" },
  ]);
  assert.equal(spec.deterministic({ phrase: "set the rotation", target: "Layer" }), "t/rotation");
  assert.equal(spec.deterministic({ phrase: "make it fade", target: "Layer" }), "t/opacity");
  assert.equal(spec.deterministic({ phrase: "make it nicer", target: "Layer" }), "none");
});

test("the offline route is never answer-only, and a long request goes to specialists", () => {
  assert.equal(routeOf("what does glow do?"), "answer-only");
  assert.equal(routeOf("make the title glow"), "single-agent");
  assert.equal(routeOf("draw a night skyline with a moon and animate it"), "specialist-workflow");
});

test("a model's answer-only is taken only when it is sure", async () => {
  const offline = await decide({ request: "what does glow do?" }, REQUEST_ROUTE, { models: [] });
  assert.equal(offline.label, "answer-only");
});

test("specialists are a subset of the registered roles and the tier is the one configured", () => {
  for (const role of specialistsOf("draw a night skyline with a moon and animate it for twenty seconds")) assert.ok(SPECIALIST_ROLES.includes(role));
  assert.deepEqual(specialistsOf("rename the layer"), []);
  assert.equal(MODEL_TIER.deterministic({ request: "rename the layer" }), "fast");
});
