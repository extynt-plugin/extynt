/** The chat group of the catalogue in all six languages. */
import type { DomainText } from "../../message.js";
import { CHAT_EN } from "./en.js";
import { CHAT_ES } from "./es.js";
import { CHAT_DE } from "./de.js";
import { CHAT_FR } from "./fr.js";
import { CHAT_JA } from "./ja.js";
import { CHAT_ZH_HANS } from "./zh-hans.js";

export const CHAT_TEXT: DomainText<typeof CHAT_EN> = { en: CHAT_EN, es: CHAT_ES, de: CHAT_DE, fr: CHAT_FR, ja: CHAT_JA, "zh-Hans": CHAT_ZH_HANS };
