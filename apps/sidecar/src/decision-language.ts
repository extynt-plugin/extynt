// The user-LLM decision tier on the sidecar: the chat model the user already configured, offered to @extynt/decide as a language model for the closed questions that opt in; a configured decision model (Jev) always wins.
import { languageDecisionModel, type DecisionModel, type LanguageModelPort } from "@extynt/decide";
import { supportsStructuredOutput, type ChatProvider, type StructuredOutputProvider } from "@extynt/llm";

const SCHEMA_NAME = "decision_answers";

/** The turn off switch: set to 0, the chat model is never asked decision questions. */
export const CHAT_MODEL_DECISIONS_VARIABLE = "EXTYNT_CHAT_MODEL_DECISIONS";

function languagePortOf(provider: StructuredOutputProvider): LanguageModelPort {
  return {
    id: `chat-model:${provider.model}`,
    completeJson: (request) => provider.completeJson({ system: request.system, user: request.user, signal: request.signal, ...(request.image === undefined ? {} : { image: request.image }) }, { name: SCHEMA_NAME, schema: request.schema }),
  };
}

function chatModelSeesImages(provider: StructuredOutputProvider): boolean {
  return (provider.config.acceptsImages ?? provider.capabilities?.current.images) === true;
}

/**
 * The decision models with the user's chat model added as the last resort: when no purpose-built decision model is configured, or when the chat model takes images (a text-only decision model cannot read a frame, so the chat model answers the frame questions); only when the provider can
 * constrain its output to a schema, and unless the user turned it off. The model is rebuilt only when the provider changes, so it is one object per provider; it is sent a frame only when the user declared or the model reported that it takes images.
 */
export function withChatModel(models: () => ReadonlyArray<DecisionModel>, chatProvider: () => ChatProvider | undefined, environment: Readonly<Record<string, string | undefined>>): () => ReadonlyArray<DecisionModel> {
  let built: { readonly provider: StructuredOutputProvider; readonly imageOnly: boolean; readonly model: DecisionModel } | undefined;
  return () => {
    const configured = models();
    const provider = chatProvider();
    if (environment[CHAT_MODEL_DECISIONS_VARIABLE] === "0" || !supportsStructuredOutput(provider)) return configured;
    const imageOnly = configured.some((model) => model.tier === "decision-model");
    if (imageOnly && !chatModelSeesImages(provider)) return configured;
    if (built?.provider !== provider || built.imageOnly !== imageOnly) built = { provider, imageOnly, model: languageDecisionModel(languagePortOf(provider), undefined, { acceptsImages: () => chatModelSeesImages(provider), imageOnly }) };
    return [...configured, built.model];
  };
}
