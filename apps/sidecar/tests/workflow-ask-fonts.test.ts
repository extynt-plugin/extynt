// The ae_ask_user font guard: a question about an uninstalled font is refused when the census is complete, and the model is told to use the installed substitute; a partial census never refuses, and an insisted-on exact font lets the question through.
import assert from "node:assert/strict";
import test from "node:test";
import { makeFontInventory, makeHostProfile, makeInventory, makePresetInventory } from "@extynt/capability-catalogue";
import type { FontInventory } from "@extynt/capability-catalogue";
import { fontQuestionRefusal } from "../src/server-workflow-font-guard.js";

const HOST = { application: "After Effects" as const, version: "26.2.1", buildNumber: "2", platform: "Windows", architecture: "x64" };
const record = (family: string, style: string) => ({ family, style, postScriptName: `${family.replace(/\s+/g, "")}-${style.replace(/\s+/g, "")}` });
const REQUEST = "Make the title in visby bold italics";
const LITERAL_QUESTION = "Visby is not installed. Should I substitute Proxima Nova (e.g. Proxima Nova / Montserrat), or tell me which installed font to use?";

function fontsWith(overrides: { completeness?: "complete" | "partial"; truncated?: boolean; loading?: boolean } = {}): FontInventory {
  const built = makeFontInventory([record("Arial", "Regular"), record("Arial", "Bold"), record("Arial", "Bold Italic"), record("Verdana", "Regular")], { completeness: overrides.completeness ?? "complete", familiesReported: 2 });
  return { ...built, truncated: overrides.truncated ?? built.truncated, ...(overrides.loading ? { loading: true } : {}) };
}

function askWith(fonts: FontInventory, question: string, request = REQUEST): ReturnType<typeof fontQuestionRefusal> {
  return fontQuestionRefusal(makeHostProfile(makeInventory(HOST, []), undefined, makePresetInventory([]), fonts), question, request);
}

function messageOf(result: ReturnType<typeof fontQuestionRefusal>): string {
  return result?.ok === false ? result.error.message : "";
}

test("a question naming an uninstalled font family is refused, listing the installed alternatives", () => {
  const result = askWith(fontsWith(), "Use Montserrat as the font, or Arial?", "Make the title in Arial bold");
  assert.equal(result?.ok, false);
  assert.equal(result?.ok ? "" : result?.error.code, "ASK_FONT_NOT_INSTALLED");
  assert.match(messageOf(result), /Not installed on this host: montserrat/);
  assert.match(messageOf(result), /Installed alternatives, the only families to name: .*Arial/);
});

test("the literal substitute-or-tell-me question is refused when the request names a missing font", () => {
  const result = askWith(fontsWith(), LITERAL_QUESTION);
  assert.equal(result?.ok, false);
  assert.match(messageOf(result), /Do not ask which font to use: "visby" is not installed on this host/);
  assert.match(messageOf(result), /Use the installed substitute Arial as Arial-BoldItalic \(Bold Italic\) and say so in your reply/);
});

test("a font question with no missing font in the request, and a non-font question, are not refused", () => {
  assert.equal(askWith(fontsWith(), "Which font should the title use?", "Make the title in Arial bold"), undefined);
  assert.equal(askWith(fontsWith(), "Should this be 6 seconds or 30 seconds?"), undefined);
  assert.equal(askWith(fontsWith(), "Use Arial as the font?", "Make the title in Arial bold"), undefined);
});

test("a user who insisted on the exact font lets the font question through", () => {
  assert.equal(askWith(fontsWith(), LITERAL_QUESTION, "Make the title in visby bold italics, I need that exact font"), undefined);
  assert.equal(askWith(fontsWith(), "Use Montserrat as the font?", "Use Montserrat, I insist on no substitute"), undefined);
});

test("a partial or loading census never refuses a font question", () => {
  assert.equal(askWith(fontsWith({ completeness: "partial", truncated: true }), LITERAL_QUESTION), undefined);
  assert.equal(askWith(fontsWith({ loading: true }), LITERAL_QUESTION), undefined);
  assert.equal(askWith(fontsWith({ completeness: "partial", truncated: true }), "Use Montserrat as the font?"), undefined);
});
