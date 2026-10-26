// Keeps a long turn inside its token budget: counts what the next request carries and folds spent reasoning, accepted queue arguments and old tool results, never an actionable refusal.
import { extractReasoning, type AgentMessage, type AgentToolSpec } from "@extynt/llm";
import { agentToolDefinitions } from "@extynt/mcp-server";
import { estimateTokens, identityDigest, ASSUMED_CHARS_PER_TOKEN, MIN_FOLDED_CHARS, MIN_TOOL_RESULT_BUDGET_TOKENS } from "./agent-policy.js";
import { elideReasoning, hasReasoningText, rawWithArguments } from "./agent-raw-replay.js";
import type { ToolArguments } from "./agent-types.js";

type AssistantMessage = Extract<AgentMessage, { role: "assistant" }>;
type ToolMessage = Extract<AgentMessage, { role: "tool" }>;

interface FoldSettings {
  readonly newestAssistant: number;
  readonly foldedChars: number;
  readonly charsPerToken: number;
  readonly lastResort: boolean;
}

const FOLDED_RESULT_MARKER = "earlier result folded to save room.";
const ACTIONABLE_ENTRY_KEYS = ["fix", "outstanding"] as const;
const JSON_TOKEN = /"(?:[^"\\]|\\[\s\S])*"?|[[\]{]/g;
const DEPTH_STEP: ReadonlyMap<string, number> = new Map([["[", 1], ["]", -1]]);
const QUEUE_WRITE_TOOLS: ReadonlySet<string> = new Set(["ae_queue_add", "ae_queue_fix", "ae_queue_design", "ae_plan_add", "ae_propose_plan"]);
const FOLDED_ARGUMENT = "[accepted into the queue; folded to save room]";
const FOLDED_ARGUMENT_CHARS = 200;
const FOLD_TARGET_SHARE = 0.7;

function carriedTokens(message: AgentMessage, charsPerToken: number): number {
  const content = estimateTokens(message.content, charsPerToken);
  if (message.role !== "assistant") return content;
  const reasoning = estimateTokens(extractReasoning(message.raw), charsPerToken);
  const calls = (message.toolCalls ?? []).reduce((sum, call) => sum + call.name.length + JSON.stringify(call.arguments).length, 0);
  return content + reasoning + Math.ceil(calls / charsPerToken);
}

function newestAssistantIndex(messages: readonly AgentMessage[]): number {
  let newest = -1;
  for (let index = 0; index < messages.length; index += 1) if (messages[index]?.role === "assistant") newest = index;
  return newest;
}

function skipSpace(content: string, at: number): number {
  let cursor = at;
  while (cursor < content.length && /\s/.test(content.charAt(cursor))) cursor += 1;
  return cursor;
}

function arrayHoldsObject(content: string, open: number): boolean {
  let depth = 0;
  for (const [token] of content.slice(open).matchAll(JSON_TOKEN)) {
    if (token === "{") return true;
    depth += DEPTH_STEP.get(token) ?? 0;
    if (depth <= 0) return false;
  }
  return false;
}

function keyHoldsEntries(content: string, key: string): boolean {
  const anchor = `"${key}"`;
  for (let at = content.indexOf(anchor); at >= 0; at = content.indexOf(anchor, at + anchor.length)) {
    const colon = skipSpace(content, at + anchor.length);
    const open = skipSpace(content, colon + 1);
    if (content[colon] === ":" && content[open] === "[" && arrayHoldsObject(content, open)) return true;
  }
  return false;
}

function carriesActionableEntries(content: string): boolean {
  return ACTIONABLE_ENTRY_KEYS.some((key) => keyHoldsEntries(content, key));
}

function acceptedAnswer(messages: readonly AgentMessage[], callId: string): boolean {
  const answer = messages.find((message): message is ToolMessage => message.role === "tool" && message.toolCallId === callId);
  return !!answer && /"accepted":\s*[1-9]/.test(answer.content) && !carriesActionableEntries(answer.content);
}

function foldedArguments(args: ToolArguments): ToolArguments | undefined {
  const sized = Object.entries(args).map(([key, value]) => ({ key, value, large: JSON.stringify(value).length > FOLDED_ARGUMENT_CHARS }));
  if (!sized.some((entry) => entry.large)) return undefined;
  return Object.fromEntries(sized.map(({ key, value, large }): [string, ToolArguments[string]] => [key, large ? FOLDED_ARGUMENT : value]));
}

function foldedQueueArguments(messages: readonly AgentMessage[], message: AssistantMessage): ReadonlyMap<string, ToolArguments> {
  const replaced = new Map<string, ToolArguments>();
  for (const call of message.toolCalls ?? []) {
    if (!QUEUE_WRITE_TOOLS.has(call.name) || !acceptedAnswer(messages, call.id)) continue;
    const folded = foldedArguments(call.arguments);
    if (folded) replaced.set(call.id, folded);
  }
  return replaced;
}

function foldAcceptedQueueWrites(messages: readonly AgentMessage[], message: AssistantMessage): AssistantMessage {
  const replaced = foldedQueueArguments(messages, message);
  if (!replaced.size) return message;
  const toolCalls = message.toolCalls?.map((call) => {
    const folded = replaced.get(call.id);
    return folded ? { ...call, arguments: folded } : call;
  });
  return { ...message, ...(toolCalls ? { toolCalls } : {}), raw: rawWithArguments(message.raw, replaced) };
}

