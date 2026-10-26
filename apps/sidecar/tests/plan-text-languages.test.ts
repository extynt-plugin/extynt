// The plan and work text the sidecar composes (progress lines, the applied reply, the font stand-in sentence, the closing line) renders in every interface language through the real composing functions.
import assert from "node:assert/strict";
import test from "node:test";
import { LANGUAGES, translatorFor, type Language } from "@extynt/ui-text";
import { appliedWords } from "../src/agent-plan-words.js";
import { toolProgressLabel } from "../src/agent-progress-labels.js";
import type { AgentPlanCard } from "../src/agent-types.js";
import { standInSentences } from "../src/server-workflow-stand-in.js";

const card = (title: string, rows: AgentPlanCard["rows"] = []): AgentPlanCard => ({ planId: "p", title, operations: ["set_text_document"], warnings: [], expressions: [], requiresAcknowledgement: false, autoApply: true, rows });
const eachLanguage = (check: (language: Language, translate: ReturnType<typeof translatorFor>) => void): void => { for (const language of LANGUAGES) check(language, translatorFor(language)); };

test("a progress line is plain English by default and differs in every other language", () => {
  assert.equal(toolProgressLabel("ae_inspect_composition"), "Reading the composition");
  eachLanguage((language, translate) => {
    const label = toolProgressLabel("ae_inspect_composition", translate);
    assert.equal(label === "Reading the composition", language === "en", language);
  });
});

test("the applied reply names the plans in each language", () => {
  const expected: Record<Language, string> = { en: "Applied: Move it.", es: "Aplicado: Move it.", de: "Angewendet: Move it.", fr: "Appliqué : Move it.", ja: "適用済み：Move it。", "zh-Hans": "已应用：Move it。" };
  eachLanguage((language, translate) => {
    const row = { label: "Position", target: "A", before: "1", after: "2" };
    assert.equal(appliedWords([card("Move it.", [row])], translate), expected[language], language);
  });
});

test("a long run counts what it does not name, with the count in the sentence", () => {
  const plans = ["a", "b", "c", "d"].map((name) => card(`Plan ${name}`, [{ label: "Position", target: name, before: "1", after: "2" }]));
  eachLanguage((language, translate) => {
    const words = appliedWords(plans, translate);
    assert.ok(words.includes("4"), language);
    assert.ok(words.includes("Plan a"), language);
  });
});

test("the font stand-in sentence is built in each language and still finds the font row by its translated label", () => {
  const substitution = { requested: "didot", offered: ["Georgia"] };
  eachLanguage((language, translate) => {
    const row = { label: translate("plan.row.setFont"), target: "Title", before: "Arial", after: "Georgia Bold" };
    const sentences = standInSentences([substitution], [card("Set title font", [row])], translate);
    assert.equal(sentences.length, 1, language);
    assert.ok(sentences[0]?.includes("Didot") && sentences[0].includes("Georgia"), language);
  });
});

test("the closing line carries the goal in each language", () => {
  eachLanguage((language, translate) => {
    assert.ok(translate("plan.done.closing", { goal: "Logo" }).includes("Logo"), language);
  });
});
