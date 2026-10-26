// The TypeSafe AI "Jev" preset of the system-one adapter: its hosted address, its model name and the threshold its confidences are read at.
import type { HttpFetch } from "./http.js";
import type { DecisionModel } from "./port.js";
import { systemOneDecisionModel } from "./system-one.js";
import type { SystemOneConfig } from "./system-one.js";

/** The hosted Jev API. */
export const JEV_BASE_URL = "https://api.typesafe.ai";

/** The model Jev serves unless told otherwise. */
export const JEV_DEFAULT_MODEL = "jev-latest";

/** The confidence below which a Jev answer is not trusted. */
export const JEV_DEFAULT_THRESHOLD = 0.7;

/** What Jev needs beyond its fixed address. */
export interface JevConfig {
  readonly apiKey: string;
  readonly fetch: HttpFetch;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly threshold?: number;
  readonly pause?: SystemOneConfig["pause"];
  readonly jitter?: SystemOneConfig["jitter"];
}

/** The Jev decision model; its confidences are calibrated probabilities. */
export function jevDecisionModel(config: JevConfig): DecisionModel {
  return systemOneDecisionModel({
    id: "jev",
    baseUrl: config.baseUrl ?? JEV_BASE_URL,
    model: config.model ?? JEV_DEFAULT_MODEL,
    apiKey: config.apiKey,
    threshold: config.threshold ?? JEV_DEFAULT_THRESHOLD,
    calibrated: true,
    fetch: config.fetch,
    ...(config.pause === undefined ? {} : { pause: config.pause }),
    ...(config.jitter === undefined ? {} : { jitter: config.jitter }),
  });
}
