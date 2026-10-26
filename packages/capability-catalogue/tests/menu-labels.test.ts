// Tests the menu labels read from effect control rows.
import assert from "node:assert/strict";
import test from "node:test";
import { describeControlWrite, effectControlValueError, makeHostProfile, makeInventory, menuChoices, menuLabel, type ControlSchema, type HostCapabilityProfile } from "../src/index.js";

const HOST = { application: "After Effects" as const, version: "26.2.1", buildNumber: "2", platform: "macOS", architecture: "arm64" };

const popup = (menu: string[], defaultValue?: number): ControlSchema => ({ path: "ACME-0001", matchName: "ACME-0001", displayName: "Operation", valueType: "enum", menu, ...(defaultValue === undefined ? {} : { defaultValue }) });
const names25 = Array.from({ length: 25 }, (_, index) => `Blend Mode Number ${index + 1}`);

test("a short menu lists every item with its default label", () => {
  assert.equal(describeControlWrite(popup(["Normal", "Add", "Screen"], 3)), "Operation — menu: 1 Normal, 2 Add, 3 Screen, default 3 (Screen)");
});

test("a long menu keeps the leading items, the default item and the total count", () => {
  const line = describeControlWrite(popup(names25, 20));
  assert.match(line, /^Operation — menu: 1 Blend Mode Number 1, 2 Blend Mode Number 2, /);
  assert.match(line, /, \.\.\., 20 Blend Mode Number 20, \.\.\. \(25 items\), default 20 \(Blend Mode Number 20\)$/);
  assert.ok(line.length < 400);
});

test("separator slots are skipped but keep their numbering", () => {
  assert.equal(menuChoices(["A", "-", "C"]), "1 A, 3 C");
  assert.equal(menuLabel(["A", "-", "C"], 2), undefined);
  assert.equal(menuLabel(["A", "-", "C"], 3), "C");
});

test("the menu error is bounded and states the range", () => {
  const base = makeHostProfile(makeInventory(HOST, [{ matchName: "ACME", displayName: "Acme", available: true, evidence: [] }]));
  const profile: HostCapabilityProfile = { ...base, entries: base.entries.map((entry) => ({ ...entry, controls: [popup(names25)] })) };
  const message = String(effectControlValueError(profile, "ACME", "ACME-0001", 99));
  assert.match(message, /^Operation is a menu: use 1-25: 1 Blend Mode Number 1, /);
  assert.match(message, /\(25 items\)\.$/);
  assert.ok(message.length < 400);
});

test("a menu-less enum keeps the old single-number lines", () => {
  assert.equal(describeControlWrite({ path: "X", matchName: "X", displayName: "Mode", valueType: "enum", max: 5, defaultValue: 3 }), "Mode — one menu item number, 1 to 5, default 3");
});
