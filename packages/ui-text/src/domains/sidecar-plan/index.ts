/** The sidecar plan group of the catalogue in all six languages. */
import type { DomainText } from "../../message.js";
import { SIDECAR_PLAN_EN } from "./en.js";
import { SIDECAR_PLAN_ES } from "./es.js";
import { SIDECAR_PLAN_DE } from "./de.js";
import { SIDECAR_PLAN_FR } from "./fr.js";
import { SIDECAR_PLAN_JA } from "./ja.js";
import { SIDECAR_PLAN_ZH_HANS } from "./zh-hans.js";

export const SIDECAR_PLAN_TEXT: DomainText<typeof SIDECAR_PLAN_EN> = { en: SIDECAR_PLAN_EN, es: SIDECAR_PLAN_ES, de: SIDECAR_PLAN_DE, fr: SIDECAR_PLAN_FR, ja: SIDECAR_PLAN_JA, "zh-Hans": SIDECAR_PLAN_ZH_HANS };
