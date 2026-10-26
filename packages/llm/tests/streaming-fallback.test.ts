// How a streamed step recovers: a gateway that ignores or rejects streaming, a stream that dies, and the caller's Stop.
import assert from "node:assert/strict";
import test from "node:test";
import { extractReasoning } from "../src/index.js";
import { requestAt } from "./wire-fixtures.js";
import { DONE_FRAME, STEP, brokenStreamResponse, collectingDeltas, contentDelta, deepSeekStreaming, recordingStream, streamingFetch, streamingFetchResponse } from "./stream-fixtures.js";

const doneReply = { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Done." } }] };

test("a provider that ignores the stream flag falls back to the ordinary request", async () => {
  const { provider, bodies } = recordingStream((request) => request.stream === true
    ? new Response(JSON.stringify(doneReply), { status: 200, headers: { "Content-Type": "application/json" } })
    : new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Done.", reasoning_content: "thought" } }], usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 } }), { status: 200 }));
  const result = await provider.step(STEP);

  assert.equal(result.text, "Done.");
  assert.equal(bodies.length, 2, "the stream attempt is followed by one ordinary request");
  assert.equal(requestAt(bodies, 0).stream, true);
  assert.equal("stream" in requestAt(bodies, 1), false, "the fallback body is the plain non-streaming request");
  assert.equal("stream_options" in requestAt(bodies, 1), false);
  assert.equal(extractReasoning(result.raw), "thought");
  assert.equal(result.usage?.totalTokens, 12);
});

test("a stream that dies mid-reply falls back whole, with no duplicated text", async () => {
  const { deltas, onDelta } = collectingDeltas();
  const { provider, bodies } = recordingStream((request) => request.stream === true
    ? streamingFetchResponse([contentDelta({ content: "The plan is to fade the layer and then" })])
    : new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "The plan is to fade the layer and then trim it." } }] }), { status: 200 }));
  const result = await provider.step({ ...STEP, onDelta });

  assert.equal(deltas.length, 1, "the reader saw the partial stream");
  assert.equal(result.text, "The plan is to fade the layer and then trim it.");
  assert.equal(bodies.length, 2);
  assert.equal(result.text.includes("and thenand then"), false, "the fallback reply is not pasted onto the partial one");
});

test("a rejected stream_options is retried without it", async () => {
  const { provider, bodies } = recordingStream((request) => request.stream_options
    ? new Response(JSON.stringify({ error: { message: "Unrecognized request argument supplied: stream_options" } }), { status: 400 })
    : streamingFetchResponse([contentDelta({ content: "Done." }, "stop"), DONE_FRAME]));
  const result = await provider.step(STEP);

  assert.equal(result.text, "Done.");
  assert.equal(bodies.length, 2, "one retry without the field, not a fallback to non-streaming");
  assert.equal(requestAt(bodies, 1).stream, true, "the retry is still a streaming request");
  assert.equal("stream_options" in requestAt(bodies, 1), false);
  assert.equal(result.usage, undefined, "a provider that cannot report usage still answers");
});

test("a truncated stream reports the truncation instead of silently falling back", async () => {
  const { provider, bodies } = recordingStream(() => streamingFetchResponse([contentDelta({ content: "The plan is to fade the layer and then" }, "length"), DONE_FRAME]));
  await assert.rejects(provider.step(STEP), /length/);
  assert.equal(bodies.length, 1, "a truncated answer is not retried");
});

test("a stream that closes after its finish reason without [DONE] is still complete", async () => {
  const provider = deepSeekStreaming(streamingFetch([contentDelta({ content: "Done." }, "stop")]));
  const result = await provider.step(STEP);
  assert.equal(result.text, "Done.");
  assert.equal(result.finishReason, "stop");
});

test("a gateway that rejects the stream request falls back to the ordinary request", async () => {
  const { provider, bodies } = recordingStream((request) => request.stream === true
    ? new Response("streaming is not supported", { status: 400 })
    : new Response(JSON.stringify(doneReply), { status: 200 }));
  const result = await provider.step(STEP);

  assert.equal(result.text, "Done.");
  assert.equal(bodies.length, 2, "the rejected stream is followed by one ordinary request");
  assert.equal("stream" in requestAt(bodies, 1), false);
});

test("a stream whose reader fails after partial output falls back to the ordinary request", async () => {
  const { deltas, onDelta } = collectingDeltas();
  const { provider, bodies } = recordingStream((request) => request.stream === true
    ? brokenStreamResponse(contentDelta({ content: "The plan is" }))
    : new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "The plan is to fade the layer." } }] }), { status: 200 }));
  const result = await provider.step({ ...STEP, onDelta });

  assert.equal(deltas.length, 1, "the partial stream was seen before the read failed");
  assert.equal(result.text, "The plan is to fade the layer.");
  assert.equal(bodies.length, 2);
  assert.equal("stream" in requestAt(bodies, 1), false);
});

test("the caller's Stop during a streamed step is not followed by an ordinary request", async () => {
  const stop = new AbortController();
  const { provider, bodies } = recordingStream(() => {
    stop.abort();
    return brokenStreamResponse(contentDelta({ content: "The plan" }));
  });

  await assert.rejects(provider.step({ ...STEP, signal: stop.signal }));
  assert.equal(bodies.length, 1, "a stopped turn sends no second request");
});
