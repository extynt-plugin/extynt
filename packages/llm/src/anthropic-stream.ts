/** The Messages API stream: server-sent events accumulate into one reply, and a stream that ends before `message_stop` is not an answer. */
import { anthropicTokenUsage, decodeStreamEvent, MAX_TOKENS_MESSAGE, mergeAnthropicUsage, streamFailureText, type AnthropicBlock, type AnthropicStreamEvent, type AnthropicUsage } from "./anthropic-wire.js";
import { ProviderHttpError } from "./provider-http-error.js";
import type { AgentStepInput, AgentStepResult } from "./types.js";

const DELTA_TARGETS: Readonly<Record<string, { part: "text" | "reasoning" | "signature"; field: "text" | "thinking" | "signature" }>> = {
  text_delta: { part: "text", field: "text" },
  thinking_delta: { part: "reasoning", field: "thinking" },
  signature_delta: { part: "signature", field: "signature" },
};

/** Reads the body to its end and returns the streamed reply, or null when the stream was cut off before `message_stop`. */
export async function anthropicStreamResult(stream: ReadableStream<Uint8Array>, input: AgentStepInput, status: number, onActivity: () => void): Promise<AgentStepResult | null> {
  const reader = stream.getReader();
  const parser = new AnthropicStreamParser(input, onActivity);
  try {
    for (let next = await reader.read(); !next.done; next = await reader.read()) parser.push(next.value);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return parser.end(status);
}

class AnthropicStreamParser {
  private readonly decoder = new TextDecoder();
  private buffer = "";
  private readonly parts = { text: "", reasoning: "", signature: "" };
  private failure: string | undefined;
  private finishReason: string | undefined;
  private usage: AnthropicUsage | undefined;
  private stopped = false;

  public constructor(private readonly input: AgentStepInput, private readonly onActivity: () => void) {}

  public push(chunk: Uint8Array): void {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    this.drain();
  }

  public end(status: number): AgentStepResult | null {
    this.buffer += this.decoder.decode();
    this.drain();
    if (this.buffer.trim()) this.consumeLine(this.buffer);
    if (this.failure) throw new ProviderHttpError(status, `The Anthropic Messages API stream failed: ${this.failure}`);
    if (!this.stopped) return null;
    this.rejectUnanswered(status);
    return this.result();
  }

  private rejectUnanswered(status: number): void {
    if (this.finishReason === "max_tokens") throw new ProviderHttpError(status, MAX_TOKENS_MESSAGE);
    if (!this.parts.text && !this.parts.reasoning) throw new ProviderHttpError(status, "The Anthropic Messages API returned no streamed text output.");
  }

  private result(): AgentStepResult {
    const { text, reasoning, signature } = this.parts;
    const raw: AnthropicBlock[] = reasoning ? [{ type: "thinking", thinking: reasoning, signature }] : [];
    if (text) raw.push({ type: "text", text });
    return {
      text,
      toolCalls: [],
      raw,
      ...(this.finishReason ? { finishReason: this.finishReason } : {}),
      ...(this.usage ? { usage: anthropicTokenUsage(this.usage) } : {}),
    };
  }

  private drain(): void {
    for (let newline = this.buffer.indexOf("\n"); newline >= 0; newline = this.buffer.indexOf("\n")) {
      this.consumeLine(this.buffer.slice(0, newline).replace(/\r$/, ""));
      this.buffer = this.buffer.slice(newline + 1);
    }
  }

  private consumeLine(line: string): void {
    if (line.startsWith("data:")) this.consumeEvent(decodeStreamEvent(line.slice(5).trim()));
  }

  private consumeEvent(event: AnthropicStreamEvent): void {
    switch (event?.type) {
      case "content_block_delta": this.consumeContent(event.delta); break;
      case "message_delta": this.consumeMessageDelta(event); break;
      case "message_start": this.usage = mergeAnthropicUsage(this.usage, event.message?.usage); break;
      case "error": this.failure = streamFailureText(event.error); break;
      case "message_stop": this.stopped = true; break;
    }
  }

  private consumeMessageDelta(event: MessageDelta): void {
    this.finishReason = event.delta?.stop_reason ?? this.finishReason;
    this.usage = mergeAnthropicUsage(this.usage, event.usage);
  }

  private consumeContent(delta: ContentDelta | undefined): void {
    if (!delta) return;
    this.onActivity();
    const target = DELTA_TARGETS[delta.type ?? ""];
    if (target) this.parts[target.part] += delta[target.field] ?? "";
    this.input.onDelta?.({ text: this.parts.text, reasoning: this.parts.reasoning });
  }
}

type StreamEventOf<Type extends string> = Extract<NonNullable<AnthropicStreamEvent>, { type: Type }>;
type MessageDelta = StreamEventOf<"message_delta">;
type ContentDelta = NonNullable<StreamEventOf<"content_block_delta">["delta"]>;
