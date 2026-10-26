/** The native group of the catalogue in all six languages. */
import type { DomainText } from "../../message.js";
import { NATIVE_EN } from "./en.js";
import { NATIVE_ES } from "./es.js";
import { NATIVE_DE } from "./de.js";
import { NATIVE_FR } from "./fr.js";
import { NATIVE_JA } from "./ja.js";
import { NATIVE_ZH_HANS } from "./zh-hans.js";

export const NATIVE_TEXT: DomainText<typeof NATIVE_EN> = { en: NATIVE_EN, es: NATIVE_ES, de: NATIVE_DE, fr: NATIVE_FR, ja: NATIVE_JA, "zh-Hans": NATIVE_ZH_HANS };
