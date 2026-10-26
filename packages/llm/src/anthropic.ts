/** The Anthropic Messages adapter: one provider class over the request, wire and stream modules. */
import { providerDisplayMetadata, validateProviderConfig, type ProviderConfig, type ProviderDisplayMetadata } from "./provider-config.js";
import { apiKeyHeader, createServerEnvironmentSecret, requestCredential, type SecretSource } from "./provider-secret.js";
import { AGENT_STEP_TIMEOUT_FLOOR_MS, linkAbortSignal, startStallGuard, type StallGuard } from "./provider-stall.js";
import { anthropicCapabilities, anthropicMaxTokens, anthropicRefusalLesson } from "./anthropic-reasoning.js";
import { anthropicStepBody, anthropicCompletionBody, sentFeatures, type AnthropicStepSettings } from "./anthropic-request.js";
import { anthropicStructuredBody, anthropicStructuredText } from "./anthropic-structured.js";
import { anthropicStreamResult } from "./anthropic-stream.js";
import { anthropicErrorDetail, anthropicModelEntryShape, anthropicReplyShape, anthropicTokenUsage, interpretAnthropicReply, MAX_TOKENS_MESSAGE, type AnthropicModelEntry, type AnthropicReply } from "./anthropic-wire.js";
import { CapabilityLedger, type ModelCapabilities } from "./model-capabilities.js";
import { ProviderHttpError } from "./provider-http-error.js";
import { DEFAULT_REQUEST_TIMEOUT_MS, DISCOVERY_TIMEOUT_MS, REFUSAL_LESSONS_PER_STEP, keyReady, positiveInteger, positiveLimit, serverFetch, withTimeout } from "./provider-runtime.js";
import type { AnthropicMessagesRequest, AnthropicStepRequest, AnthropicStructuredRequest } from "./provider-wire.js";
import type { AgentStepInput, AgentStepResult, JsonCompletionRequest, JsonSchemaSpec, ProviderCompletion, ProviderInput, StructuredOutputProvider, ToolCallingProvider } from "./types.js";
import { completionUsage, readBody } from "./wire-common.js";

export { ProviderHttpError } from "./provider-http-error.js";

const ANTHROPIC_VERSION = "2023-06-01";
const THINKING_BINDING_REFUSAL = /Invalid `?signature`? in `?thinking`? block/i;

export interface AnthropicProviderOptions {
  config?: Partial<ProviderConfig>;
  secretSource?: SecretSource;
  model?: string;
  endpoint?: string;
  maxTokens?: number;
  requestTimeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  environment?: Readonly<Record<string, string | undefined>>;
  capabilities?: ModelCapabilities;
}

/** Calls the Messages API. A step is sent again when a refusal names something the model does not take, later steps are built without it, and a model entry the gateway does not publish leaves the model unreported without failing. */
export class AnthropicProvider implements ToolCallingProvider, StructuredOutputProvider {
  public readonly id: string;
  public readonly model: string;
  public readonly config: ProviderConfig;
  public readonly capabilities: CapabilityLedger;
  private readonly secretSource: SecretSource;
  private readonly maxTokens: number | undefined;
  private readonly requestTimeoutMs: number;
  private readonly request: typeof globalThis.fetch;
  private replayThinking = true;

  public constructor(options: AnthropicProviderOptions = {}) {
    this.secretSource = options.secretSource ?? createServerEnvironmentSecret(options.environment, "ANTHROPIC_API_KEY");
    this.config = anthropicConfig(options, this.secretSource);
    this.id = this.config.id;
    this.model = this.config.model;
    this.maxTokens = positiveInteger(options.maxTokens);
    this.requestTimeoutMs = positiveLimit(options.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);
    this.request = serverFetch(options.fetch);
    this.capabilities = new CapabilityLedger(options.capabilities);
  }

  public get displayMetadata(): ProviderDisplayMetadata {
    return providerDisplayMetadata(this.config, keyReady(this.secretSource));
  }

