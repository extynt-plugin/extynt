/** The saved shape of a provider slot (endpoint, model, effort, image setting), the display metadata derived from it, and the rules a config must satisfy. */
import { redactText } from "./redaction.js";
import type { AuthSource } from "./provider-secret.js";

export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** What the live APIs accept, read off their own rejection of an unknown value; an adapter forwards only what its own provider documents, and absent sends nothing so the provider's default applies. */
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** The window assumed when neither the caller nor the provider declares one; deliberately conservative, because compacting early is recoverable and an oversized prompt is rejected. */
export const ASSUMED_CONTEXT_WINDOW = 128_000;

/** Stands in for an attached frame the model cannot take, so the model knows it was not shown one. */
export const IMAGE_WITHHELD_NOTE = "[The attached frame was not sent: this model does not accept images. Answer from the project data, and say that you could not see the frame.]";

/** A provider slot as saved. `contextWindow` is the total tokens the model accepts in one request (absent: callers assume conservatively). `stream` sends `stream: true`; it is off by default, because a provider that ignores it makes every step pay for the prompt twice. `acceptsImages` is the user's own answer to "does this model take images", which outranks the model's report; absent means ask the model: its provider's metadata, or its refusal of the first image it is sent. */
export interface ProviderConfig {
  id: string;
  endpoint: string;
  model: string;
  authSource: AuthSource;
  displayName?: string;
  contextWindow?: number;
  reasoningEffort?: ReasoningEffort;
  stream?: boolean;
  acceptsImages?: boolean;
}

export interface ProviderDisplayMetadata {
  id: string;
  displayName: string;
  endpoint: string;
  model: string;
  authSource: AuthSource;
  keyConfigured: boolean;
  contextWindow?: number;
  reasoningEffort?: ReasoningEffort;
  acceptsImages?: boolean;
}

export function isReasoningEffort(value: string): value is ReasoningEffort {
  return REASONING_EFFORTS.some((effort) => effort === value);
}

/** Caps an effort at a ceiling, keeping a lower choice as it is. */
export function effortAtMost(effort: ReasoningEffort | undefined, ceiling: ReasoningEffort): ReasoningEffort | undefined {
  if (effort === undefined) return undefined;
  return REASONING_EFFORTS.indexOf(effort) > REASONING_EFFORTS.indexOf(ceiling) ? ceiling : effort;
}

/** Validate a per-request override at the same trust boundary as saved provider config. */
export function validatedReasoningEffort(value: string | undefined): ReasoningEffort | undefined {
  if (value === undefined) return undefined;
  if (!isReasoningEffort(value)) throw new Error(`Provider reasoningEffort must be one of ${REASONING_EFFORTS.join(", ")}.`);
  return value;
}

/** Whether a step may carry an image: the user's setting if there is one, else the model's own report; a model nothing has reported on is sent the image, because its provider answers a model that cannot take one with a refusal. */
export function imagesAccepted(declared: boolean | undefined, reported: boolean | undefined): boolean {
  return (declared ?? reported) !== false;
}

export function providerDisplayMetadata(config: ProviderConfig, keyConfigured: boolean): ProviderDisplayMetadata {
  const contextWindow = declaredContextWindow(config);
  return {
    id: redactDisplay(config.id),
    displayName: redactDisplay(config.displayName ?? config.id),
    endpoint: safeEndpointDisplay(config.endpoint),
    model: redactDisplay(config.model),
    authSource: config.authSource,
    keyConfigured,
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(config.reasoningEffort !== undefined ? { reasoningEffort: config.reasoningEffort } : {}),
    ...(config.acceptsImages !== undefined ? { acceptsImages: config.acceptsImages } : {}),
  };
}

/** The rules below run in this order: the first one a config breaks is the one its caller is told about. */
export function validateProviderConfig(config: ProviderConfig): ProviderConfig {
  requireIdentity(config);
  requireContextWindow(config);
  validatedReasoningEffort(config.reasoningEffort);
  const url = new URL(config.endpoint);
  requireSecureEndpoint(url);
  requireCredentialFreeEndpoint(url);
  return { ...config, endpoint: config.endpoint.replace(/\/$/, "") };
}

function declaredContextWindow(config: Pick<ProviderConfig, "contextWindow">): number | undefined {
  const value = config.contextWindow;
  return Number.isInteger(value) && (value ?? 0) > 0 ? value : undefined;
}

function safeEndpointDisplay(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return redactDisplay(endpoint);
  }
}

function redactDisplay(value: string): string {
  return redactText(value, { includeFilePaths: true, maxStringLength: 200 }).value;
}

function requireIdentity(config: ProviderConfig): void {
  if (!config.id || !config.endpoint || !config.model) throw new Error("Provider id, endpoint, and model are required.");
}

function requireContextWindow(config: ProviderConfig): void {
  if (config.contextWindow !== undefined && (!Number.isInteger(config.contextWindow) || config.contextWindow <= 0)) throw new Error("Provider contextWindow must be a positive integer number of tokens.");
}

function requireSecureEndpoint(url: URL): void {
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("Provider endpoint must use HTTPS, except for local development endpoints.");
  }
}

function requireCredentialFreeEndpoint(url: URL): void {
  if (url.username || url.password || url.search || url.hash) throw new Error("Provider endpoint must not contain credentials, query strings, or fragments.");
}
