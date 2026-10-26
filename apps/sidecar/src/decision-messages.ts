// The sentences about a decision-model change, said once for the route, the key page and the tool: a refusal in the interface language, with the provider named in it.
import type { Translate } from "@extynt/ui-text";
import { ENTRIES_VARIABLE, PROVIDER_LABEL_KEYS, type DecisionProvider } from "./decision-providers.js";
import type { DecisionIssue } from "./decision-settings-write.js";

/** The provider's name in the interface language. */
export function providerName(t: Translate, provider: DecisionProvider): string {
  return t(PROVIDER_LABEL_KEYS[provider]);
}

function fieldName(t: Translate, field: string): string {
  switch (field) {
    case "key": return t("settings.decision.apiKey");
    case "model": return t("settings.decision.model");
    case "baseUrl": return t("settings.decision.baseUrl");
    case "accountId": return t("settings.decision.accountId");
    default: return field;
  }
}

/** Why a change was refused, as a sentence. */
export function issueMessage(t: Translate, issue: DecisionIssue, provider: DecisionProvider): string {
  if (issue.code === "fileInvalid") return t("settings.decision.error.fileInvalid", { variable: ENTRIES_VARIABLE });
  const field = fieldName(t, issue.field);
  if (issue.code === "singleLine") return t("settings.decision.error.singleLine", { field });
  return t("settings.decision.error.missing", { provider: providerName(t, provider), field });
}
