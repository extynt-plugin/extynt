// Server-sent-event builders and streaming fetch doubles for the OpenAI-compatible adapter tests.
import type { JsonObject } from "@extynt/decode";
import { createLocalSecretInput, type AgentStepInput } from "../src/index.js";
import { OpenAICompatibleProvider } from "../src/openai.js";
import { captureRequest, type CapturedRequest } from "./wire-fixtures.js";

const SSE_HEADERS = { "Content-Type": "text/event-stream" };

export const DONE_FRAME = "data: [DONE]\n\n";

export const STEP: Omit<AgentStepInput, "onDelta"> = { requestId: "r", system: "Brief.", messages: [{ role: "user", content: "fade it" }], tools: [{ name: "ae_propose_plan", description: "Propose.", parameters: { type: "object" } }] };

export interface Delta {
  text: string;
  reasoning: string;
}

export function sseEvent(payload: JsonObject): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export function contentDelta(delta: JsonObject, finishReason?: string): string {
  return sseEvent({ choices: [{ index: 0, delta, ...(finishReason ? { finish_reason: finishReason } : {}) }] });
}

export function toolFragment(index: number, fragment: JsonObject): string {
  return sseEvent({ choices: [{ index: 0, delta: { tool_calls: [{ index, ...fragment }] } }] });
}

export function streamingFetchResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: SSE_HEADERS });
}

export function brokenStreamResponse(chunk: string): Response {
  const encoder = new TextEncoder();
  let sent = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent) {
        controller.error(new TypeError("terminated"));
        return;
      }
      sent = true;
      controller.enqueue(encoder.encode(chunk));
    },
  });
  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}

export function streamingFetch(chunks: string[], requestBody?: (body: CapturedRequest) => void): typeof fetch {
  return async (_input, init) => {
    requestBody?.(captureRequest(String(init?.body)));
    return streamingFetchResponse(chunks);
  };
}

export function deepSeekStreaming(fetch: typeof globalThis.fetch, stream = true): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    secretSource: createLocalSecretInput("deepseek-secret"),
    config: { id: "deepseek-flash", endpoint: "http://127.0.0.1:4310", model: "deepseek-flash", authSource: "local-secret-input", stream },
    fetch,
  });
}

export function recordingStream(respond: (request: CapturedRequest, call: number) => Response, stream = true): { provider: OpenAICompatibleProvider; bodies: CapturedRequest[] } {
  const bodies: CapturedRequest[] = [];
  const provider = deepSeekStreaming(async (_input, init) => {
    const request = captureRequest(String(init?.body));
    bodies.push(request);
    return respond(request, bodies.length);
  }, stream);
  return { provider, bodies };
}

export function streamingProvider(body: (call: number, request: CapturedRequest) => string, stream: boolean): { provider: OpenAICompatibleProvider; bodies: CapturedRequest[] } {
  return recordingStream((request, call) => {
    const payload = body(call, request);
    return request.stream === true ? streamingFetchResponse([payload]) : new Response(payload, { status: 200 });
  }, stream);
}

export function collectingDeltas(): { deltas: Delta[]; onDelta: (delta: Delta) => void } {
  const deltas: Delta[] = [];
  return { deltas, onDelta: (delta) => { deltas.push(delta); } };
}
