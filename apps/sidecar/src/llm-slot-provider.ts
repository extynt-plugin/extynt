// Builds the chat provider for a resolved model slot, and applies the training-risk refusal to it.
import { MockProvider, type ChatProvider, type ModelCapabilities, type ReasoningEffort, type SecretSource } from "@extynt/llm";
import type { Translate } from "@extynt/ui-text";
import { AnthropicProvider } from "@extynt/llm/anthropic";
import { OpenAICompatibleProvider } from "@extynt/llm/openai";
import { ENGLISH_FAILURE_TEXT } from "./failure-english.js";
import { mockAgentScript } from "./llm-mock-agent.js";
import type { ResolvedSlot } from "./llm-slot-resolution.js";
import { guardProvider, isLoopbackHost, trainingRefusal } from "./training-policy.js";

/** A provider, or the reason none could be built; both are absent for a slot that is not set. */
export interface BuiltProvider {
  readonly provider?: ChatProvider;
  readonly error?: string;
}

interface GuardedProvider {
  readonly provider?: ChatProvider;
  readonly errors: readonly string[];
}

interface ProviderTarget {
  readonly resolved: ResolvedSlot;
  readonly secretSource: SecretSource;
  readonly displayName: string;
  readonly known: ModelCapabilities | undefined;
}

function providerEndpoint(resolved: ResolvedSlot, t: Translate): { displayName: string } | { error: string } {
  let url: URL;
  try {
    url = new URL(resolved.baseUrl);
  } catch {
    return { error: t("failure.settings.badUrl", { url: resolved.baseUrl }) };
  }
  if (url.protocol === "http:" && resolved.apiKey && !isLoopbackHost(url.hostname)) {
    return { error: t("failure.settings.insecureHost", { host: url.hostname }) };
  }
  return { displayName: resolved.service.id.startsWith("custom") ? url.hostname : resolved.service.label };
}

function optionalSettings(resolved: ResolvedSlot): { acceptsImages?: boolean; reasoningEffort?: ReasoningEffort } {
  return {
    ...(resolved.acceptsImages === undefined ? {} : { acceptsImages: resolved.acceptsImages }),
    ...(resolved.reasoningEffort ? { reasoningEffort: resolved.reasoningEffort } : {}),
  };
}

function buildAnthropicProvider({ resolved, secretSource, displayName, known }: ProviderTarget): ChatProvider {
  const id = resolved.service.id === "anthropic" ? "anthropic-messages" : `${resolved.service.id}-messages`;
  return new AnthropicProvider({
    secretSource, ...(known ? { capabilities: known } : {}), endpoint: resolved.baseUrl, model: resolved.model,
    config: { id, displayName, contextWindow: resolved.contextWindow, ...optionalSettings(resolved) },
    ...(resolved.maxOutputTokens ? { maxTokens: resolved.maxOutputTokens } : {}),
  });
}

function buildOpenAiProvider({ resolved, secretSource, displayName, known }: ProviderTarget): ChatProvider {
  const id = resolved.service.id === "deepseek" ? "deepseek-flash" : `${resolved.service.id}-chat`;
  return new OpenAICompatibleProvider({
    secretSource, ...(known ? { capabilities: known } : {}),
    config: { id, displayName, endpoint: resolved.baseUrl, model: resolved.model, authSource: "server-environment", contextWindow: resolved.contextWindow, stream: resolved.stream, ...optionalSettings(resolved) },
    ...(resolved.maxOutputTokens ? { maxTokens: resolved.maxOutputTokens } : {}),
  });
}

function buildNetworkProvider(resolved: ResolvedSlot, displayName: string, known: ModelCapabilities | undefined, t: Translate): BuiltProvider {
  const secretSource: SecretSource = { authSource: "server-environment", resolve: () => resolved.apiKey || undefined, ...(resolved.service.keyRequired ? {} : { keyless: true }) };
  const target: ProviderTarget = { resolved, secretSource, displayName, known };
  try {
    return { provider: resolved.format === "anthropic" ? buildAnthropicProvider(target) : buildOpenAiProvider(target) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : t("failure.settings.invalid") };
  }
}

/** The key a model's learned capabilities are kept under: the same model behind another endpoint may take other things. */
export function capabilityKey(resolved: ResolvedSlot): string {
  return `${resolved.format}|${resolved.baseUrl}|${resolved.model}`;
}

/**
 * The provider for a slot, or the reason it cannot be built. `known` is what this model already reported in an earlier
 * build of the same slot, so a settings save does not forget it. A server that needs no key gets no credential header,
 * never a placeholder one, and a keyless http address stays allowed (Ollama on a LAN machine): only a key needs the
 * encrypted transport.
 */
export function createSlotProvider(resolved: ResolvedSlot | undefined, known?: ModelCapabilities, t: Translate = ENGLISH_FAILURE_TEXT): BuiltProvider {
  if (!resolved) return {};
  if (resolved.format === "mock") return { provider: new MockProvider({ script: mockAgentScript, ...(resolved.acceptsImages !== undefined ? { acceptsImages: resolved.acceptsImages } : {}) }) };
  if (!resolved.baseUrl) return { error: t("failure.settings.needsBaseUrl", { service: resolved.service.label }) };
  if (!resolved.model) return { error: t("failure.settings.needsModel", { service: resolved.service.label }) };
  const endpoint = providerEndpoint(resolved, t);
  return "error" in endpoint ? endpoint : buildNetworkProvider(resolved, endpoint.displayName, known, t);
}

/** A built slot with its training refusal applied: an unacknowledged may-train provider is wrapped so it refuses before any network call, and the refusal is also listed as a settings error. */
export function guardedSlot(resolved: ResolvedSlot | undefined, built: BuiltProvider, t: Translate = ENGLISH_FAILURE_TEXT): GuardedProvider {
  const refusal = resolved && built.provider ? trainingRefusal(resolved) : undefined;
  const errors = [...built.error ? [built.error] : [], ...refusal ? [t("failure.trainingRisk", { label: refusal.label })] : []];
  if (!built.provider) return { errors };
  return { provider: refusal ? guardProvider(built.provider, refusal) : built.provider, errors };
}
