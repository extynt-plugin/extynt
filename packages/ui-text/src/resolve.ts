/** The one rule that picks the interface language: the user's choice, then the installer's, then After Effects', then English. */
import { isLanguage, languageFromTag, type Language, type LanguageChoice } from "./languages.js";

/** Where each candidate comes from; a missing or unreadable source is null. */
export interface LanguageSources {
  readonly choice: LanguageChoice;
  readonly installerTag: string | null;
  readonly hostTag: string | null;
}

function fromTag(tag: string | null): Language | null {
  return tag === null ? null : languageFromTag(tag);
}

/** The language to speak: an explicit choice wins; "auto" falls to the installer's tag, then After Effects' language tag, then English. */
export function resolveLanguage(sources: LanguageSources): Language {
  if (isLanguage(sources.choice)) return sources.choice;
  return fromTag(sources.installerTag) ?? fromTag(sources.hostTag) ?? "en";
}
