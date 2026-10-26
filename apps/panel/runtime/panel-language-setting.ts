/** The Language setting: the six languages in their own names plus Automatic; choosing one repaints the panel at once and is remembered by the sidecar. */
import { LANGUAGES, LANGUAGE_NAMES, isLanguage, isLanguageChoice, type LanguageChoice } from "@extynt/ui-text";
import { clearChildren, el, selectById } from "./panel-dom.js";
import { onLanguageChange, t } from "./panel-language.js";
import { setPref } from "./panel-prefs.js";
import { dispatch, subscribeUi, uiState } from "./ui-state.js";

function optionOf(choice: LanguageChoice): HTMLOptionElement {
  const option = el("option", "", isLanguage(choice) ? LANGUAGE_NAMES[choice] : t("settings.language.auto"));
  option.value = choice;
  return option;
}

function paintOptions(select: HTMLSelectElement): void {
  const choices: ReadonlyArray<LanguageChoice> = ["auto", ...LANGUAGES];
  clearChildren(select);
  for (const choice of choices) select.appendChild(optionOf(choice));
  select.value = uiState().prefs.language;
}

function choose(select: HTMLSelectElement): void {
  const choice = select.value;
  if (!isLanguageChoice(choice)) return;
  if (isLanguage(choice)) dispatch({ type: "language", language: choice });
  setPref({ language: choice });
}

/** Fills the Language list and keeps it in step with the stored choice and with the language it is drawn in. */
export function wireLanguageSetting(): void {
  const select = selectById("interface-language");
  if (!select) return;
  paintOptions(select);
  select.addEventListener("change", () => choose(select));
  onLanguageChange(() => paintOptions(select));
  subscribeUi((topic) => {
    if (topic === "prefs") select.value = uiState().prefs.language;
  });
}
