/**
 * The turn transcript: what the in-panel agent was sent, what it reasoned, and what it was told
 * back. It stays in the test harness and observes a turn by wrapping the injected provider, so
 * nothing in `apps/sidecar` changes and the recording provably cannot ship.
 */
import { decodedValue, isWireArray, isWireObject, wireOfDocument } from "@extynt/fake-plugin";
import type { AgentStepInput, AgentStepResult, ToolCallingProvider } from "@extynt/llm";
import { boundedElapsedMs } from "./clock.js";
import { renderTrace, type RenderOptions } from "./trace-render.js";
import type { FoldedMessage, SystemSegment, ToolOffer, TraceBody, TraceRecord } from "./trace-records.js";
import { memberOf } from "./wire-reads.js";
import type { WireObject, WireValue } from "./wire-types.js";

export type { TraceBody, TraceRecord } from "./trace-records.js";

/** The recorder a turn writes into. */
export interface Trace {
  readonly records: TraceRecord[];
  record(body: TraceBody, at?: string): void;
  render(options?: RenderOptions): string;
  toJsonl(): string;
  reset(): void;
}

interface TraceOptions {
  maxRecords?: number;
  maxChars?: number;
  now?: () => Date;
}

const DEFAULT_MAX_RECORDS = 4_000;
const DEFAULT_MAX_CHARS = 16 * 1024 * 1024;
const RECORD_OVERHEAD_CHARS = 64;

function approxChars(record: TraceRecord): number {
  let total = RECORD_OVERHEAD_CHARS;
  for (const value of Object.values(record)) total += typeof value === "string" ? value.length : RECORD_OVERHEAD_CHARS;
  return total;
}

