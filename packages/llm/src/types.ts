/** The chat request and response, the bounded project context a model is shown, and the provider contracts every adapter implements. */
import type { FootageInterpretationSnapshot, ProjectSnapshot } from "@extynt/project-graph";
import type { JsonObject, JsonValue } from "@extynt/decode";
import type { ProviderConfig, ProviderDisplayMetadata, ReasoningEffort } from "./provider-config.js";
import type { CapabilityLedger } from "./model-capabilities.js";

export const CHAT_SCHEMA_VERSION = "0.1" as const;
export const CONTEXT_SCHEMA_VERSION = "0.1" as const;

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export type ContextSection =
  | "host"
  | "project"
  | "activeComposition"
  | "selectedLayers"
  | "selectionAncestors"
  | "sources"
  | "items";

export interface ContextSelectionOptions {
  include?: ContextSection[];
  maxHistoryMessages?: number;
  maxPropertiesPerLayer?: number;
  maxPropertyDepth?: number;
  maxStringLength?: number;
  includeExpressions?: boolean;
  includeFilePaths?: boolean;
}

export interface ChatRequest {
  schemaVersion: typeof CHAT_SCHEMA_VERSION;
  requestId: string;
  message: string;
  history?: ChatMessage[];
  snapshot: ProjectSnapshot;
  context?: ContextSelectionOptions;
}

export interface RedactionReport {
  redactedSecretCount: number;
  redactedPathCount: number;
  omittedExpressionCount: number;
  truncatedStringCount: number;
}

export interface ContextHost {
  application: "After Effects";
  version: string;
  buildNumber: string | null;
  platform: "macOS" | "Windows" | "unknown";
  architecture: "arm64" | "x86_64" | "unknown";
}

export interface ContextProject {
  name: string;
  filePath: string | null;
}

export interface ContextComposition {
  id: string;
  name: string;
  width: number;
  height: number;
  pixelAspect: number;
  duration: number;
  frameRate: number;
  workAreaStart: number;
  workAreaDuration: number;
  currentTime: number | null;
}

export interface ContextProperty {
  path: string;
  matchName: string;
  displayName: string;
  kind: "property" | "group" | "effect";
  valueType: "number" | "string" | "boolean" | "color" | "vector" | "layer" | "enum" | "unknown";
  value: JsonValue | null;
  canSetValue: boolean;
  keyframes?: { time: number; value: JsonValue }[];
  children?: ContextProperty[];
  expression?: string | null;
  expressionEnabled?: boolean | undefined;
}

export interface ContextLayer {
  id: string;
  index: number;
  name: string;
  type: string;
  enabled: boolean;
  shy: boolean;
  solo: boolean;
  locked: boolean;
  startTime: number;
  inPoint: number;
  outPoint: number;
  stretch: number;
  parentId: string | null;
  matteLayerId: string | null;
  matteType: string;
  isSelected: boolean;
  sourceId: string | null;
  compositionSourceId: string | null;
  properties: ContextProperty[];
}

export interface ContextSource {
  id: string;
  name: string;
  type: string;
  filePath: string | null;
  missing: boolean;
  width?: number;
  height?: number;
  duration?: number;
  interpretation?: FootageInterpretationSnapshot;
}

export interface ContextItem {
  id: string;
  name: string;
  type: string;
  parentFolderId: string | null;
  compositionId: string | null;
  sourceId: string | null;
}

export interface CopilotContext {
  schemaVersion: typeof CONTEXT_SCHEMA_VERSION;
  snapshotIdentity: { revision: string; fingerprint: string };
  host?: ContextHost;
  project?: ContextProject;
  activeCompositionId: string | null;
  currentTime: number | null;
  selection: { compositionId: string | null; layerIds: string[] };
  activeComposition?: ContextComposition;
  selectedLayers: ContextLayer[];
  selectionAncestors: ContextLayer[];
  sources: ContextSource[];
  items: ContextItem[];
  warnings: string[];
  truncation: { truncated: boolean; limits: Record<string, number> } | null;
  redaction: RedactionReport;
}

export interface ProviderInput {
  requestId: string;
  systemInstructions: string;
  userMessage: string;
  history: ChatMessage[];
  context: CopilotContext;
}

/** `cachedInputTokens` are input tokens served from the provider's prompt cache: already counted in `inputTokens`, billed at a fraction of the rate. */
export interface ProviderCompletion {
  answer: string;
  providerRequestId?: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; cachedInputTokens?: number };
}

/** `capabilities` is what the model has reported it accepts (a provider without one is taken to report nothing). `discoverCapabilities` asks the provider's metadata endpoint about this model, and resolves without asking when there is none. `discoverEfforts` validates effort levels with real tool-capable requests when metadata does not list them; `refresh` reads the provider's list again instead of answering from the first answer. */
export interface ChatProvider {
  readonly id: string;
  readonly model: string;
  readonly config: ProviderConfig;
  readonly displayMetadata: ProviderDisplayMetadata;
  readonly capabilities?: CapabilityLedger;
  discoverCapabilities?(): Promise<void>;
  discoverEfforts?(options?: { refresh?: boolean }): Promise<ReasoningEffort[]>;
  complete(input: ProviderInput): Promise<ProviderCompletion>;
}

