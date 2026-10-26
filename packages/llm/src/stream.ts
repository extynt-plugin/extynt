/** Server-sent events from an OpenAI-compatible `/chat/completions` call: the framing is parsed in one place because a chunk boundary can land inside a JSON object, and the deltas accumulate into the same assistant message the non-streaming path replays. */
import type { JsonObject } from "@extynt/decode";
import { decodeStreamChunk, type CompatibleUsage, type StreamChunk, type ToolFragment } from "./openai-wire.js";
import { toolCallWireShape } from "./openai-request.js";
import { toolCallArguments } from "./tool-arguments.js";
import type { AgentToolCall } from "./types.js";

export interface CompatibleStreamReply {
  text: string;
  toolCalls: AgentToolCall[];
  raw: JsonObject;
  finishReason?: string;
  usage?: CompatibleUsage;
}

export interface CompatibleStreamCallbacks {
  onText?: (text: string) => void;
  onReasoning?: (reasoning: string) => void;
  onToolFragment?: () => void;
}

interface ToolCallParts {
  id?: string;
  name?: string;
  args: string;
}

/** The reply a stream assembled, and whether the stream ended with `[DONE]`. */
export interface CompatibleStreamOutcome {
  reply: CompatibleStreamReply;
  sawDone: boolean;
}

/** Reads one stream to its end into a reply; the lock is released and the response cancelled for a caller that stops early. */
export async function readCompatibleStream(stream: ReadableStream<Uint8Array>, callbacks: CompatibleStreamCallbacks): Promise<CompatibleStreamOutcome> {
  const parser = new CompatibleStreamParser(callbacks);
  const reader = stream.getReader();
  try {
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
      parser.push(next.value);
      if (parser.done) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return { reply: parser.end(), sawDone: parser.done };
}

/** The assistant message for a replayed turn, in the one shape both adapter paths produce so a streamed and a non-streamed turn are indistinguishable to the next request. The raw message is kept because DeepSeek refuses a multi-step turn that drops the thinking it emitted with a tool call. */
export function assembleAssistantMessage(message: JsonObject, toolCalls: ReadonlyArray<AgentToolCall>): JsonObject {
  return {
    ...Object.fromEntries(Object.entries(message).filter(([key]) => key !== "tool_calls")),
    role: "assistant",
    content: message.content ?? "",
    ...(toolCalls.length ? { tool_calls: toolCallWireShape(toolCalls) } : {}),
  };
}

class CompatibleStreamParser {
  private readonly decoder = new TextDecoder();
  private buffer = "";
  private text = "";
  private reasoning = "";
  private readonly toolCallParts = new Map<number, ToolCallParts>();
  private finishReason: string | undefined;
  private usage: CompatibleUsage | undefined;
  private sawDone = false;
  private lastToolIndex = 0;

  public constructor(private readonly callbacks: CompatibleStreamCallbacks) {}

  public get done(): boolean { return this.sawDone; }

  public push(chunk: Uint8Array): void {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    this.drain();
  }

  public end(): CompatibleStreamReply {
    this.buffer += this.decoder.decode();
    this.drain();
    if (this.buffer.trim()) this.consumeLine(this.buffer);
    this.buffer = "";
    return this.assembled();
  }

  private assembled(): CompatibleStreamReply {
    const toolCalls = [...this.toolCallParts.entries()]
      .sort(([left], [right]) => left - right)
      .flatMap(([index, parts]) => (parts.name === undefined ? [] : [{ id: parts.id ?? `call-${index}`, name: parts.name, ...toolCallArguments(parts.args) }]));
    const message: JsonObject = this.reasoning ? { content: this.text, reasoning_content: this.reasoning } : { content: this.text };
    return { text: this.text, toolCalls, raw: assembleAssistantMessage(message, toolCalls), ...(this.finishReason ? { finishReason: this.finishReason } : {}), ...(this.usage ? { usage: this.usage } : {}) };
  }

  private drain(): void {
    for (let newline = this.buffer.indexOf("\n"); newline >= 0; newline = this.buffer.indexOf("\n")) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      this.consumeLine(line);
    }
  }

  private consumeLine(line: string): void {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") this.sawDone = true;
    else if (payload) this.consumeChunk(decodeStreamChunk(payload));
  }

  private consumeChunk(chunk: StreamChunk | undefined): void {
    if (!chunk) return;
    this.usage = chunk.usage ?? this.usage;
    this.finishReason = chunk.finishReason ?? this.finishReason;
    this.appendText(chunk);
    for (const fragment of chunk.fragments) this.appendToolFragment(fragment);
  }

  private appendText(chunk: StreamChunk): void {
    if (chunk.text) { this.text += chunk.text; this.callbacks.onText?.(this.text); }
    if (chunk.reasoning) { this.reasoning += chunk.reasoning; this.callbacks.onReasoning?.(this.reasoning); }
  }

  private appendToolFragment(fragment: ToolFragment): void {
    const index = this.toolFragmentSlot(fragment);
    const parts = this.toolCallParts.get(index) ?? { args: "" };
    if (fragment.id) parts.id = fragment.id;
    if (fragment.function?.name) parts.name = fragment.function.name;
    parts.args += fragment.function?.arguments ?? "";
    this.toolCallParts.set(index, parts);
    this.lastToolIndex = index;
    this.callbacks.onToolFragment?.();
  }

  private toolFragmentSlot(fragment: ToolFragment): number {
    if (fragment.index !== undefined && fragment.index >= 0) return fragment.index;
    const current = this.toolCallParts.get(this.lastToolIndex)?.id;
    if (!fragment.id || current === undefined || fragment.id === current) return this.lastToolIndex;
    return Math.max(-1, ...this.toolCallParts.keys()) + 1;
  }
}