  public async discoverCapabilities(): Promise<void> {
    const apiKey = this.secretSource.resolve() ?? "";
    if (!apiKey && this.secretSource.keyless !== true) return;
    const entry = await withTimeout(DISCOVERY_TIMEOUT_MS, (signal) => this.modelEntry(apiKey, signal)).catch(() => undefined);
    if (entry) this.capabilities.record(anthropicCapabilities(entry));
  }

  public async complete(input: ProviderInput): Promise<ProviderCompletion> {
    const apiKey = requestCredential(this.secretSource);
    return withTimeout(this.requestTimeoutMs, async (signal) => {
      const response = await this.post(apiKey, anthropicCompletionBody(input, this.model, anthropicMaxTokens(this.capabilities.current, this.maxTokens)), signal);
      if (!response.ok) throw new ProviderHttpError(response.status, await anthropicHttpFailure(response));
      const reply = interpretAnthropicReply(await readBody(response, anthropicReplyShape, {}));
      if (reply.stopReason === "max_tokens") throw new ProviderHttpError(response.status, MAX_TOKENS_MESSAGE);
      if (!reply.text) throw new ProviderHttpError(response.status, "The Anthropic Messages API returned no text output.");
      return completionOf(reply.text, reply, response.headers.get("request-id"));
    });
  }

  public async completeJson(request: JsonCompletionRequest, schema: JsonSchemaSpec): Promise<string> {
    const apiKey = requestCredential(this.secretSource);
    const settings = { model: this.model, maxTokens: this.maxTokens, capabilities: this.capabilities.current };
    return withTimeout(this.requestTimeoutMs, async (signal) => {
      const response = await this.post(apiKey, anthropicStructuredBody(request, schema, settings), signal);
      if (!response.ok) throw new ProviderHttpError(response.status, await anthropicHttpFailure(response));
      const reply = interpretAnthropicReply(await readBody(response, anthropicReplyShape, {}));
      if (reply.stopReason === "max_tokens") throw new ProviderHttpError(response.status, MAX_TOKENS_MESSAGE);
      return anthropicStructuredText(reply, schema, response.status);
    }, request.signal);
  }

  public async step(input: AgentStepInput): Promise<AgentStepResult> {
    const apiKey = requestCredential(this.secretSource);
    const controller = new AbortController();
    const guard = startStallGuard(controller, input.stallTimeoutMs);
    const releaseAbort = linkAbortSignal(input.signal, controller);
    try {
      return await this.stepWithin(apiKey, input, controller.signal, guard);
    } catch (error) {
      throw guard.fired ?? error;
    } finally {
      guard.stop();
      releaseAbort();
    }
  }

  private async stepWithin(apiKey: string, input: AgentStepInput, signal: AbortSignal, guard: StallGuard): Promise<AgentStepResult> {
    if (input.forceStream !== true || input.tools.length > 0) return this.ordinaryStep(apiKey, input, signal, guard);
    const response = await this.send(apiKey, input, true, signal);
    if (!response.ok) throw new ProviderHttpError(response.status, await anthropicHttpFailure(response));
    if (!response.body) throw new ProviderHttpError(response.status, "The Anthropic Messages API returned no stream body.");
    const streamed = await anthropicStreamResult(response.body, input, response.status, guard.touch);
    return streamed ?? this.ordinaryStep(apiKey, input, signal, guard);
  }

  private async ordinaryStep(apiKey: string, input: AgentStepInput, signal: AbortSignal, guard: StallGuard): Promise<AgentStepResult> {
    guard.cap(Math.max(this.requestTimeoutMs, AGENT_STEP_TIMEOUT_FLOOR_MS));
    const response = await this.send(apiKey, input, false, signal);
    if (!response.ok) throw new ProviderHttpError(response.status, await anthropicHttpFailure(response));
    return stepResultOf(interpretAnthropicReply(await readBody(response, anthropicReplyShape, {})), response.status);
  }

