/** The whole catalogue: every group of every language merged into one table per language, with the English keys as the type of every key. */
import { CHAT_TEXT } from "./domains/chat/index.js";
import { CHROME_TEXT } from "./domains/chrome/index.js";
import { MEMORY_TEXT } from "./domains/memory/index.js";
import { MODEL_TEXT } from "./domains/model/index.js";
import { NATIVE_TEXT } from "./domains/native/index.js";
import { PLANS_TEXT } from "./domains/plans/index.js";
import { SETTINGS_TEXT } from "./domains/settings/index.js";
import { SIDECAR_FAILURE_TEXT } from "./domains/sidecar-failure/index.js";
import { SIDECAR_PLAN_TEXT } from "./domains/sidecar-plan/index.js";
import { STATUS_TEXT } from "./domains/status/index.js";
import type { Language } from "./languages.js";
import type { Entry } from "./message.js";

const ENGLISH = {
  ...CHROME_TEXT.en,
  ...SETTINGS_TEXT.en,
  ...CHAT_TEXT.en,
  ...PLANS_TEXT.en,
  ...STATUS_TEXT.en,
  ...MODEL_TEXT.en,
  ...MEMORY_TEXT.en,
  ...SIDECAR_FAILURE_TEXT.en,
  ...SIDECAR_PLAN_TEXT.en,
  ...NATIVE_TEXT.en,
};

/** The English source catalogue, whose keys and wording every other language follows. */
export type SourceCatalogue = typeof ENGLISH;

/** Every key the interface can say. */
export type UiKey = keyof SourceCatalogue;

/** One language's complete table. */
export type LanguageTable = Readonly<Record<UiKey, Entry>>;

const GROUPS = [CHROME_TEXT, SETTINGS_TEXT, CHAT_TEXT, PLANS_TEXT, STATUS_TEXT, MODEL_TEXT, MEMORY_TEXT, SIDECAR_FAILURE_TEXT, SIDECAR_PLAN_TEXT, NATIVE_TEXT];

/** Every group's own table for one language, kept apart so a test can see a key that two groups both define. */
export function groupTables(language: Language): ReadonlyArray<Readonly<Record<string, Entry>>> {
  return GROUPS.map((group) => group[language]);
}

/** The catalogue of every language, keyed by language. */
export const CATALOGUES: Readonly<Record<Language, LanguageTable>> = {
  en: ENGLISH,
  es: { ...CHROME_TEXT.es, ...SETTINGS_TEXT.es, ...CHAT_TEXT.es, ...PLANS_TEXT.es, ...STATUS_TEXT.es, ...MODEL_TEXT.es, ...MEMORY_TEXT.es, ...SIDECAR_FAILURE_TEXT.es, ...SIDECAR_PLAN_TEXT.es, ...NATIVE_TEXT.es },
  de: { ...CHROME_TEXT.de, ...SETTINGS_TEXT.de, ...CHAT_TEXT.de, ...PLANS_TEXT.de, ...STATUS_TEXT.de, ...MODEL_TEXT.de, ...MEMORY_TEXT.de, ...SIDECAR_FAILURE_TEXT.de, ...SIDECAR_PLAN_TEXT.de, ...NATIVE_TEXT.de },
  fr: { ...CHROME_TEXT.fr, ...SETTINGS_TEXT.fr, ...CHAT_TEXT.fr, ...PLANS_TEXT.fr, ...STATUS_TEXT.fr, ...MODEL_TEXT.fr, ...MEMORY_TEXT.fr, ...SIDECAR_FAILURE_TEXT.fr, ...SIDECAR_PLAN_TEXT.fr, ...NATIVE_TEXT.fr },
  ja: { ...CHROME_TEXT.ja, ...SETTINGS_TEXT.ja, ...CHAT_TEXT.ja, ...PLANS_TEXT.ja, ...STATUS_TEXT.ja, ...MODEL_TEXT.ja, ...MEMORY_TEXT.ja, ...SIDECAR_FAILURE_TEXT.ja, ...SIDECAR_PLAN_TEXT.ja, ...NATIVE_TEXT.ja },
  "zh-Hans": {
    ...CHROME_TEXT["zh-Hans"], ...SETTINGS_TEXT["zh-Hans"], ...CHAT_TEXT["zh-Hans"], ...PLANS_TEXT["zh-Hans"], ...STATUS_TEXT["zh-Hans"], ...MODEL_TEXT["zh-Hans"],
    ...MEMORY_TEXT["zh-Hans"], ...SIDECAR_FAILURE_TEXT["zh-Hans"], ...SIDECAR_PLAN_TEXT["zh-Hans"], ...NATIVE_TEXT["zh-Hans"],
  },
};
