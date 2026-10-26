// The table of model services the panel offers, the wire formats they speak and the llm.env names of a model slot.
import type { TrainingPolicy } from "./training-policy.js";

/** The wire formats a slot can speak, each with the sentence the settings form shows for it. */
export const API_FORMATS = {
  "openai-chat": "OpenAI-compatible Chat Completions (/chat/completions, function tools)",
  anthropic: "Anthropic Messages (/messages, tool_use)",
  mock: "Offline mock (no network)",
} as const;

/** One of the wire formats in `API_FORMATS`. */
export type ApiFormat = keyof typeof API_FORMATS;

/** The two models a sidecar can use: the one it asks first and the one it falls back to. */
export type ModelSlot = "primary" | "fallback";

/** True when the text names one of the wire formats. */
export function isApiFormat(name: string | undefined): name is ApiFormat {
  return Object.keys(API_FORMATS).some((format) => format === name);
}

/**
 * A model service the panel offers. `contextWindow` is the prompt-plus-completion ceiling the service publishes and
 * is absent where no figure can be stated, because a made-up large window would let a turn build a prompt the
 * provider rejects. `maxOutputTokens` is the output ceiling the service documents for its default model.
 * `addressEditable` marks a service whose address the user types: a local server whose port can change, or an
 * Other endpoint. `trainingPolicy` says whether the service keeps prompts out of model training; a slot's effective
 * policy also depends on its address. Nothing here says what a model accepts: effort levels and image input are the
 * model's own report.
 */
export interface ModelService {
  readonly id: string;
  readonly label: string;
  readonly format: ApiFormat;
  readonly baseUrl: string;
  readonly model: string;
  readonly keyVariable: string;
  readonly keyRequired: boolean;
  readonly trainingPolicy: TrainingPolicy;
  readonly addressEditable?: boolean;
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
}

/** Every service the settings form lists, in display order. */
export const MODEL_SERVICES: readonly ModelService[] = [
  { id: "anthropic", label: "Anthropic", format: "anthropic", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-5", keyVariable: "ANTHROPIC_API_KEY", keyRequired: true, trainingPolicy: "no-training" },
  { id: "openai", label: "OpenAI", format: "openai-chat", baseUrl: "https://api.openai.com/v1", model: "gpt-5", keyVariable: "OPENAI_API_KEY", keyRequired: true, trainingPolicy: "no-training" },
  { id: "google", label: "Google (Gemini)", format: "openai-chat", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-flash-latest", keyVariable: "GEMINI_API_KEY", keyRequired: true, trainingPolicy: "may-train" },
  { id: "deepseek", label: "DeepSeek", format: "openai-chat", baseUrl: "https://api.deepseek.com", model: "deepseek-flash", keyVariable: "DEEPSEEK_API_KEY", keyRequired: true, trainingPolicy: "may-train", contextWindow: 1_000_000, maxOutputTokens: 384_000 },
  { id: "xai", label: "xAI (Grok)", format: "openai-chat", baseUrl: "https://api.x.ai/v1", model: "", keyVariable: "XAI_API_KEY", keyRequired: true, trainingPolicy: "may-train" },
  { id: "openrouter", label: "OpenRouter", format: "openai-chat", baseUrl: "https://openrouter.ai/api/v1", model: "", keyVariable: "OPENROUTER_API_KEY", keyRequired: true, trainingPolicy: "no-training" },
  { id: "ollama", label: "Ollama (local)", format: "openai-chat", baseUrl: "http://127.0.0.1:11434/v1", model: "", keyVariable: "", keyRequired: false, trainingPolicy: "no-training", addressEditable: true },
  { id: "custom", label: "Other OpenAI-compatible", format: "openai-chat", baseUrl: "", model: "", keyVariable: "", keyRequired: false, trainingPolicy: "may-train", addressEditable: true },
  { id: "custom-anthropic", label: "Other Anthropic-compatible", format: "anthropic", baseUrl: "", model: "", keyVariable: "", keyRequired: false, trainingPolicy: "may-train", addressEditable: true },
  { id: "mock", label: "Mock (offline test)", format: "mock", baseUrl: "", model: "mock-v1", keyVariable: "", keyRequired: false, trainingPolicy: "no-training" },
];

/** The service with this id, if the table lists one. */
export function findModelService(id: string | undefined): ModelService | undefined {
  return MODEL_SERVICES.find((service) => service.id === id);
}

/** The slots in the order they are resolved and saved. */
export const MODEL_SLOTS: readonly ModelSlot[] = ["primary", "fallback"];

/** The llm.env variable prefix of each slot. */
export const SLOT_PREFIX = { primary: "AE_LLM_", fallback: "AE_LLM_FALLBACK_" } as const satisfies Readonly<Record<ModelSlot, string>>;

/** The per-slot llm.env fields that a settings form can set or clear. */
export const SLOT_FIELDS = ["PROVIDER", "FORMAT", "BASE_URL", "MODEL", "API_KEY", "CONTEXT_WINDOW", "REASONING_EFFORT", "ACCEPTS_IMAGES", "MAX_OUTPUT_TOKENS", "ALLOW_TRAINING_RISK"] as const;
