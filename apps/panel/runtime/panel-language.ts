/** The panel's voice: `t` says a catalogue key in the language the sidecar resolved, and every view that painted text repaints when that language changes. */
import { translatorFor, type Language, type Translate } from "@extynt/ui-text";
import { subscribeUi, uiState } from "./ui-state.js";

const translators = new Map<Language, Translate>();

function translatorOf(language: Language): Translate {
  const known = translators.get(language);
  if (known) return known;
  const made = translatorFor(language);
  translators.set(language, made);
  return made;
}

/** Says the key in the current interface language; the text and its parameters are checked against the English catalogue. */
export const t: Translate = (key, ...params) => translatorOf(uiState().interfaceLanguage)(key, ...params);

/** The language the panel speaks now. */
export function currentLanguage(): Language {
  return uiState().interfaceLanguage;
}

/** Calls the listener after the interface language changes, so a view that painted text once can paint it again; it is not called for the first paint. */
export function onLanguageChange(listener: (language: Language) => void): void {
  subscribeUi((topic) => {
    if (topic !== "language") return;
    listener(currentLanguage());
  });
}
