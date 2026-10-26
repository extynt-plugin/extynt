/** The chrome group of the catalogue in all six languages. */
import type { DomainText } from "../../message.js";
import { CHROME_EN } from "./en.js";
import { CHROME_ES } from "./es.js";
import { CHROME_DE } from "./de.js";
import { CHROME_FR } from "./fr.js";
import { CHROME_JA } from "./ja.js";
import { CHROME_ZH_HANS } from "./zh-hans.js";

export const CHROME_TEXT: DomainText<typeof CHROME_EN> = { en: CHROME_EN, es: CHROME_ES, de: CHROME_DE, fr: CHROME_FR, ja: CHROME_JA, "zh-Hans": CHROME_ZH_HANS };
