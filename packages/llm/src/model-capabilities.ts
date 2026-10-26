/** What a model accepts, as its own provider reports it: from a metadata endpoint where the provider publishes one (Anthropic's Models API, OpenRouter's and xAI's model lists), and otherwise from the provider's refusal of a request that used something the model does not take. A field nobody has reported stays absent, and absent means "send it and let the provider answer". */
import { decodeJson, map, object, presentFields, string, union, type Decoder } from "@extynt/decode";
import { REASONING_EFFORTS, type ReasoningEffort } from "./provider-config.js";
import { softly } from "./wire-common.js";

/** How a chat endpoint is made to answer in JSON, richest first: a `json_schema` response format, a `json_object` one with the schema stated in the prompt, or the prompt alone. */
export type StructuredMode = "json_schema" | "json_object" | "prompt";

/** The capabilities one model reports. `efforts` lists the effort levels it accepts, weakest first (empty: no effort control); `images` whether it takes an image part; `adaptiveThinking` and `thinkingDisplay` are Anthropic's `thinking.type: "adaptive"` and `thinking.display`; `thinkingField` is the OpenAI-compatible `thinking` request field; `structuredOutput` is the richest structured-output mode its endpoint took; `maxOutputTokens` and `contextWindow` are its own ceilings in tokens; `reportedBy` says whether the newest answer came from the provider's metadata or from a refusal it sent. */
export type ModelCapabilities = {
  efforts?: ReasoningEffort[];
  images?: boolean;
  adaptiveThinking?: boolean;
  thinkingDisplay?: boolean;
  thinkingField?: boolean;
  structuredOutput?: StructuredMode;
  maxOutputTokens?: number;
  contextWindow?: number;
  reportedBy?: "provider" | "refusal";
};

/** Keeps a model's capabilities and tells an observer when the provider has said something new; `record` merges what the provider reported and answers whether anything changed. */
export class CapabilityLedger {
  private value: ModelCapabilities;
  private readonly listeners = new Set<(capabilities: ModelCapabilities) => void>();

  public constructor(initial: ModelCapabilities = {}) { this.value = { ...initial }; }

  public get current(): ModelCapabilities { return this.value; }

  public record(update: ModelCapabilities): boolean {
    const next = { ...this.value, ...presentFields(update) };
    if (JSON.stringify(next) === JSON.stringify(this.value)) return false;
    this.value = next;
    for (const listener of this.listeners) listener(next);
    return true;
  }

  public subscribe(listener: (capabilities: ModelCapabilities) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** The effort a step sends: the requested level when the model takes it, else the nearest level it does take,
 * preferring the weakest one above the request (a model that offers no `medium` gets `high`, never silently less
 * thinking) and the strongest one below only when nothing is above. Undefined when the model takes no effort
 * control, or when nothing was requested. An unreported list sends the request as it is. */
export function effortWithin(efforts: readonly ReasoningEffort[] | undefined, requested: ReasoningEffort | undefined): ReasoningEffort | undefined {
  if (requested === undefined || efforts === undefined) return requested;
  if (efforts.includes(requested)) return requested;
  const rank = REASONING_EFFORTS.indexOf(requested);
  const ladder = (level: ReasoningEffort): number => REASONING_EFFORTS.indexOf(level);
  const above = efforts.filter((level) => ladder(level) > rank).sort((left, right) => ladder(left) - ladder(right));
  const below = efforts.filter((level) => ladder(level) < rank).sort((left, right) => ladder(left) - ladder(right));
  return above[0] ?? below.at(-1);
}

/** Effort levels in ladder order, deduplicated, from whatever list a provider named. */
export function effortLadder(levels: Iterable<string>): ReasoningEffort[] {
  const named = new Set(levels);
  return REASONING_EFFORTS.filter((level) => named.has(level));
}

interface RefusalError {
  message?: string | undefined;
  param?: string | undefined;
}

const refusalError: Decoder<RefusalError> = union(
  map(string(), (message): RefusalError => ({ message })),
  object({ message: softly(string()), param: softly(string()) }),
);

const refusalEnvelope = object({ error: softly(refusalError) });

/** The provider's own words for a refused request: its JSON error message and the parameter it names; a body that is not that JSON is read as plain text. */
export function refusalDetail(body: string): { message: string; param: string | undefined } {
  const decoded = decodeJson(body, refusalEnvelope);
  const error = decoded.ok ? decoded.value.error : undefined;
  return error?.message ? { message: error.message, param: error.param } : { message: body, param: undefined };
}

/** The effort levels a refusal lists as accepted ("Supported values are: 'low', 'medium' and 'high'",
 * "expected one of `low`, `high`"), or an empty list when it refuses the parameter outright. */
export function effortsFromRefusal(message: string, refused: ReasoningEffort): ReasoningEffort[] {
  const listed = /(?:supported values?|expected(?: one of)?|must be(?: one of)?|valid values?|allowed values?|one of)\b([^.]*(?:\.[^.]*)?)/i.exec(message)?.[1] ?? "";
  const quoted = [...listed.matchAll(/[`'"]([a-z]+)[`'"]/gi)].map((match) => (match[1] ?? "").toLowerCase());
  return effortLadder(quoted).filter((level) => level !== refused);
}
