// Tool sets, size limits and token-budget arithmetic that bound one agent turn; pure data and math, no I/O.
import { agentToolDefinitions, planCardTools } from "@extynt/mcp-server";
import { ASSUMED_CONTEXT_WINDOW, redactText, type AgentMessage, type AgentToolSpec, type ReasoningEffort } from "@extynt/llm";

interface WindowShare { readonly share: number; readonly floor: number }

const THINKING_SHARES = {
  none: { share: 0, floor: 0 },
  minimal: { share: 0.005, floor: 4_000 },
  low: { share: 0.01, floor: 8_000 },
  medium: { share: 0.02, floor: 16_000 },
  high: { share: 0.03, floor: 32_000 },
  xhigh: { share: 0.06, floor: 64_000 },
  max: { share: 0.12, floor: 128_000 },
  default: { share: 0.03, floor: 32_000 },
} as const satisfies Record<ReasoningEffort | "default", WindowShare>;

const WINDOW_SHARES = {
  prompt: { share: 0.02, floor: 16_000 },
  reply: { share: 0.01, floor: 8_000 },
  thinking: THINKING_SHARES,
} as const;

const MIN_WRAP_UP_STEPS = 4;
const WRAP_UP_FRACTION = 0.35;
const WORKING_SET_FLOOR_TOKENS = 24_000;
const WORKING_SET_SHARE = 0.05;
const WORKING_SET_CEILING_TOKENS = 32_000;
const PER_RESULT_BUDGET_SHARE = 0.25;
const FOLDED_BUDGET_SHARE = 0.01;
const HISTORY_SHARE_OF_PROMPT = 0.35;
const BRIEFING_SHARE_OF_PROMPT = 0.5;
const CHARS_PER_TOKEN_RANGE = { min: 1.5, max: 12 } as const;
const MAX_IDENTITY_DIGEST_CHARS = 2_000;
const IDENTITY_FIELDS = /"(id|layerId|compositionId|planId|effectPath|propertyPath|matchName|capabilityId|presetId|name|index)"\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?)/g;

/** Tools that hand the model a picture; capturing is not one, because the frame stays local and ae_observe_frame measures it. */
export const AGENT_VISION_TOOLS: ReadonlySet<string> = new Set(["ae_get_capture_frame"]);

/** The read-only tool names derived from the server's definitions, so this surface cannot drift from the external MCP surface. */
export const AGENT_CHAT_TOOLS: readonly string[] = agentToolDefinitions()
  .map((tool) => tool.name)
  .filter((name) => !AGENT_VISION_TOOLS.has(name));

/** The plan-producing tool names, taken from the server because a plan tool must return the `planId` and `presentation` a card reads. */
export const PLAN_TOOLS: ReadonlySet<string> = new Set(planCardTools().map((definition) => definition.name));

/** The step backstop for one turn; the model normally ends its own turn by answering without a tool call. */
export const DEFAULT_AGENT_MAX_STEPS = 60;

/** How many times a step that timed out is asked again before the turn fails. */
export const MAX_STEP_TIMEOUT_RETRIES = 1;

/** The progress label shown while a timed-out step is asked again. */
export const STEP_RETRY_LABEL = "The model did not finish that step in time; asking again";

/** The smallest tool-result budget; below it the fold would shred results a small model cannot carry anyway. */
export const MIN_TOOL_RESULT_BUDGET_TOKENS = 16_000;

/** What the messages keep of the working set however large the fixed prefix is. */
export const MIN_MESSAGE_WORKING_TOKENS = 10_000;

/** How many multiples of its working set a turn may grow before the input backstop stops it. */
export const PROMPT_BACKSTOP_MULTIPLE = 4;

/** The share of the fold target that a hard fold shrinks the messages to. */
export const HARD_FOLD_SHARE = 0.5;

/** The longest diagnostic text kept in a trace entry. */
export const MAX_DIAGNOSTIC_TEXT_CHARS = 240;

/** The longest answer text kept in a result. */
export const MAX_ANSWER_CHARS = 6_000;

/** The longest tool argument value kept in a sidecar log line. */
export const MAX_LOGGED_ARG_CHARS = 400;

/** The longest provider error message quoted to the user. */
export const MAX_PROVIDER_ERROR_CHARS = 200;

