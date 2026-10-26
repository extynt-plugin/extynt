/** The memory group of the catalogue in all six languages. */
import type { DomainText } from "../../message.js";
import { MEMORY_EN } from "./en.js";
import { MEMORY_ES } from "./es.js";
import { MEMORY_DE } from "./de.js";
import { MEMORY_FR } from "./fr.js";
import { MEMORY_JA } from "./ja.js";
import { MEMORY_ZH_HANS } from "./zh-hans.js";

export const MEMORY_TEXT: DomainText<typeof MEMORY_EN> = { en: MEMORY_EN, es: MEMORY_ES, de: MEMORY_DE, fr: MEMORY_FR, ja: MEMORY_JA, "zh-Hans": MEMORY_ZH_HANS };