export interface ChatSuccessResponse {
  ok: true;
  schemaVersion: typeof CHAT_SCHEMA_VERSION;
  requestId: string;
  provider: ProviderDisplayMetadata;
  model: string;
  answer: string;
  context: Pick<CopilotContext, "snapshotIdentity" | "selection" | "redaction">;
  providerRequestId?: string;
  usage?: ProviderCompletion["usage"];
  diagnostics: { phases: DiagnosticPhase[] };
}

export interface ChatErrorResponse {
  ok: false;
  schemaVersion: typeof CHAT_SCHEMA_VERSION;
  requestId: string;
  error: { code: "INVALID_REQUEST" | "PROVIDER_ERROR"; message: string };
  diagnostics: { phases: DiagnosticPhase[] };
}

export type ChatResponse = ChatSuccessResponse | ChatErrorResponse;

export type DiagnosticPhase =
  | "context-selection"
  | "redaction"
  | "provider-request"
  | "provider-response"
  | "provider-error";

export interface DiagnosticEvent {
  phase: DiagnosticPhase;
  requestId: string;
  providerId?: string;
  model?: string;
  details: Record<string, number | string | boolean | null>;
}

export interface DiagnosticLogger {
  record(event: DiagnosticEvent): void;
}

export interface RunChatOptions {
  logger?: DiagnosticLogger;
  systemInstructions?: string;
}

/** A tool the model may call; the sidecar runs the loop, providers only translate one step to their wire format. */
export interface AgentToolSpec {
  name: string;
  description: string;
  parameters: JsonObject;
}

/** `argumentsError` is set when the model wrote arguments that are not a JSON object; the call must be refused, never run with `{}`. */
export interface AgentToolCall {
  id: string;
  name: string;
  arguments: JsonObject;
  argumentsError?: string;
}

/** `transient` marks the trailing runtime-state message: built fresh each step, never persisted, so adapters keep it out of cache breakpoints and image attachment. `raw` is the provider's own assistant message, replayed verbatim to the same provider (it keeps, for instance, DeepSeek's reasoning_content). */
export type AgentMessage =
  | { role: "user"; content: string; transient?: true }
  | { role: "assistant"; content: string; toolCalls?: AgentToolCall[]; raw?: JsonValue | undefined }
  | { role: "tool"; toolCallId: string; name: string; content: string };

/** A snapshot of a step's reply while it is still being written; both fields are cumulative ("what has arrived so far"), not the newest fragment. */
export interface AgentStepDelta {
  text: string;
  reasoning: string;
}

/** `mediaType` (for example "image/png") is what the provider is told the bytes are; `base64` carries no data-URL prefix, since each adapter wraps it the way its provider wants. */
export interface ProviderImage {
  mediaType: string;
  base64: string;
}

/** `systemSegments`, when given, is the same text as `system` split so a provider can mark the stable part cacheable; providers that cannot use it fall back to `system`. `image` is a screenshot the user attached to the message this turn answers and rides the last user message of every step; `images` are more frames for a step that looks at several (a specialist's review), each riding the last user message after `image`. `signal` is the caller's own reason to stop, composed with the step's own timeout: an aborted request rejects like a timed-out one, so `runAgent` distinguishes them by its own signal rather than the error. `onDelta` is called with the growing reply as it streams, and only by a provider whose config enables streaming. `forceStream` lets a caller-owned live subtask require streaming even when ordinary turns keep the provider default off. `stallTimeoutMs` is the no-output window of a streaming step (default `STALL_TIMEOUT_MS`); it resets on every streamed chunk, so only a silent call is abandoned. `reasoningEffort` is a per-step override used by a harness that has explicit phases; it never changes the saved model setting. */
export interface AgentStepInput {
  requestId: string;
  system: string;
  systemSegments?: Array<{ text: string; cache?: boolean }>;
  messages: AgentMessage[];
  tools: AgentToolSpec[];
  image?: ProviderImage;
  images?: ProviderImage[];
  signal?: AbortSignal;
  onDelta?: (delta: AgentStepDelta) => void;
  forceStream?: boolean;
  stallTimeoutMs?: number;
  reasoningEffort?: ReasoningEffort;
}

/** `finishReason` is the provider's own stop signal ("stop", "tool_use", "end_turn", "length", "max_tokens", ...); a stop that means the reply was cut off is reported as a provider error instead of a finished answer. */
export interface AgentStepResult {
  text: string;
  toolCalls: AgentToolCall[];
  raw?: JsonValue | undefined;
  finishReason?: string;
  usage?: ProviderCompletion["usage"];
}

export interface ToolCallingProvider extends ChatProvider {
  step(input: AgentStepInput): Promise<AgentStepResult>;
}

export interface JsonSchemaSpec {
  name: string;
  schema: JsonObject;
}

/** `image`, when given, is a picture the user message refers to; the caller sends it only to a model that accepts images. */
export interface JsonCompletionRequest {
  system: string;
  user: string;
  signal?: AbortSignal;
  image?: ProviderImage;
}

/** A provider that can be made to answer with JSON text matching a schema; `completeJson` resolves to that text, already checked to parse. */
export interface StructuredOutputProvider extends ChatProvider {
  completeJson(request: JsonCompletionRequest, schema: JsonSchemaSpec): Promise<string>;
}
