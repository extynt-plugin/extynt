/** Renders trace records as the readable transcript `trace` prints. */
import { decode, object, string } from "@extynt/decode";
import type { Decoder } from "@extynt/decode";
import { wireValue } from "@extynt/fake-plugin";
import { lenient, skippingInvalid } from "./lenient.js";
import type { FoldedMessage, StepReplyBody, StepRequestBody, SystemSegment, ToolOffer, TraceRecord, TurnEndBody } from "./trace-records.js";
import { memberOf } from "./wire-reads.js";
import type { WireObject, WireValue } from "./wire-types.js";

/** How a transcript is cut. */
export interface RenderOptions {
  dropped?: number;
  systemPreviewChars?: number;
}

const DEFAULT_SYSTEM_PREVIEW_CHARS = 1_200;

interface RenderedCall { name?: string | undefined; arguments?: WireValue | undefined }
interface RenderedMessage { role?: string | undefined; content?: string | undefined; name?: string | undefined; toolCalls?: RenderedCall[] | undefined }

const renderedCall: Decoder<RenderedCall> = object({ name: lenient(string()), arguments: lenient(wireValue) });
const renderedMessage: Decoder<RenderedMessage> = object({
  role: lenient(string()),
  content: lenient(string()),
  name: lenient(string()),
  toolCalls: lenient(skippingInvalid(renderedCall)),
});
const renderedCalls: Decoder<RenderedCall[]> = skippingInvalid(renderedCall);

function json(value: WireValue | undefined): string {
  return JSON.stringify(value) ?? "null";
}

function messageOf(raw: WireValue): RenderedMessage {
  const decoded = decode(renderedMessage, raw);
  return decoded.ok ? decoded.value : {};
}

function renderTurnStart(message: string): string {
  return `=== turn ===\nrequest: ${message}\n`;
}

function systemPreviewLines(system: readonly SystemSegment[], systemPreviewChars: number): string[] {
  if (!system.length) return [];
  const full = system.map((segment) => segment.text).join("\n");
  const cached = system.some((segment) => segment.cache) ? ", first cached" : "";
  if (full.length <= systemPreviewChars) return [`[system prompt, ${system.length} segment(s)${cached}]\n${full}`];
  return [`[system prompt, ${system.length} segment(s)${cached}, ${full.length} chars — first ${systemPreviewChars} shown]\n${full.slice(0, systemPreviewChars)}\n… [${full.length - systemPreviewChars} more characters of briefing withheld; re-run with --full-prompt for all of it]`];
}

function renderAssistant(message: RenderedMessage): string {
  const content = message.content ?? "";
  const head = content ? `[assistant]\n${content}` : "[assistant] (no text)";
  const calls = message.toolCalls ?? [];
  return calls.length ? `${head}\n${calls.map((call) => `[calls ${call.name ?? "?"}] ${json(call.arguments)}`).join("\n")}` : head;
}

function renderMessage(raw: WireValue): string {
  const message = messageOf(raw);
  const role = message.role ?? "?";
  if (role === "assistant") return renderAssistant(message);
  return role === "tool" ? `[tool result: ${message.name ?? "?"}]\n${message.content ?? ""}` : `[${role}]\n${message.content ?? ""}`;
}

function toolsLine(tools: readonly ToolOffer[]): string[] {
  return tools.length ? [`[tools offered: ${tools.map((tool) => tool.name ?? "?").join(", ")}]`] : [];
}

function renderStepRequest(record: StepRequestBody, systemPreviewChars: number): string {
  const out = [`\n--- step ${record.step} sent (${record.messageCount} messages total) ---`];
  out.push(...systemPreviewLines(record.system ?? [], systemPreviewChars), ...toolsLine(record.tools ?? []));
  for (const message of record.delta) out.push(renderMessage(message));
  return `${out.join("\n")}\n`;
}

function appendReplyPart(out: string[], label: string, value: string): void {
  if (value) out.push(`[${label}]\n${value}`);
}

function usageNumber(usage: WireObject | null | undefined, field: string): string {
  return String(memberOf(usage ?? undefined, field) ?? 0);
}

function usageLine(usage: WireObject | null | undefined, stop: string | null | undefined): string {
  return `in=${usageNumber(usage, "inputTokens")} out=${usageNumber(usage, "outputTokens")} cached=${usageNumber(usage, "cachedInputTokens")} stop=${stop ?? "?"}`;
}

function callsLine(toolCalls: readonly WireValue[]): string[] {
  const decoded = decode(renderedCalls, toolCalls);
  const calls = decoded.ok ? decoded.value : [];
  return calls.length ? [`[called] ${calls.map((call) => `${call.name ?? "?"} ${json(call.arguments)}`).join("\n         ")}`] : [];
}

function renderStepReply(record: StepReplyBody): string {
  const out = [`--- step ${record.step} replied in ${record.durationMs ?? "?"} ms ---`];
  appendReplyPart(out, "reasoning", record.reasoning);
  appendReplyPart(out, "text", record.text);
  const called = callsLine(record.toolCalls);
  out.push(...called);
  if (!record.reasoning && !record.text && !called.length) out.push("[empty reply]");
  if (record.usage) out.push(`[usage] ${usageLine(record.usage, record.finishReason)}`);
  return `${out.join("\n")}\n`;
}

function renderFold(messages: readonly FoldedMessage[]): string {
  return `\n--- context folded: ${messages.map((entry) => `tool result #${entry.position} ${entry.beforeChars} → ${entry.afterChars} chars`).join(", ")} ---\n`;
}

function renderTurnEnd(record: TurnEndBody): string {
  const out = [`\n=== end: ${record.outcome ?? "?"} after ${record.steps ?? "?"} step(s) ===`, `tokens: ${usageLine(record.usage, record.stopReason)}`];
  if (record.failure) out.push(`failure: ${json(record.failure)}`);
  if (record.answer) out.push(`answer: ${record.answer}`);
  return `${out.join("\n")}\n`;
}

function renderRecord(record: TraceRecord, systemPreviewChars: number): string {
  switch (record.kind) {
    case "turn.start": return renderTurnStart(record.message);
    case "step.request": return renderStepRequest(record, systemPreviewChars);
    case "step.reply": return renderStepReply(record);
    case "context.fold": return renderFold(record.messages);
    case "turn.end": return renderTurnEnd(record);
    case "sidecar.log": return "";
  }
}

/** One turn as text, in the order it happened. */
export function renderTrace(records: readonly TraceRecord[], options: RenderOptions = {}): string {
  if (!records.length) return "Nothing recorded. Did the turn reach the provider?";
  const systemPreviewChars = options.systemPreviewChars ?? DEFAULT_SYSTEM_PREVIEW_CHARS;
  const out = records.map((record) => renderRecord(record, systemPreviewChars));
  if (options.dropped) out.push(`\n--- ${options.dropped} record(s) dropped at the trace size limit ---\n`);
  return out.join("");
}
