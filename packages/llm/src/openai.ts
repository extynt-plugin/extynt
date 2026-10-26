/** The OpenAI-compatible adapters: Chat Completions tool-calling steps for OpenAI, DeepSeek, OpenRouter, xAI and local servers, and the Responses API for plain completions and the newest OpenAI models. */
import type { ModelCapabilities } from "./model-capabilities.js";
import { CapabilityLedger } from "./model-capabilities.js";
import { compatibleCapabilities, compatibleRefusalLesson, refusesToolReasoning } from "./openai-compatible-capabilities.js";
import { acceptedEfforts } from "./openai-efforts.js";
import { chatCompletionBody, chatEffortProbe, chatStepRequests, responsesCompletionBody, responsesEffortProbe, type ChatRequestSettings, type ChatStepSettings, type StepRequests } from "./openai-request.js";
import { completedResponsesStep, responsesStepBody } from "./openai-responses-wire.js";
import { sendChatStep, type ChatStepRoute } from "./openai-step.js";
import { chatStructuredBody, chatStructuredText, responsesStructuredBody, responsesStructuredText, structuredModeOf, structuredRefusalLesson } from "./openai-structured.js";
import { guardedStep, MAX_TOKENS_MESSAGE, postJson, responseFailure, type Transport } from "./openai-transport.js";
import { chatCompletionShape, compatibleTokenCounts, interpretChatCompletion, modelListShape, responsesItems, responsesOutputText, responsesPayloadShape, responsesTokenCounts, type CompatibleUsage, type ResponsesUsage } from "./openai-wire.js";
import { providerDisplayMetadata, validateProviderConfig, type ProviderConfig, type ProviderDisplayMetadata, type ReasoningEffort } from "./provider-config.js";
import { bearerHeader, createServerEnvironmentSecret, requestCredential, type SecretSource } from "./provider-secret.js";
import { AGENT_STEP_TIMEOUT_FLOOR_MS } from "./provider-stall.js";
import { accepts, instanceOf, refine } from "@extynt/decode";
import { ProviderHttpError } from "./provider-http-error.js";
import { DEFAULT_REQUEST_TIMEOUT_MS, DISCOVERY_TIMEOUT_MS, REFUSAL_LESSONS_PER_STEP, keyReady, positiveInteger, positiveLimit, serverFetch, withTimeout } from "./provider-runtime.js";
import type { AgentStepInput, AgentStepResult, JsonCompletionRequest, JsonSchemaSpec, ProviderCompletion, ProviderInput, StructuredOutputProvider, ToolCallingProvider } from "./types.js";
import { completionUsage, readBody } from "./wire-common.js";

export { ProviderHttpError } from "./provider-http-error.js";

export interface OpenAICompatibleProviderOptions {
  config: ProviderConfig;
  secretSource?: SecretSource;
  requestTimeoutMs?: number;
  maxTokens?: number;
  fetch?: typeof globalThis.fetch;
  capabilities?: ModelCapabilities;
}

export interface OpenAIResponsesProviderOptions {
  model?: string;
  baseUrl?: string;
  requestTimeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  environment?: Readonly<Record<string, string | undefined>>;
  secretSource?: SecretSource;
}

type DeepSeekFlashOptions = Omit<OpenAICompatibleProviderOptions, "config"> & { baseUrl?: string; model?: string; environment?: Readonly<Record<string, string | undefined>> };
interface StructuredRoute {
  transport: Transport;
  request: JsonCompletionRequest;
  schema: JsonSchemaSpec;
  signal: AbortSignal;
}

type CapabilityRefusal = ProviderHttpError & { detail: string };

/** A ready-made DeepSeek profile, one provider among several the user can choose; `stream` is unset (off) unless a deployment opts in, because a streaming attempt that fails pays for the prompt twice. */
export const DEEPSEEK_FLASH_PROFILE: ProviderConfig = {
  id: "deepseek-flash",
  displayName: "DeepSeek Flash",
  endpoint: "https://api.deepseek.com",
  model: "deepseek-flash",
  authSource: "server-environment",
};

const OPENAI_RESPONSES_MODEL = /^gpt-(?:5\.6|6)-(?:astra|sol|luna)(?:$|-)/;
const CHAT_EFFORT_REFUSAL = /reasoning[_ ]?effort|\beffort\b/i;
const RESPONSES_EFFORT_REFUSAL = /reasoning[._ ]?effort|unsupported.*effort/i;

interface ProviderBasics {
  config: ProviderConfig;
  secretSource: SecretSource;
  requestTimeoutMs: number;
  request: typeof globalThis.fetch;
}

