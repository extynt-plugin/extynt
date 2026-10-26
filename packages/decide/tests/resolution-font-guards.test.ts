// Font requests that must still abstain or keep their pick: vague wording, typed-out family names that are not installed, and a poster look.
import assert from "node:assert/strict";
import test from "node:test";
import { fontChoice } from "../src/index.js";
import type { FontRecord } from "../src/index.js";

function records(families: ReadonlyArray<string>): ReadonlyArray<FontRecord> {
  return families.map((family) => ({ family, style: "Regular", postScriptName: family.replace(/ /g, "") }));
}

function pick(phrase: string, installed: ReadonlyArray<string>): string {
  return fontChoice(phrase, records(installed)).deterministic({ phrase });
}

const SHELF = ["Arial", "Work Sans", "DM Sans", "Papyrus", "Comic Sans MS", "Zapfino", "Georgia", "Menlo"];

test("a vague request with no style, name or use content picks nothing", () => {
  for (const phrase of ["a nice font", "something nice and modern", "a good looking font"]) assert.equal(pick(phrase, SHELF), "none", phrase);
});

test("a title-cased or script family name that is not installed picks nothing", () => {
  assert.equal(pick("Playfare Display", SHELF), "none");
  assert.equal(pick("Source Sans", SHELF), "none");
  assert.equal(pick("a handwritten brush script", SHELF), "none");
});

test("a vintage circus poster takes Playbill over the equally tagged Showcard Gothic", () => {
  assert.equal(pick("a vintage circus poster font", ["Showcard Gothic", "Playbill", "Arial"]), "Playbill");
});