function foldAssistantMessage(messages: AgentMessage[], index: number, settings: FoldSettings): number {
  const message = messages[index];
  if (message?.role !== "assistant" || index === settings.newestAssistant) return 0;
  const before = carriedTokens(message, settings.charsPerToken);
  const elided = elideReasoning(message.raw);
  const folded = foldAcceptedQueueWrites(messages, { ...message, ...(elided === undefined ? {} : { raw: elided }) });
  const after = carriedTokens(folded, settings.charsPerToken);
  if (after >= before) return 0;
  Object.assign(message, folded);
  return before - after;
}

function foldableTool(message: AgentMessage, settings: FoldSettings): message is ToolMessage {
  return message.role === "tool" && message.content.length > settings.foldedChars && (settings.lastResort || !message.content.includes(FOLDED_RESULT_MARKER)) && !carriesActionableEntries(message.content);
}

function foldToolMessage(message: ToolMessage, settings: FoldSettings): number {
  const identities = identityDigest(message.content, settings.foldedChars);
  const kept = identities ? ` It named: ${identities}.` : "";
  const reread = FOLD_REREAD_TOOLS.has(message.name) ? ` Call ${message.name} again if you need the rest` : "";
  const folded = `${message.content.slice(0, settings.foldedChars)}… [${FOLDED_RESULT_MARKER}${kept}${reread}]`;
  if (folded.length >= message.content.length) return 0;
  const saved = estimateTokens(message.content, settings.charsPerToken) - estimateTokens(folded, settings.charsPerToken);
  message.content = folded;
  return saved;
}

function foldedMessageTokens(messages: AgentMessage[], index: number, settings: FoldSettings): number {
  const message = messages[index];
  if (!message) return 0;
  const saved = foldAssistantMessage(messages, index, settings);
  if (saved > 0) return saved;
  return foldableTool(message, settings) ? foldToolMessage(message, settings) : 0;
}

/** The tools a fold may name for re-reading a result: the read-only surface minus every plan-card tool, which is annotated read-only but re-submits work when called again. */
export const FOLD_REREAD_TOOLS: ReadonlySet<string> = new Set(agentToolDefinitions().filter((definition) => definition.annotations.readOnlyHint === true && definition.planCard !== true).map((definition) => definition.name));

/** At a verified seal the stage is behind the model: the share of the budget to fold to, so the prefix changes at this known point rather than at a mid-history overflow a few steps later. */
export const SEAL_FOLD_SHARE = 0.5;

/** The request about to be sent, in tokens, including each message's reasoning. Deliberately not the text-only measure used to calibrate characters per token: a ratio that moved with reasoning would move every bound derived from it. */
export function promptTokens(messages: readonly AgentMessage[], briefing: string, tools: readonly AgentToolSpec[], charsPerToken: number): number {
  const chars = briefing.length + tools.reduce((sum, tool) => sum + JSON.stringify(tool).length, 0);
  return Math.ceil(chars / charsPerToken) + messages.reduce((sum, message) => sum + carriedTokens(message, charsPerToken), 0);
}

/**
 * The plain-text reasoning of the step that just ran is spent once every call it made was answered cleanly: the calls and their arguments are the decision, and the next step reads them and their results.
 * A refused step keeps its reasoning, since the correction builds on it, and signed thinking blocks stay because the provider requires the newest tool-use turn to carry them. The message is replaced, never edited.
 */
export function elideSpentReasoning(messages: AgentMessage[]): void {
  const index = newestAssistantIndex(messages);
  const message = messages[index];
  if (message?.role !== "assistant" || !hasReasoningText(message.raw)) return;
  const elided = elideReasoning(message.raw);
  if (elided !== undefined) messages[index] = { ...message, raw: elided };
}

function foldSettings(messages: readonly AgentMessage[], limits: FoldLimits): FoldSettings {
  return { newestAssistant: newestAssistantIndex(messages), foldedChars: limits.foldedChars ?? MIN_FOLDED_CHARS, charsPerToken: limits.charsPerToken ?? ASSUMED_CHARS_PER_TOKEN, lastResort: limits.lastResort ?? false };
}

interface FoldLimits { foldedChars?: number; charsPerToken?: number; lastResort?: boolean }

/**
 * Folds the oldest tool results, assistant arguments and reasoning until the messages fit under the budget. Over budget it folds down to a share of it, so the next steps fold nothing and the prefix changes in rare, coarse steps.
 * A result folds at most once in ordinary passes and actionable refusal entries are never folded; the input-backstop pass sets `lastResort`.
 */
export function foldOldToolResults(messages: AgentMessage[], budgetTokens: number = MIN_TOOL_RESULT_BUDGET_TOKENS, limits: FoldLimits = {}): void {
  const settings = foldSettings(messages, limits);
  let total = messages.reduce((sum, message) => sum + carriedTokens(message, settings.charsPerToken), 0);
  if (total <= budgetTokens) return;
  const target = settings.lastResort ? budgetTokens : Math.floor(budgetTokens * FOLD_TARGET_SHARE);
  for (let index = 0; index < messages.length && total > target; index += 1) total -= foldedMessageTokens(messages, index, settings);
}
