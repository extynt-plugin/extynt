/** The status group of the catalogue in all six languages. */
import type { DomainText } from "../../message.js";
import { STATUS_EN } from "./en.js";
import { STATUS_ES } from "./es.js";
import { STATUS_DE } from "./de.js";
import { STATUS_FR } from "./fr.js";
import { STATUS_JA } from "./ja.js";
import { STATUS_ZH_HANS } from "./zh-hans.js";

export const STATUS_TEXT: DomainText<typeof STATUS_EN> = { en: STATUS_EN, es: STATUS_ES, de: STATUS_DE, fr: STATUS_FR, ja: STATUS_JA, "zh-Hans": STATUS_ZH_HANS };
