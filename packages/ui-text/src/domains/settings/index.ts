/** The settings group of the catalogue in all six languages. */
import type { DomainText } from "../../message.js";
import { SETTINGS_EN } from "./en.js";
import { SETTINGS_ES } from "./es.js";
import { SETTINGS_DE } from "./de.js";
import { SETTINGS_FR } from "./fr.js";
import { SETTINGS_JA } from "./ja.js";
import { SETTINGS_ZH_HANS } from "./zh-hans.js";

export const SETTINGS_TEXT: DomainText<typeof SETTINGS_EN> = { en: SETTINGS_EN, es: SETTINGS_ES, de: SETTINGS_DE, fr: SETTINGS_FR, ja: SETTINGS_JA, "zh-Hans": SETTINGS_ZH_HANS };
