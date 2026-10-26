// The plain sentence that tells the user a typeface they asked for is not installed and which installed family was used instead, built from the substitution the font lookup recorded and the font the applied plans set.
import type { FontSubstitution } from "@extynt/mcp-server";
import type { Translate } from "@extynt/ui-text";
import type { AgentPlanCard } from "./agent-types.js";
import { ENGLISH_TEXT } from "./plan-text.js";

const FONT_ROW = "Set font";

function fontsSet(plans: readonly AgentPlanCard[], translate: Translate): string[] {
  const labels = [FONT_ROW, translate("plan.row.setFont")];
  return plans.flatMap((plan) => (plan.rows ?? []).filter((row) => labels.includes(row.label) && row.after).map((row) => row.after ?? ""));
}

function usedFamily(substitution: FontSubstitution, set: readonly string[]): string | undefined {
  return substitution.offered.find((family) => family && set.some((name) => name.toLowerCase().startsWith(family.toLowerCase())));
}

function spelled(requested: string): string {
  return requested.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

/** One sentence per requested font that was not installed and whose offered stand-in an applied plan set; nothing for a stand-in no plan used. */
export function standInSentences(substitutions: readonly FontSubstitution[], plans: readonly AgentPlanCard[], translate: Translate = ENGLISH_TEXT): string[] {
  const set = fontsSet(plans, translate);
  const seen = new Set<string>();
  return substitutions.flatMap((substitution) => {
    const used = usedFamily(substitution, set);
    const key = substitution.requested.toLowerCase();
    if (!used || !substitution.requested || seen.has(key)) return [];
    seen.add(key);
    return [translate("plan.fontStandIn", { requested: spelled(substitution.requested), used })];
  });
}

/** The answer with the stand-in sentences added, except for a requested font the answer already names. */
export function withStandIn(answer: string, sentences: readonly string[]): string {
  const missing = sentences.filter((sentence) => !answer.toLowerCase().includes((sentence.split(" is not installed")[0] ?? "").toLowerCase()));
  return [answer.trim(), ...missing].filter(Boolean).join("\n\n");
}
