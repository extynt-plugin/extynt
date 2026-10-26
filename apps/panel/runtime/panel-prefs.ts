/** Changing a preference: the panel shows the new value at once, the sidecar keeps it, and a refusal puts the old value back. */
import { hooks } from "./panel-hooks.js";
import { t } from "./panel-language.js";
import { patchPrefs } from "./ui-api.js";
import type { UiPrefs } from "./ui-contract.js";
import { dispatch, uiState } from "./ui-state.js";

/** Applies the patch to the panel's preferences immediately and sends it to the sidecar; the language the sidecar answers with is adopted. */
export function setPref(patch: Partial<UiPrefs>): void {
  const before = uiState().prefs;
  dispatch({ type: "prefs", prefs: { ...before, ...patch } });
  patchPrefs(patch, (reply) => {
    if (reply.ok) {
      dispatch({ type: "prefs", prefs: reply.value.prefs });
      dispatch({ type: "language", language: reply.value.interfaceLanguage });
      return;
    }
    dispatch({ type: "prefs", prefs: before });
    hooks.notice(t("settings.prefs.saveFailed"), "warn", null, true);
  });
}