/** Calls a Chat Completions endpoint, the OpenAI function-calling format that DeepSeek also implements. A step is sent again when a refusal names something the model does not take, so later steps are built without it. `discoverCapabilities` reads the model's row in the provider's `/models` list (OpenRouter's and xAI's input modalities), `discoverEfforts` probes the levels the endpoint accepts with function tools with tiny requests (a text answer from the model is not a capability contract), and `maxTokens` caps the reply so a provider default cannot silently truncate a long plan. */
export class OpenAICompatibleProvider implements ToolCallingProvider, StructuredOutputProvider {
  public readonly id: string;
  public readonly model: string;
  public readonly config: ProviderConfig;
  public readonly capabilities: CapabilityLedger;
  private readonly secretSource: SecretSource;
  private readonly requestTimeoutMs: number;
  private readonly maxTokens: number | undefined;
  private readonly request: typeof globalThis.fetch;
  private toolReasoningDisabled = false;
  private effortDiscovery: Promise<ReasoningEffort[]> | undefined;

  public constructor(options: OpenAICompatibleProviderOptions) {
    const basics = providerBasics(options);
    this.config = basics.config;
    this.secretSource = basics.secretSource;
    this.requestTimeoutMs = basics.requestTimeoutMs;
    this.request = basics.request;
    this.capabilities = new CapabilityLedger(options.capabilities);
    if (this.config.id === "openai-chat") this.capabilities.record({ thinkingField: false });
    this.id = this.config.id;
    this.model = this.config.model;
    this.maxTokens = positiveInteger(options.maxTokens);
  }

  public get displayMetadata(): ProviderDisplayMetadata {
    return providerDisplayMetadata(this.config, keyReady(this.secretSource));
  }

  private get usesOpenAIResponses(): boolean {
    return this.config.id === "openai-chat" && OPENAI_RESPONSES_MODEL.test(this.model);
  }

  public async discoverCapabilities(): Promise<void> {
    const apiKey = this.secretSource.resolve() ?? "";
    const reported = await withTimeout(DISCOVERY_TIMEOUT_MS, (signal) => this.modelListing(apiKey, signal)).catch(() => undefined);
    if (reported) this.capabilities.record(reported);
  }

  public discoverEfforts(options: { refresh?: boolean } = {}): Promise<ReasoningEffort[]> {
    const cached = options.refresh ? undefined : this.effortDiscovery;
    if (cached) return cached;
    const discovery = this.discoverClearingOnFailure(options.refresh === true);
    this.effortDiscovery = discovery;
    return discovery;
  }

  private async discoverClearingOnFailure(refresh: boolean): Promise<ReasoningEffort[]> {
    try {
      return await this.discoverListedEfforts(refresh);
    } catch (error) {
      this.effortDiscovery = undefined;
      throw error;
    }
  }

  public async complete(input: ProviderInput): Promise<ProviderCompletion> {
    const transport = this.transport(requestCredential(this.secretSource));
    return withTimeout(this.requestTimeoutMs, async (signal) => {
      const response = await postJson(transport, "/chat/completions", chatCompletionBody(input, this.requestSettings()), signal);
      if (!response.ok) throw await responseFailure(response);
      const reply = interpretChatCompletion(await readBody(response, chatCompletionShape, {}));
      if (reply.finishReason === "length") throw new ProviderHttpError(response.status, MAX_TOKENS_MESSAGE);
      if (!reply.text) throw new ProviderHttpError(response.status, "The compatible API returned no text output.");
      return completionOf(reply.text, response.headers.get("x-request-id"), reply.usage && chatCompletionUsage(reply.usage));
    });
  }

  public async completeJson(request: JsonCompletionRequest, schema: JsonSchemaSpec): Promise<string> {
    const transport = this.transport(requestCredential(this.secretSource));
    return withTimeout(this.requestTimeoutMs, (signal) => this.structuredText({ transport, request, schema, signal }), request.signal);
  }

  public async step(input: AgentStepInput): Promise<AgentStepResult> {
    if (this.usesOpenAIResponses) return this.responsesStep(input);
    const transport = this.transport(requestCredential(this.secretSource));
    const streaming = this.config.stream === true || input.forceStream === true;
    return guardedStep(input, (signal, guard) => this.stepWithLessons({ transport, input, signal, guard, requestTimeoutMs: this.requestTimeoutMs, streaming }));
  }

  private async stepWithLessons(route: ChatStepRoute): Promise<AgentStepResult> {
    for (let lessons = 0; ; lessons += 1) {
      const requests = chatStepRequests(route.input, this.stepSettings());
      try {
        return await sendChatStep(route, requests);
      } catch (error) {
        if (lessons >= REFUSAL_LESSONS_PER_STEP || !isCapabilityRefusal(error) || !this.learnFrom(error, requests)) throw error;
      }
    }
  }

