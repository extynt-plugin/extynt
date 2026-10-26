// Tests interpolation and plural choice against messages whose output is known exactly, in every language that reads a count differently.
import test from "node:test";
import assert from "node:assert/strict";
import { placeholdersOf } from "../src/index.js";
import { fill } from "../src/fill.js";

const PLANS = { one: "{count} plan", other: "{count} plans" };

test("named placeholders are replaced and an unknown one stays visible", () => {
  assert.equal(fill("Hello {name}, {missing}", "en", { name: "Ada" }), "Hello Ada, {missing}");
});

test("English reads exactly one as singular and zero as plural", () => {
  assert.equal(fill(PLANS, "en", { count: 1 }), "1 plan");
  assert.equal(fill(PLANS, "en", { count: 0 }), "0 plans");
  assert.equal(fill(PLANS, "en", { count: 3 }), "3 plans");
});

test("French reads zero as singular", () => {
  assert.equal(fill({ one: "{count} plan", other: "{count} plans" }, "fr", { count: 0 }), "0 plan");
  assert.equal(fill({ one: "{count} plan", other: "{count} plans" }, "fr", { count: 2 }), "2 plans");
});

test("Japanese and Chinese have no singular", () => {
  assert.equal(fill({ other: "{count} 件のプラン" }, "ja", { count: 1 }), "1 件のプラン");
  assert.equal(fill({ one: "unused", other: "{count} 个方案" }, "zh-Hans", { count: 1 }), "1 个方案");
});

test("placeholders are listed once each in order", () => {
  assert.deepEqual(placeholdersOf("{a} and {b} and {a}"), ["a", "b"]);
});
