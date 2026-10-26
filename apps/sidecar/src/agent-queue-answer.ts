// Reads what a queue write answered, so the log can explain a resend and the loop can tell a write that left work owed.
import { array, decode, decodeJson, nullable, number, object, optional, rawJson, string, union, type Decoder, type Infer } from "@extynt/decode";
import type { AgentToolCall } from "@extynt/llm";
import { MAX_DIAGNOSTIC_TEXT_CHARS } from "./agent-policy.js";
import type { AgentQueueAnswerLog, ToolResult } from "./agent-types.js";

const MAX_LOGGED_REFUSALS = 4;
const MAX_REFUSAL_MESSAGE_CHARS = 240;

function lenient<T>(decoder: Decoder<T>) {
  return optional(nullable(decoder));
}

const REFUSAL = object({ positions: lenient(array(union(number(), string()))), type: lenient(string()), code: lenient(string()), message: lenient(string()) });
const FIX_LIST = object({ fix: lenient(array(rawJson())) });
const QUEUE_ANSWER = object({
  queued: lenient(number()),
  accepted: lenient(number()),
  fix: lenient(array(rawJson())),
  checkpoint: lenient(object({ outstanding: lenient(array(rawJson())) })),
  next: lenient(string()),
});

const QUEUE_WRITE_TOOLS: ReadonlySet<string> = new Set(["ae_queue_add", "ae_queue_fix", "ae_plan_add"]);

function refusalLine(entry: string): string {
  const decoded = decodeJson(entry, REFUSAL);
  const fix: Infer<typeof REFUSAL> = decoded.ok ? decoded.value : {};
  return `${fix.positions?.join(",") ?? "?"} ${fix.type ?? ""} ${fix.code ?? ""}: ${(fix.message ?? "").slice(0, MAX_REFUSAL_MESSAGE_CHARS)}`;
}

function answerCounts({ queued, accepted, checkpoint }: Infer<typeof QUEUE_ANSWER>): Pick<AgentQueueAnswerLog, "queued" | "accepted" | "outstanding"> {
  return { queued: queued ?? undefined, accepted: accepted ?? undefined, outstanding: checkpoint?.outstanding?.length };
}

function refusalLines(fix: readonly string[] | undefined): Pick<AgentQueueAnswerLog, "fix" | "refusals"> {
  return { fix: fix?.length, refusals: fix?.slice(0, MAX_LOGGED_REFUSALS).map(refusalLine) };
}

/** An accepted queue call can still have queued nothing; its counts, the operations it refused and its next step are what explain a resend. Absent for any other call or an answer of another shape. */
export function queueAnswerLog(call: AgentToolCall, result: ToolResult): AgentQueueAnswerLog | undefined {
  if (!result.ok || !QUEUE_WRITE_TOOLS.has(call.name)) return undefined;
  const decoded = decode(QUEUE_ANSWER, result.data);
  if (!decoded.ok) return undefined;
  const { fix, next } = decoded.value;
  return { ...answerCounts(decoded.value), ...refusalLines(fix ?? undefined), next: next?.slice(0, MAX_DIAGNOSTIC_TEXT_CHARS) };
}

/** A queue write refused outright, or answered with operations to fix: whether none or only some of the call was taken, work it named is still missing. */
export function queueWriteRefused(call: AgentToolCall, result: ToolResult): boolean {
  if (!QUEUE_WRITE_TOOLS.has(call.name)) return false;
  if (!result.ok) return true;
  const decoded = decode(FIX_LIST, result.data);
  return decoded.ok && (decoded.value.fix?.length ?? 0) > 0;
}
