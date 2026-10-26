// The Cloudflare Workers AI dialect: the native /ai/run endpoint in JSON mode, optionally through an AI Gateway, read by the shared language-model tier.
import { decodeJson, jsonObject, object, optional, string, union } from "@extynt/decode";
import type { HttpFetch } from "./http.js";
import { bearerHeaders, postJson } from "./http-port.js";
import { LanguageModelFailure } from "./language-failure.js";
import { LANGUAGE_MODEL_BANDS, languageDecisionModel } from "./language-model.js";
import type { LanguageModelPort, LanguageModelRequest } from "./language-model.js";
import type { DecisionModel } from "./port.js";

/** The variable a Cloudflare entry reads its API token from unless it names another. */
export const CLOUDFLARE_KEY_VARIABLE = "CLOUDFLARE_API_TOKEN";

const API_ROOT = "https://api.cloudflare.com/client/v4/accounts";

const GATEWAY_ROOT = "https://gateway.ai.cloudflare.com/v1";

const DEFAULT_THRESHOLD = 0.7;

const envelope = object({ result: optional(object({ response: optional(union(string(), jsonObject)) })) });

/** How to reach one Workers AI model. */
export interface CloudflareConfig {
  readonly id: string;
  readonly accountId: string;
  readonly model: string;
  readonly apiKey: string;
  readonly fetch: HttpFetch;
  readonly gateway?: string;
}

/** The run URL of a model: direct on the account, or through the named AI Gateway. Model names keep their `@cf/` slashes. */
export function cloudflareUrl(config: Pick<CloudflareConfig, "accountId" | "model" | "gateway">): string {
  const account = encodeURIComponent(config.accountId);
  if (config.gateway === undefined) return `${API_ROOT}/${account}/ai/run/${config.model}`;
  return `${GATEWAY_ROOT}/${account}/${encodeURIComponent(config.gateway)}/workers-ai/${config.model}`;
}

function bodyOf(request: LanguageModelRequest): string {
  return JSON.stringify({
    messages: [{ role: "system", content: request.system }, { role: "user", content: request.user }],
    response_format: { type: "json_schema", json_schema: request.schema },
  });
}

function textOf(body: string): string {
  const parsed = decodeJson(body, envelope);
  if (!parsed.ok) throw new LanguageModelFailure("malformed", parsed.error.message);
  const response = parsed.value.result?.response;
  if (response === undefined) throw new LanguageModelFailure("malformed", "The reply held no response.");
  return typeof response === "string" ? response : JSON.stringify(response);
}

function cloudflarePort(config: CloudflareConfig): LanguageModelPort {
  const url = cloudflareUrl(config);
  return {
    id: config.id,
    completeJson: async (request) => textOf(await postJson({ fetch: config.fetch, url, headers: bearerHeaders(config.apiKey), body: bodyOf(request), signal: request.signal })),
  };
}

/** A decision model for a Workers AI model; uncalibrated, so it routes with the conservative language-model bands. */
export function cloudflareDecisionModel(config: CloudflareConfig): DecisionModel {
  return languageDecisionModel(cloudflarePort(config), DEFAULT_THRESHOLD, { tier: "decision-model", calibrated: false, bands: LANGUAGE_MODEL_BANDS });
}