  private async send(apiKey: string, input: AgentStepInput, stream: boolean, signal: AbortSignal): Promise<Response> {
    for (let lessons = 0; ; lessons += 1) {
      const settings = this.settings();
      const body = anthropicStepBody(input, settings);
      let response = await this.post(apiKey, streaming(body, stream), signal);
      if (this.replayThinking && await thinkingBindingRefused(response)) {
        this.replayThinking = false;
        response = await this.post(apiKey, streaming(anthropicStepBody(input, { ...settings, replayThinking: false }), stream), signal);
      }
      if (lessons >= REFUSAL_LESSONS_PER_STEP || !await this.learnFrom(response, body)) return response;
    }
  }

  private async learnFrom(response: Response, body: AnthropicStepRequest): Promise<boolean> {
    if (response.status !== 400) return false;
    const lesson = anthropicRefusalLesson(await response.clone().text().catch(() => ""), sentFeatures(body));
    return lesson !== undefined && this.capabilities.record(lesson);
  }

  private settings(): AnthropicStepSettings {
    return { config: this.config, model: this.model, maxTokens: this.maxTokens, replayThinking: this.replayThinking, capabilities: this.capabilities.current };
  }

  private post(apiKey: string, body: AnthropicMessagesRequest | AnthropicStepRequest | AnthropicStructuredRequest, signal: AbortSignal): Promise<Response> {
    return this.request(`${this.config.endpoint}/messages`, { method: "POST", headers: { ...apiKeyHeader(apiKey), "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" }, body: JSON.stringify(body), signal });
  }

  private async modelEntry(apiKey: string, signal: AbortSignal): Promise<AnthropicModelEntry | undefined> {
    const response = await this.request(`${this.config.endpoint}/models/${encodeURIComponent(this.model)}`, { headers: { ...apiKeyHeader(apiKey), "anthropic-version": ANTHROPIC_VERSION }, signal });
    return response.ok ? readBody(response, anthropicModelEntryShape, {}) : undefined;
  }
}

export function createAnthropicProvider(options: AnthropicProviderOptions = {}): AnthropicProvider {
  return new AnthropicProvider(options);
}

function anthropicConfig(options: AnthropicProviderOptions, secretSource: SecretSource): ProviderConfig {
  return validateProviderConfig({
    id: options.config?.id ?? "anthropic-messages",
    displayName: "Anthropic Messages",
    endpoint: options.endpoint ?? "https://api.anthropic.com/v1",
    model: options.model ?? "claude-sonnet-5",
    authSource: secretSource.authSource,
    ...options.config,
  });
}

function streaming(body: AnthropicStepRequest, stream: boolean): AnthropicStepRequest {
  return stream ? { ...body, stream: true } : body;
}

function completionOf(answer: string, reply: AnthropicReply, requestId: string | null): ProviderCompletion {
  const usage = reply.usage;
  return {
    answer,
    ...(requestId ? { providerRequestId: requestId } : {}),
    ...(usage ? { usage: completionUsage({ input: usage.input_tokens, output: usage.output_tokens, total: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) }) } : {}),
  };
}

function stepResultOf(reply: AnthropicReply, status: number): AgentStepResult {
  if (reply.stopReason === "max_tokens") throw new ProviderHttpError(status, MAX_TOKENS_MESSAGE);
  if (!reply.text && !reply.toolCalls.length) throw new ProviderHttpError(status, "The Anthropic Messages API returned no text or tool calls.");
  return {
    text: reply.text ?? "",
    toolCalls: reply.toolCalls,
    raw: reply.blocks,
    ...(reply.stopReason ? { finishReason: reply.stopReason } : {}),
    ...(reply.usage ? { usage: anthropicTokenUsage(reply.usage) } : {}),
  };
}

async function thinkingBindingRefused(response: Response): Promise<boolean> {
  if (response.status !== 400) return false;
  return THINKING_BINDING_REFUSAL.test(await response.clone().text().catch(() => ""));
}

async function anthropicHttpFailure(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  const bounded = anthropicErrorDetail(body).replace(/\s+/g, " ").trim().slice(0, 300);
  return `The Anthropic Messages API returned HTTP ${response.status}${bounded ? `: ${bounded}` : "."}`;
}