/** Records as JSONL: one JSON object per line. */
export function recordsToJsonl(records: readonly TraceRecord[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

/** A recorder that keeps at most `maxRecords` records or `maxChars` characters and counts the rest as dropped. */
export function createTrace(options: TraceOptions = {}): Trace {
  const now = options.now ?? (() => new Date());
  const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  let records: TraceRecord[] = [];
  let chars = 0;
  let seq = 0;
  let dropped = 0;
  return {
    get records() { return records; },
    record(body, at) {
      if (records.length >= maxRecords || chars >= maxChars) { dropped += 1; return; }
      const record: TraceRecord = { seq: (seq += 1), at: at ?? now().toISOString(), ...body };
      chars += approxChars(record);
      records.push(record);
    },
    reset() { records = []; chars = 0; dropped = 0; },
    render(renderOptions) { return renderTrace(records, { ...renderOptions, dropped }); },
    toJsonl() { return recordsToJsonl(records); },
  };
}

interface ProviderStepInput {
  system?: string | undefined;
  systemSegments?: SystemSegment[] | undefined;
  messages: WireValue[];
  tools?: WireValue[] | undefined;
}

interface ProviderStepReply {
  text?: string | undefined;
  toolCalls?: WireValue[] | undefined;
  raw?: WireValue | undefined;
  finishReason?: string | undefined;
  usage?: WireObject | undefined;
}

/**
 * The provider's own reasoning, in whichever shape the adapter kept it: DeepSeek returns
 * `reasoning_content`, Anthropic returns `thinking` blocks in `content`.
 */
export function extractReasoning(raw: WireValue | undefined): string {
  const direct = memberOf(raw, "reasoning_content");
  if (typeof direct === "string" && direct.trim()) return direct;
  const content = memberOf(raw, "content");
  if (!isWireArray(content)) return "";
  const thinking: string[] = [];
  for (const block of content) {
    const text = memberOf(block, "thinking");
    if (memberOf(block, "type") === "thinking" && typeof text === "string") thinking.push(text);
  }
  return thinking.join("\n");
}

function toolMessageLengths(messages: readonly WireValue[]): number[] {
  const lengths: number[] = [];
  for (const message of messages) {
    if (memberOf(message, "role") !== "tool") continue;
    const content = memberOf(message, "content");
    lengths.push(content === undefined || content === null ? 0 : String(content).length);
  }
  return lengths;
}

function detectFold(messages: readonly WireValue[], previous: readonly number[]): FoldedMessage[] {
  const current = toolMessageLengths(messages);
  const folded: FoldedMessage[] = [];
  for (let index = 0; index < Math.min(previous.length, current.length); index += 1) {
    const before = previous[index] ?? 0;
    const after = current[index] ?? 0;
    if (after < before) folded.push({ position: index, beforeChars: before, afterChars: after });
  }
  return folded;
}

function summarizeTool(tool: WireValue): ToolOffer {
  if (!isWireObject(tool)) return {};
  const { name, description } = tool;
  return { ...(typeof name === "string" ? { name } : {}), ...(typeof description === "string" ? { description } : {}) };
}

function systemOf(input: ProviderStepInput): SystemSegment[] {
  return input.systemSegments?.length ? input.systemSegments : [{ text: input.system ?? "", cache: true }];
}

interface WrapperState { sent: number; steps: number; toolLengths: number[] }

function startsTurn(trace: Trace): boolean {
  const last = trace.records.at(-1);
  return last === undefined || last.kind === "turn.start";
}

function recordRequest(trace: Trace, state: WrapperState, input: ProviderStepInput): number {
  if (startsTurn(trace)) Object.assign(state, { sent: 0, steps: 0, toolLengths: [] });
  const step = state.steps += 1;
  const first = step === 1;
  trace.record({
    kind: "step.request", step, messageCount: input.messages.length, delta: input.messages.slice(state.sent),
    ...(first ? { system: systemOf(input), tools: (input.tools ?? []).map(summarizeTool) } : {}),
  });
  state.sent = input.messages.length;
  const folded = detectFold(input.messages, state.toolLengths);
  state.toolLengths = toolMessageLengths(input.messages);
  if (folded.length) trace.record({ kind: "context.fold", messages: folded });
  return step;
}

function recordReply(trace: Trace, step: number, reply: ProviderStepReply, durationMs: number | undefined): void {
  trace.record({
    kind: "step.reply", step, durationMs, text: reply.text ?? "", reasoning: extractReasoning(reply.raw),
    toolCalls: reply.toolCalls ?? [], finishReason: reply.finishReason ?? null, usage: reply.usage ?? null,
  });
}

function stepInputOf(input: AgentStepInput): ProviderStepInput {
  const messages = input.messages.map((message) => decodedValue(wireOfDocument(message)));
  return { system: input.system, systemSegments: input.systemSegments, messages, tools: input.tools.map((tool) => decodedValue(wireOfDocument(tool))) };
}

function stepReplyOf(reply: AgentStepResult): ProviderStepReply {
  const usage = reply.usage === undefined ? undefined : decodedValue(wireOfDocument(reply.usage));
  return {
    text: reply.text,
    toolCalls: reply.toolCalls.map((call) => decodedValue(wireOfDocument(call))),
    raw: reply.raw === undefined ? undefined : decodedValue(wireOfDocument(reply.raw)),
    finishReason: reply.finishReason,
    usage: isWireObject(usage) ? usage : undefined,
  };
}

/** The wrapper `tracingProvider` returns: every member the sidecar reads, each forwarded to the provider it wraps. */
export type TracedProvider = ToolCallingProvider;

/**
 * Wraps a tool-calling provider so a turn is recorded as it runs. Messages are recorded as
 * deltas, because a sixty-step turn re-sends a growing array every step, and a fold is detected
 * by comparing the tool messages this step sent against the ones the previous step sent.
 */
export function tracingProvider(inner: ToolCallingProvider, trace: Trace): TracedProvider {
  const state: WrapperState = { sent: 0, steps: 0, toolLengths: [] };
  const step = async (input: AgentStepInput): Promise<AgentStepResult> => {
    const at = recordRequest(trace, state, stepInputOf(input));
    const started = Date.now();
    const reply = await inner.step(input);
    recordReply(trace, at, stepReplyOf(reply), boundedElapsedMs(started));
    return reply;
  };
  const forwarded: TracedProvider = {
    get id() { return inner.id; },
    get model() { return inner.model; },
    get config() { return inner.config; },
    get displayMetadata() { return inner.displayMetadata; },
    complete: (input) => inner.complete(input),
    step,
    ...(inner.discoverCapabilities ? { discoverCapabilities: inner.discoverCapabilities.bind(inner) } : {}),
    ...(inner.discoverEfforts ? { discoverEfforts: inner.discoverEfforts.bind(inner) } : {}),
  };
  return Object.defineProperty(forwarded, "capabilities", { get: () => inner.capabilities, enumerable: true });
}

export { renderTrace } from "./trace-render.js";
