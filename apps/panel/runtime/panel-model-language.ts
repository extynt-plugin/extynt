/** Makes the model surfaces that keep their words after the first paint follow a change of the interface language at once. */
import { repaintFirstRun } from "./panel-first-run.js";
import { repaintModelSettings } from "./panel-model-apply.js";
import { repaintOpenMenu } from "./panel-model-menu.js";
import { refreshPickerTrigger } from "./panel-model-pill.js";
import { onLanguageChange } from "./panel-language.js";

/** Registers the repaint of the composer pill, the open popover, the Settings forms and the first-run card for each language change. */
export function wireModelLanguage(): void {
  onLanguageChange(() => {
    refreshPickerTrigger();
    repaintOpenMenu();
    repaintModelSettings();
    repaintFirstRun();
  });
}
