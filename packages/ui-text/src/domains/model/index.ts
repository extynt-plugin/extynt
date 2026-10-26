/** The model group of the catalogue in all six languages. */
import type { DomainText } from "../../message.js";
import { MODEL_EN } from "./en.js";
import { MODEL_ES } from "./es.js";
import { MODEL_DE } from "./de.js";
import { MODEL_FR } from "./fr.js";
import { MODEL_JA } from "./ja.js";
import { MODEL_ZH_HANS } from "./zh-hans.js";

export const MODEL_TEXT: DomainText<typeof MODEL_EN> = { en: MODEL_EN, es: MODEL_ES, de: MODEL_DE, fr: MODEL_FR, ja: MODEL_JA, "zh-Hans": MODEL_ZH_HANS };
