/** The six languages extynt's own interface speaks, each named in itself, how a locale tag maps onto them, and the decoders of a language that arrives from outside. */
import { refine, string, type Decoder } from "@extynt/decode";

/** Every interface language, English first. */
export const LANGUAGES = ["en", "es", "de", "fr", "ja", "zh-Hans"] as const;

/** One of the six interface languages. */
export type Language = (typeof LANGUAGES)[number];

/** The user's choice in Settings: a language, or "auto" to follow the installer and then After Effects. */
export type LanguageChoice = Language | "auto";

/** What each language calls itself; these are names, so they are never translated. */
export const LANGUAGE_NAMES: Readonly<Record<Language, string>> = {
  en: "English",
  es: "Español",
  de: "Deutsch",
  fr: "Français",
  ja: "日本語",
  "zh-Hans": "简体中文",
};

const TRADITIONAL_CHINESE = /(^|-)(hant|tw|hk|mo)(-|$)/;

/** True for one of the six language codes. */
export function isLanguage(text: string): text is Language {
  return LANGUAGES.some((language) => language === text);
}

/** True for a language code or "auto". */
export function isLanguageChoice(text: string): text is LanguageChoice {
  return text === "auto" || isLanguage(text);
}

/** The interface language a locale tag names ("de-DE", "ja_JP", "zh-CN", "zh-Hans-CN"), or null for a language extynt does not speak, Traditional Chinese included. */
export function languageFromTag(tag: string): Language | null {
  const parts = tag.trim().toLowerCase().replaceAll("_", "-");
  const base = parts.split("-")[0] ?? "";
  if (base === "zh") return TRADITIONAL_CHINESE.test(parts) ? null : "zh-Hans";
  return LANGUAGES.find((language) => language === base) ?? null;
}

/** Accepts exactly one of the six language codes. */
export const languageDecoder: Decoder<Language> = refine(string(), isLanguage, "an interface language");

/** Accepts one of the six language codes or "auto". */
export const languageChoiceDecoder: Decoder<LanguageChoice> = refine(string(), isLanguageChoice, "an interface language or auto");