  private async structuredText(route: StructuredRoute): Promise<string> {
    const { transport, request, schema, signal } = route;
    if (this.usesOpenAIResponses) return responsesStructuredText(transport, responsesStructuredBody(request, schema, this.requestSettings()), signal);
    for (;;) {
      const mode = structuredModeOf(this.capabilities.current);
      try {
        return await chatStructuredText(transport, chatStructuredBody(request, schema, mode, this.requestSettings()), signal);
      } catch (error) {
        const lesson = isCapabilityRefusal(error) ? structuredRefusalLesson(error.detail, mode) : undefined;
        if (!lesson || !this.capabilities.record(lesson)) throw error;
      }
    }
  }

  private async responsesStep(input: AgentStepInput): Promise<AgentStepResult> {
    const transport = this.transport(requestCredential(this.secretSource));
    return guardedStep(input, async (signal, guard) => {
      guard.cap(Math.max(this.requestTimeoutMs, AGENT_STEP_TIMEOUT_FLOOR_MS));
      const { images, efforts } = this.capabilities.current;
      const body = responsesStepBody(input, { model: this.model, acceptsImages: this.config.acceptsImages, observedImages: images, reasoningEffort: this.config.reasoningEffort, efforts, maxTokens: this.maxTokens });
      const response = await postJson(transport, "/responses", body, signal);
      if (!response.ok) throw await responseFailure(response);
      const result = completedResponsesStep(await readBody(response, responsesPayloadShape, {}), response.status);
      input.onDelta?.({ text: result.text, reasoning: "" });
      return result;
    });
  }

  private async discoverListedEfforts(refresh: boolean): Promise<ReasoningEffort[]> {
    if (refresh || this.config.id === "deepseek-flash") await this.discoverCapabilities();
    const listed = this.capabilities.current.efforts;
    return this.usesOpenAIResponses ? this.probeResponsesEfforts() : listed ?? this.probeChatEfforts();
  }

  private async probeResponsesEfforts(): Promise<ReasoningEffort[]> {
    const transport = this.transport(requestCredential(this.secretSource));
    return this.recordEfforts(await acceptedEfforts({ transport, path: "/responses", refusal: RESPONSES_EFFORT_REFUSAL, body: (level) => responsesEffortProbe(this.model, level) }));
  }

  private async probeChatEfforts(): Promise<ReasoningEffort[]> {
    const transport = this.transport(requestCredential(this.secretSource));
    return this.recordEfforts(await acceptedEfforts({ transport, path: "/chat/completions", refusal: CHAT_EFFORT_REFUSAL, body: (level) => chatEffortProbe(this.requestSettings(), level) }));
  }

  private recordEfforts(accepted: ReasoningEffort[]): ReasoningEffort[] {
    this.capabilities.record({ efforts: accepted, reportedBy: "provider" });
    return accepted;
  }

  private async modelListing(apiKey: string, signal: AbortSignal): Promise<ModelCapabilities | undefined> {
    const response = await this.request(`${this.config.endpoint}/models`, { headers: { accept: "application/json", ...bearerHeader(apiKey) }, signal });
    return response.ok ? compatibleCapabilities(await readBody(response, modelListShape, {}), this.model) : undefined;
  }

  private learnFrom(refusal: CapabilityRefusal, requests: StepRequests): boolean {
    const request = requests("plain");
    if (refusesToolReasoning(refusal.detail, request)) return this.disableToolReasoning();
    const lesson = compatibleRefusalLesson(refusal.detail, request);
    return lesson !== undefined && this.capabilities.record(lesson);
  }

  private disableToolReasoning(): boolean {
    if (this.toolReasoningDisabled) return false;
    this.toolReasoningDisabled = true;
    return true;
  }

  private transport(apiKey: string): Transport {
    return { request: this.request, endpoint: this.config.endpoint, apiKey };
  }

  private requestSettings(): ChatRequestSettings {
    return { config: this.config, model: this.model, maxTokens: this.maxTokens };
  }

  private stepSettings(): ChatStepSettings {
    return { ...this.requestSettings(), capabilities: this.capabilities.current, toolReasoningDisabled: this.toolReasoningDisabled };
  }
}

/** Calls the Responses API for plain completions. */
export class OpenAIResponsesProvider implements Omit<ToolCallingProvider, "step">, StructuredOutputProvider {
  public readonly id = "openai-responses";
  public readonly model: string;
  public readonly config: ProviderConfig;
  private readonly secretSource: SecretSource;
  private readonly requestTimeoutMs: number;
  private readonly request: typeof globalThis.fetch;

