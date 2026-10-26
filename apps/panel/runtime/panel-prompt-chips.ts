/** The prompt chips: what to suggest for the current selection, and the row of buttons that fill the composer. */
import type { UiKey } from "@extynt/ui-text";
import { el } from "./panel-dom.js";
import { hooks } from "./panel-hooks.js";
import { t } from "./panel-language.js";
import { offeredSuggestions } from "./panel-suggest-view.js";
import type { UiFocus } from "./ui-contract.js";

type ChipKey = Extract<UiKey, `chrome.chips.${string}`>;

const NO_SELECTION_PROMPTS: ReadonlyArray<ChipKey> = ["chrome.chips.whatCanYouDo", "chrome.chips.make1080p", "chrome.chips.checkProject", "chrome.chips.listComps"];
const MANY_PROMPTS: ReadonlyArray<ChipKey> = ["chrome.chips.staggerFrames", "chrome.chips.parentToNull", "chrome.chips.fadeOutEnd", "chrome.chips.alignCenter"];
const TEXT_PROMPTS: ReadonlyArray<ChipKey> = ["chrome.chips.typeOnByLetter", "chrome.chips.slideUpEaseOut", "chrome.chips.tightenTracking", "chrome.chips.dropShadow"];
const LAYER_PROMPTS: ReadonlyArray<ChipKey> = ["chrome.chips.popWithBounce", "chrome.chips.dropShadow", "chrome.chips.blurInQuickly", "chrome.chips.fadeInOneSecond"];
const COMP_PROMPTS: ReadonlyArray<ChipKey> = ["chrome.chips.compContents", "chrome.chips.findSlowLayers", "chrome.chips.addTitle", "chrome.chips.addBackground"];

function suggestedKeys(focus: UiFocus | null): ReadonlyArray<ChipKey> {
  if (!focus || !focus.compositionName) return NO_SELECTION_PROMPTS;
  if (focus.selected > 1) return MANY_PROMPTS;
  if (focus.selected === 1) return focus.kinds.includes("text") ? TEXT_PROMPTS : LAYER_PROMPTS;
  return COMP_PROMPTS;
}

function suggestedPrompts(focus: UiFocus | null): ReadonlyArray<string> {
  return suggestedKeys(focus).map((key) => t(key));
}

/** The row of prompt chips: live ones fill the composer when pressed; the rest are shown dimmed and do nothing. */
export function chipRow(focus: UiFocus | null, live: boolean): HTMLElement {
  const chips = el("div", "chips fill");
  const offered = offeredSuggestions();
  const prompts = live && offered.length > 0 ? offered : suggestedPrompts(focus);
  prompts.forEach((text) => {
    const chip = el("button");
    chip.appendChild(el("span", "", text));
    chip.type = "button";
    chip.title = text;
    if (!live) chip.disabled = true;
    else chip.addEventListener("click", () => hooks.fillComposer(text));
    chips.appendChild(chip);
  });
  return chips;
}