/** The shortest prose that counts as a step note. */
export const MIN_NOTE_CHARS = 8;

/** The most sentences a step note keeps. */
export const MAX_NOTE_SENTENCES = 2;

/** The longest step note. */
export const MAX_NOTE_CHARS = 240;

/** The longest plan card title. */
export const MAX_CARD_TITLE_CHARS = 200;

/** The most warnings a plan card lists. */
export const MAX_CARD_WARNINGS = 8;

/** The most notices a plan card lists. */
export const MAX_CARD_NOTICES = 8;

/** The most operations a plan card lists; a plan may run to 256, so a long plan is not silently cut. */
export const MAX_CARD_OPERATIONS = 256;

/** The per-field character bounds of a plan card notice, which is hover text and also rides back to the model. */
export const MAX_CARD_NOTICE_CHARS = { title: 200, detail: 400, because: 600, action: 200, code: 80 } as const;

/** The most operation indexes a plan card notice lists. */
export const MAX_CARD_NOTICE_INDEXES = 64;

/** The longest expression source a plan card shows. */
export const MAX_CARD_EXPRESSION_CHARS = 400;

/** The longest property path a plan card shows. */
export const MAX_CARD_PATH_CHARS = 200;

/** The most other compositions the briefing lists. */
export const MAX_OTHER_COMPS = 20;

/** The most recent plans the briefing lists. */
export const MAX_RECENT_PLANS = 6;

/** The most probe warnings the briefing lists; the rest survive as a count. */
export const MAX_PROBE_WARNINGS = 8;

/** The longest probe warning the briefing quotes. */
export const MAX_PROBE_WARNING_CHARS = 200;

/** The most selected layer ids the briefing lists; the rest become a count. */
export const MAX_SELECTED_LAYER_IDS = 32;

const MAX_BRIEFING_NAME_CHARS = 80;

/** The deepest property tree level the briefing index walks, which only stops a cyclic snapshot from hanging it. */
export const MAX_BRIEFING_PROPERTY_DEPTH = 64;

/** The smallest per-result character budget. */
export const MIN_PER_RESULT_CHARS = 8_000;

/** The smallest folded-result character budget. */
export const MIN_FOLDED_CHARS = 400;

/** The first guess at characters per token, before a turn calibrates against the provider's billed prompt size. */
export const ASSUMED_CHARS_PER_TOKEN = 3.6;

/** Everything one turn may spend, derived from the model's own window: the prompt, history and briefing reserves; `toolTokens` is the memory-safety bound on tool output, `workingSetTokens` the target the turn carries, `foldTokens` the smaller of the two where the fold fires, `maxPromptTokens` the input backstop, and the per-result and folded character bounds. */
export interface TurnBudget {
  readonly window: number;
  readonly promptTokens: number;
  readonly historyTokens: number;
  readonly briefingTokens: number;
  readonly toolTokens: number;
  readonly workingSetTokens: number;
  readonly foldTokens: number;
  readonly maxPromptTokens: number;
  readonly perResultChars: number;
  readonly foldedChars: number;
  readonly charsPerToken: number;
}

function reserveFor(spec: WindowShare, window: number): number {
  return Math.max(spec.floor, Math.round(window * spec.share));
}

function effectiveContextWindow(contextWindow: number | undefined): number {
  return contextWindow !== undefined && Number.isInteger(contextWindow) && contextWindow > 0 ? contextWindow : ASSUMED_CONTEXT_WINDOW;
}

/** The per-result and folded character bounds for a fold target, shared by derived and pinned budgets. */
export function budgetChars(foldTokens: number, charsPerToken: number): { readonly perResultChars: number; readonly foldedChars: number } {
  return {
    perResultChars: Math.max(MIN_PER_RESULT_CHARS, Math.round(foldTokens * charsPerToken * PER_RESULT_BUDGET_SHARE)),
    foldedChars: Math.max(MIN_FOLDED_CHARS, Math.round(foldTokens * charsPerToken * FOLDED_BUDGET_SHARE)),
  };
}

