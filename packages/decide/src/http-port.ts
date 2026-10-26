// One JSON POST for the hosted language-model dialects, with every way it can go wrong named as a failure reason.
import { decode, errorCauseCode } from "@extynt/decode";
import type { HttpFetch, HttpReply } from "./http.js";
import { LanguageModelFailure } from "./language-failure.js";

interface JsonPost {
  readonly fetch: HttpFetch;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly signal: AbortSignal;
}

const OVERSIZED_MARKERS: ReadonlyArray<string> = ["context_length_exceeded", "too long", "maximum context"];

async function badRequest(reply: HttpReply): Promise<LanguageModelFailure> {
  const body = (await reply.text()).toLowerCase();
  const oversized = OVERSIZED_MARKERS.some((marker) => body.includes(marker));
  return oversized ? new LanguageModelFailure("state-too-large", "The state is larger than the model reads; trim it and ask again.") : new LanguageModelFailure("rejected", "The provider rejected the request (HTTP 400).");
}

async function failureOfStatus(reply: HttpReply): Promise<LanguageModelFailure> {
  const { status } = reply;
  if (status === 401 || status === 403) return new LanguageModelFailure("unauthorized", `The provider refused the API key (HTTP ${status}).`);
  if (status === 429 || status === 529) return new LanguageModelFailure("backoff", `The provider asked to back off (HTTP ${status}).`);
  if (status === 400) return badRequest(reply);
  if (status >= 400 && status < 500) return new LanguageModelFailure("rejected", `The provider rejected the request (HTTP ${status}).`);
  return new LanguageModelFailure("unavailable", `The provider answered HTTP ${status}.`);
}

const UNREACHABLE_CODES: ReadonlySet<string> = new Set(["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH"]);

/** The failure of a request that threw: a timeout when the call was aborted, "unavailable" otherwise, with a plain sentence when the server cannot be reached at all. */
export function failureOfThrown(error: Error, signal: AbortSignal): LanguageModelFailure {
  if (signal.aborted || error.name === "AbortError" || error.name === "TimeoutError") return new LanguageModelFailure("timeout", "The request did not finish in time.");
  const code = decode(errorCauseCode, error);
  if (code.ok && UNREACHABLE_CODES.has(code.value)) return new LanguageModelFailure("unavailable", `Nothing answered at the configured address (${code.value}); is the server running?`);
  return new LanguageModelFailure("unavailable", `The request failed: ${error.message}`);
}

async function send(post: JsonPost): Promise<HttpReply> {
  try {
    return await post.fetch(post.url, { method: "POST", headers: post.headers, body: post.body, signal: post.signal });
  } catch (error) {
    throw failureOfThrown(error instanceof Error ? error : new Error("The request failed."), post.signal);
  }
}

/** The body text of a successful reply; any other outcome throws a `LanguageModelFailure`. */
export async function postJson(post: JsonPost): Promise<string> {
  const reply = await send(post);
  if (reply.status < 200 || reply.status >= 300) throw await failureOfStatus(reply);
  return reply.text();
}

/** The JSON headers of a hosted chat endpoint, with a bearer key when there is one. */
export function bearerHeaders(apiKey: string | undefined): Readonly<Record<string, string>> {
  const json = { "Content-Type": "application/json" };
  return apiKey === undefined || apiKey === "" ? json : { ...json, Authorization: `Bearer ${apiKey}` };
}
