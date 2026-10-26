/** The plans group of the catalogue in all six languages. */
import type { DomainText } from "../../message.js";
import { PLANS_EN } from "./en.js";
import { PLANS_ES } from "./es.js";
import { PLANS_DE } from "./de.js";
import { PLANS_FR } from "./fr.js";
import { PLANS_JA } from "./ja.js";
import { PLANS_ZH_HANS } from "./zh-hans.js";

export const PLANS_TEXT: DomainText<typeof PLANS_EN> = { en: PLANS_EN, es: PLANS_ES, de: PLANS_DE, fr: PLANS_FR, ja: PLANS_JA, "zh-Hans": PLANS_ZH_HANS };
