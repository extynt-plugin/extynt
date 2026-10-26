/** The sidecar failure group of the catalogue in all six languages. */
import type { DomainText } from "../../message.js";
import { SIDECAR_FAILURE_EN } from "./en.js";
import { SIDECAR_FAILURE_ES } from "./es.js";
import { SIDECAR_FAILURE_DE } from "./de.js";
import { SIDECAR_FAILURE_FR } from "./fr.js";
import { SIDECAR_FAILURE_JA } from "./ja.js";
import { SIDECAR_FAILURE_ZH_HANS } from "./zh-hans.js";

export const SIDECAR_FAILURE_TEXT: DomainText<typeof SIDECAR_FAILURE_EN> = { en: SIDECAR_FAILURE_EN, es: SIDECAR_FAILURE_ES, de: SIDECAR_FAILURE_DE, fr: SIDECAR_FAILURE_FR, ja: SIDECAR_FAILURE_JA, "zh-Hans": SIDECAR_FAILURE_ZH_HANS };