/** Derives the turn budget from the model's context window, the reasoning effort and the characters-per-token estimate. */
export function turnBudget(contextWindow: number | undefined, reasoningEffort: ReasoningEffort | undefined, charsPerToken: number = ASSUMED_CHARS_PER_TOKEN): TurnBudget {
  const window = effectiveContextWindow(contextWindow);
  const promptTokens = reserveFor(WINDOW_SHARES.prompt, window);
  const replyTokens = reserveFor(WINDOW_SHARES.reply, window);
  const thinkingTokens = reserveFor(WINDOW_SHARES.thinking[reasoningEffort ?? "default"], window);
  const toolTokens = Math.max(MIN_TOOL_RESULT_BUDGET_TOKENS, window - promptTokens - replyTokens - thinkingTokens);
  const workingSetTokens = Math.min(WORKING_SET_CEILING_TOKENS, Math.max(WORKING_SET_FLOOR_TOKENS, Math.round(window * WORKING_SET_SHARE)));
  const foldTokens = Math.min(toolTokens, workingSetTokens);
  return {
    window, promptTokens, toolTokens, workingSetTokens, foldTokens, charsPerToken,
    historyTokens: Math.round(promptTokens * HISTORY_SHARE_OF_PROMPT),
    briefingTokens: Math.round(promptTokens * BRIEFING_SHARE_OF_PROMPT),
    maxPromptTokens: promptTokens + Math.min(toolTokens, foldTokens * PROMPT_BACKSTOP_MULTIPLE),
    ...budgetChars(foldTokens, charsPerToken),
  };
}

/** The memory-safety bound on tool output for a model window and reasoning effort. */
export function toolResultBudgetTokens(contextWindow: number | undefined, reasoningEffort: ReasoningEffort | undefined): number {
  return turnBudget(contextWindow, reasoningEffort).toolTokens;
}

/** How many of the last steps of a turn are spent wrapping up. */
export function wrapUpSteps(maxSteps: number): number {
  return Math.max(MIN_WRAP_UP_STEPS, Math.ceil(maxSteps * WRAP_UP_FRACTION));
}

/** The step count shown to the model; steps only, because a wall clock in front of the model reads as "hurry". */
export function remainingBudget(stepsLeft: number): string {
  return `Budget: ${stepsLeft} step${stepsLeft === 1 ? "" : "s"} left.`;
}

/** Every distinct layer, effect or plan identity a result named, capped so the digest cannot overrun the budget. */
export function identityDigest(text: string, maxChars: number = MAX_IDENTITY_DIGEST_CHARS): string {
  const seen = new Set<string>();
  let length = 0;
  for (const match of text.matchAll(IDENTITY_FIELDS)) {
    const entry = `${match[1]}=${(match[2] ?? "").replace(/^"|"$/g, "")}`;
    if (seen.has(entry)) continue;
    if (length + entry.length + 2 > maxChars) break;
    seen.add(entry);
    length += entry.length + 2;
  }
  return [...seen].join(", ");
}

/** The token estimate for a text at a characters-per-token ratio. */
export function estimateTokens(text: string, charsPerToken: number = ASSUMED_CHARS_PER_TOKEN): number {
  return Math.ceil(text.length / charsPerToken);
}

/** The prompt's real characters per token from the provider's billed count, or undefined when the ratio is not believable. */
export function calibrateCharsPerToken(messages: readonly AgentMessage[], briefing: string, tools: readonly AgentToolSpec[], inputTokens: number | undefined): number | undefined {
  if (inputTokens === undefined || !Number.isInteger(inputTokens) || inputTokens <= 0) return undefined;
  const chars = briefing.length
    + tools.reduce((sum, tool) => sum + JSON.stringify(tool).length, 0)
    + messages.reduce((sum, message) => sum + (typeof message.content === "string" ? message.content.length : 0), 0);
  const ratio = chars / inputTokens;
  return Number.isFinite(ratio) && ratio >= CHARS_PER_TOKEN_RANGE.min && ratio <= CHARS_PER_TOKEN_RANGE.max ? ratio : undefined;
}

/** A single-line, redacted, length-bounded rendering of a model-supplied name or text. */
export function clean(value: string, maxChars: number = MAX_BRIEFING_NAME_CHARS): string {
  const redacted = redactText(value.replace(/[\r\n"]+/g, " "), { maxStringLength: maxChars }).value;
  return typeof redacted === "string" ? redacted : "";
}

/** A number rounded to three decimals. */
export function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