  public constructor(options: OpenAICompatibleProviderOptions) {
    const basics = providerBasics(options);
    this.config = basics.config;
    this.secretSource = basics.secretSource;
    this.requestTimeoutMs = basics.requestTimeoutMs;
    this.request = basics.request;
    this.model = this.config.model;
  }

  public get displayMetadata(): ProviderDisplayMetadata {
    return providerDisplayMetadata(this.config, keyReady(this.secretSource));
  }

  public async complete(input: ProviderInput): Promise<ProviderCompletion> {
    const transport: Transport = { request: this.request, endpoint: this.config.endpoint, apiKey: requestCredential(this.secretSource) };
    return withTimeout(this.requestTimeoutMs, async (signal) => {
      const response = await postJson(transport, "/responses", responsesCompletionBody(input, this.model), signal);
      if (!response.ok) throw await responseFailure(response);
      const payload = await readBody(response, responsesPayloadShape, {});
      const answer = payload.output_text ?? responsesOutputText(responsesItems(payload.output ?? []));
      if (!answer) throw new ProviderHttpError(response.status, "The Responses API returned no text output.");
      return completionOf(answer, response.headers.get("x-request-id"), payload.usage && responsesCompletionUsage(payload.usage));
    });
  }

  public async completeJson(request: JsonCompletionRequest, schema: JsonSchemaSpec): Promise<string> {
    const transport: Transport = { request: this.request, endpoint: this.config.endpoint, apiKey: requestCredential(this.secretSource) };
    const settings = { config: this.config, model: this.model, maxTokens: undefined };
    return withTimeout(this.requestTimeoutMs, (signal) => responsesStructuredText(transport, responsesStructuredBody(request, schema, settings), signal), request.signal);
  }
}

export function createOpenAIResponsesProvider(options: OpenAIResponsesProviderOptions = {}): OpenAIResponsesProvider {
  return new OpenAIResponsesProvider({
    config: responsesConfig(options),
    secretSource: options.secretSource ?? createServerEnvironmentSecret(options.environment),
    ...(options.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: options.requestTimeoutMs }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
}

export function createDeepSeekFlashProvider(options: DeepSeekFlashOptions = {}): OpenAICompatibleProvider {
  const { baseUrl, model, environment, ...providerOptions } = options;
  const secretSource = options.secretSource ?? createServerEnvironmentSecret(environment, "DEEPSEEK_API_KEY");
  return new OpenAICompatibleProvider({
    ...providerOptions,
    secretSource,
    config: { ...DEEPSEEK_FLASH_PROFILE, endpoint: baseUrl ?? DEEPSEEK_FLASH_PROFILE.endpoint, model: model ?? DEEPSEEK_FLASH_PROFILE.model, authSource: secretSource.authSource },
  });
}

function responsesConfig(options: OpenAIResponsesProviderOptions): ProviderConfig {
  return {
    id: "openai-responses",
    displayName: "OpenAI Responses",
    endpoint: options.baseUrl ?? "https://api.openai.com/v1",
    model: options.model ?? "gpt-5",
    authSource: options.secretSource?.authSource ?? "server-environment",
  };
}

function providerBasics(options: OpenAICompatibleProviderOptions): ProviderBasics {
  const config = validateProviderConfig(options.config);
  const secretSource = options.secretSource ?? createServerEnvironmentSecret();
  if (secretSource.authSource !== config.authSource) throw new Error("Provider config authSource must match its secret source.");
  return { config, secretSource, requestTimeoutMs: positiveLimit(options.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS), request: serverFetch(options.fetch) };
}

function completionOf(answer: string, requestId: string | null, usage: ProviderCompletion["usage"] | undefined): ProviderCompletion {
  return { answer, ...(requestId ? { providerRequestId: requestId } : {}), ...(usage ? { usage } : {}) };
}

function chatCompletionUsage(usage: CompatibleUsage): ProviderCompletion["usage"] {
  const { input, output, total } = compatibleTokenCounts(usage);
  return completionUsage({ input, output, total });
}

function responsesCompletionUsage(usage: ResponsesUsage): ProviderCompletion["usage"] {
  const { input, output, total } = responsesTokenCounts(usage);
  return completionUsage({ input, output, total });
}

const isCapabilityRefusal = accepts(
  refine(instanceOf(ProviderHttpError, "ProviderHttpError"), (error): error is CapabilityRefusal => (error.status === 400 || error.status === 422) && !!error.detail, "a capability refusal"),
);
