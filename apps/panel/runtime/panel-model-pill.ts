/** The composer's model pill: its words, its tooltip and its accessible name. It opens the one popover for model and effort. */
import { byId } from "./panel-dom.js";
import { t } from "./panel-language.js";
import { effortChoice, effortWords } from "./panel-model-effort.js";
import { modelPillText } from "./panel-model-label.js";
import { activePrimary, pickerSlot } from "./panel-model-store.js";

function describe(model: string, words: string): string {
  return model ? t("model.pill.withModel", { model, effort: words }) : t("model.pill.effortOnly", { effort: words });
}

function paintModelPill(model: string, effort: string | undefined, words: string): void {
  const trigger = byId("model-picker");
  if (!trigger) return;
  const description = describe(model, words);
  trigger.title = description;
  trigger.setAttribute("aria-label", description);
  const text = modelPillText(model, effort);
  const label = trigger.querySelector(".effort-label");
  if (label) label.textContent = text;
  trigger.hidden = text === "";
}

/** Repaints the pill from the chosen model: its name, and the level a request sends, worded as the menu words it. */
export function refreshPickerTrigger(): void {
  const slot = pickerSlot();
  const choice = effortChoice(slot, activePrimary());
  paintModelPill(slot ? slot.displayName || slot.model : "", choice.effective ?? undefined, effortWords(choice, t));
}
