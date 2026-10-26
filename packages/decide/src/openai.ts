// The OpenAI-compatible Chat Completions dialect: the batched questions go out with a strict JSON schema response format, and the reply is read by the shared language-model tier.
import { array, decodeJson, nullable, object, optional, string } from "@extynt/decode";
import type { HttpFetch } from "./http.js";
import type { JsonValue } from "./json.js";
import { bearerHeaders, postJson } from "./http-port.js";
import { LanguageModelFailure } from "./language-failure.js";
import { LANGUAGE_MODEL_BANDS, languageDecisionModel } from "./language-model.js";
import type { LanguageModelPort, LanguageModelRequest } from "./language-model.js";
import type { DecisionModel } from "./port.js";
import type { Bands } from "./spec.js";

/** The hosted OpenAI API. */
export const OPENAI_BASE_URL = "https://api.openai.com/v1";

/** The variable an OpenAI entry reads its key from unless it names another. */
export const OPENAI_KEY_VARIABLE = "OPENAI_API_KEY";

const SCHEMA_NAME = "decision_answers";

const DEFAULT_THRESHOLD = 0.7;

const completion = object({
  choices: array(object({ message: object({ content: optional(nullable(string())), refusal: optional(nullable(string())) }) })),
});

/** How to reach one OpenAI-compatible server; `acceptsImages` (default false) says the model reads a picture in the user message. */
export interface OpenAiConfig {
  readonly id: string;
  readonly model: string;
  readonly apiKey?: string;
  readonly fetch: HttpFetch;
  readonly baseUrl?: string;
  readonly threshold?: number;
  readonly calibrated?: boolean;
  readonly acceptsImages?: boolean;
}

function userContentOf(request: LanguageModelRequest): string | ReadonlyArray<JsonValue> {
  if (request.image === undefined) return request.user;
  const url = `data:${request.image.mediaType};base64,${request.image.base64}`;
  return [{ type: "text", text: request.user }, { type: "image_url", image_url: { url } }];
}

function bodyOf(config: OpenAiConfig, request: LanguageModelRequest): string {
  return JSON.stringify({
    model: config.model,
    messages: [{ role: "system", content: request.system }, { role: "user", content: userContentOf(request) }],
    response_format: { type: "json_schema", json_schema: { name: SCHEMA_NAME, strict: true, schema: request.schema } },
  });
}

function isText(value: string | null | undefined): value is string {
  return value !== undefined && value !== null && value !== "";
}

function contentOf(body: string): string {
  const parsed = decodeJson(body, completion);
  if (!parsed.ok) throw new LanguageModelFailure("malformed", parsed.error.message);
  const message = parsed.value.choices[0]?.message;
  if (message === undefined) throw new LanguageModelFailure("malformed", "The reply held no choices.");
  if (isText(message.refusal)) throw new LanguageModelFailure("refused", message.refusal);
  if (!isText(message.content)) throw new LanguageModelFailure("malformed", "The reply held no content.");
  return message.content;
}

function openAiPort(config: OpenAiConfig): LanguageModelPort {
  const url = `${(config.baseUrl ?? OPENAI_BASE_URL).replace(/\/+$/, "")}/chat/completions`;
  return {
    id: config.id,
    completeJson: async (request) => contentOf(await postJson({ fetch: config.fetch, url, headers: bearerHeaders(config.apiKey), body: bodyOf(config, request), signal: request.signal })),
  };
}

/** The bands an entry routes with: its own when calibrated and given a threshold, the fitted ones when calibrated alone, and the conservative language-model bands otherwise. */
export function bandsOfEntry(calibrated: boolean, threshold: number | undefined): Bands | null {
  if (!calibrated) return LANGUAGE_MODEL_BANDS;
  return threshold === undefined ? null : { verify: threshold, act: threshold };
}

/** A decision model for an OpenAI-compatible endpoint; it sits in the decision-model tier, so it wins over the chat-model fallback. */
export function openAiDecisionModel(config: OpenAiConfig): DecisionModel {
  const calibrated = config.calibrated ?? false;
  return languageDecisionModel(openAiPort(config), config.threshold ?? DEFAULT_THRESHOLD, { tier: "decision-model", calibrated, bands: bandsOfEntry(calibrated, config.threshold), acceptsImages: () => config.acceptsImages === true });
}
