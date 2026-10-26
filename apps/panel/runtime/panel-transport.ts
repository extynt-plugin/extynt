/**
 * The panel's one request path to the sidecar: a loopback XHR with the bearer from the host's injected info, JSON in
 * and out, and one error shape. A 401 means the sidecar restarted with a new token, so the page reloads to get it.
 * Every answer is decoded here, so a caller receives a typed value or a TransportError.
 */
import type { DecodeResult, Decoder } from "@extynt/decode";
import { modelCallsDecoder, recordRequestMetric } from "./panel-usage.js";
import { t } from "./panel-language.js";
import { dispatch, uiState } from "./ui-state.js";
import { decode, decodeJson, fallback, type JsonValue, object, string } from "@extynt/decode";

/** What a request carries besides its method, path and body: the ids the sidecar logs, the timeout, and the open XHR. */
export interface TransportContext {
  readonly method: string;
  readonly path: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly startedAt: number;
  polling?: boolean;
  timeoutMs?: number;
  abortReason?: string;
  client?: string;
  completed?: boolean;
  settled?: boolean;
  xhr?: XMLHttpRequest;
}

interface SidecarError {
  readonly code: string | null;
  readonly message: string | null;
}

interface FailureDetails {
  readonly local?: boolean;
  readonly unreachable?: boolean;
  readonly status?: number;
  readonly sidecar?: SidecarError | null;
}

/**
 * A request that did not produce a decoded answer. `local` failures never left the panel; `unreachable` ones got no HTTP
 * answer. `code` is the error code the sidecar put in the body of a failed answer, and `reason` its message (else this
 * error's own message).
 */
export class TransportError extends Error {
  readonly local: boolean;
  readonly unreachable: boolean;
  readonly status: number | null;
  readonly code: string | null;
  readonly reason: string;

  constructor(message: string, details: FailureDetails = {}) {
    super(message);
    this.local = details.local === true;
    this.unreachable = details.unreachable === true;
    this.status = details.status ?? null;
    this.code = details.sidecar?.code || null;
    this.reason = details.sidecar?.message || message;
  }
}

/** The outcome of one request: the decoded answer or the error. */
export type Reply<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: TransportError };
/** Receives the outcome of one request. */
export type OnReply<T> = (reply: Reply<T>) => void;

/** One request: what to send, the context that identifies it, and the decoder for the answer. */
export interface Call<T> {
  readonly method: string;
  readonly path: string;
  readonly body: JsonValue | null;
  readonly context: TransportContext;
  readonly decoder: Decoder<T>;
}

const DEFAULT_TIMEOUT_MS = 30000;

function localError(message: string): TransportError {
  return new TransportError(message, { local: true });
}

/** A unique id for a request, tagged with what it is for. */
export function diagnosticId(prefix: string): string {
  const crypto = window.crypto;
  if (crypto !== undefined && typeof crypto.randomUUID === "function") return prefix + "-" + crypto.randomUUID();
  return prefix + "-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 0x1000000).toString(36);
}

/** The ids and timing for a request the user can see. */
export function transportContext(method: string, path: string, requestId?: string, correlationId?: string): TransportContext {
  return { method, path, requestId: requestId || diagnosticId("request"), correlationId: correlationId || diagnosticId("correlation"), startedAt: Date.now() };
}

/** The same for a background poll, which the request log leaves out. */
export function pollContext(method: string, path: string, requestId?: string, correlationId?: string): TransportContext {
  return { ...transportContext(method, path, requestId, correlationId), polling: true };
}

/** Runs the function after the delay; null when the page has no timers (a test stub). */
export function later(fn: () => void, ms: number): ReturnType<typeof setTimeout> | null {
  return typeof setTimeout === "function" ? setTimeout(fn, ms) : null;
}

/** Runs the function every `ms` milliseconds. */
export function every(fn: () => void, ms: number): void {
  if (typeof setInterval === "function") setInterval(fn, ms);
}

let reloading = false;
const FAILURES_BEFORE_RELOAD = 3;
let silentFailures = 0;

/** One request or stream got no HTTP answer. The third in a row (no answer in between) reloads the page, once per streak. */
export function noteNoAnswer(): void {
  silentFailures += 1;
  if (silentFailures === FAILURES_BEFORE_RELOAD) reloadForFreshToken();
}

/** The sidecar answered with any HTTP status, so the failure streak is over. */
export function noteAnswered(): void {
  silentFailures = 0;
}

/** True when the request got no HTTP answer at all. */
export function isUnreachable(error: TransportError): boolean {
  return error.unreachable;
}

/** True once the page has been told to reload for a fresh token: a request that failed on the way out failed because of that. */
export function reloadingForToken(): boolean {
  return reloading;
}

/** The host injects a fresh token on every page load, so a reload is the whole recovery. */
export function reloadForFreshToken(): void {
  if (reloading) return;
  reloading = true;
  if (typeof window.location?.reload === "function") window.location.reload();
}

const sidecarBodyDecoder = object({ error: object({ code: fallback(string(), null), message: fallback(string(), null) }) });

function httpError(xhr: XMLHttpRequest): TransportError {
  const body = decodeJson(xhr.responseText, sidecarBodyDecoder);
  const message = t("chat.transport.httpStatus", { status: xhr.status, body: xhr.responseText.slice(0, 300) });
  return new TransportError(message, { status: xhr.status, sidecar: body.ok ? body.value.error : null });
}

function headersFor(xhr: XMLHttpRequest, context: TransportContext, token: string, hasBody: boolean): void {
  xhr.setRequestHeader("Authorization", "Bearer " + token);
  xhr.setRequestHeader("X-AE-Correlation-Id", context.correlationId);
  xhr.setRequestHeader("X-AE-Request-Id", context.requestId);
  const instance = uiState().hostInstanceId;
  if (instance) xhr.setRequestHeader("X-AE-Panel-Instance", instance);
  const build = window.__EXTYNT_PANEL_BUILD_ID__;
  if (typeof build === "string" && /^[a-f0-9]{16}$/.test(build)) xhr.setRequestHeader("X-AE-Panel-Build", build);
  if (context.client) xhr.setRequestHeader("X-AE-Client", context.client);
  if (hasBody) xhr.setRequestHeader("Content-Type", "application/json");
}

declare global { interface Window { __EXTYNT_PANEL_BUILD_ID__?: string } }

function finish<T>(call: Call<T>, done: OnReply<T>, reply: Reply<T>, modelCalls: number): void {
  const context = call.context;
  if (context.completed) return;
  context.completed = true;
  const failed = !reply.ok && !reply.error.local;
  recordRequestMetric({ method: context.method, path: context.path, durationMs: Date.now() - context.startedAt, error: failed, polling: context.polling === true, modelCalls });
  if (!reply.ok && reply.error.status === 401) reloadForFreshToken();
  done(reply);
}

function failWith<T>(error: TransportError): Reply<T> {
  return { ok: false, error };
}

interface Answered<T> {
  readonly reply: Reply<T>;
  readonly modelCalls: number;
}

interface Tallied<T> {
  readonly result: DecodeResult<T>;
  readonly modelCalls: number;
}

function tallied<T>(decoder: Decoder<T>): Decoder<Tallied<T>> {
  return {
    run(input) {
      const usage = decode(modelCallsDecoder, input);
      return { result: decode(decoder, input), modelCalls: usage.ok ? usage.value : 0 };
    },
  };
}

function answer<T>(call: Call<T>, xhr: XMLHttpRequest): Answered<T> {
  if (xhr.status < 200 || xhr.status >= 300) return { reply: failWith(httpError(xhr)), modelCalls: 0 };
  const parsed = decodeJson(xhr.responseText, tallied(call.decoder));
  if (!parsed.ok) return { reply: failWith(new TransportError(t("chat.transport.invalidJson", { detail: parsed.error.message }))), modelCalls: 0 };
  const { result, modelCalls } = parsed.value;
  if (result.ok) return { reply: { ok: true, value: result.value }, modelCalls };
  return { reply: failWith(new TransportError(t("chat.transport.notUnderstood", { detail: result.error.message }))), modelCalls };
}

function wireXhr<T>(xhr: XMLHttpRequest, call: Call<T>, done: OnReply<T>): void {
  xhr.onload = () => {
    noteAnswered();
    dispatch({ type: "reachable", reachable: true, now: Date.now() });
    const answered = answer(call, xhr);
    finish(call, done, answered.reply, answered.modelCalls);
  };
  xhr.onerror = () => {
    dispatch({ type: "reachable", reachable: false, now: Date.now() });
    noteNoAnswer();
    finish(call, done, failWith(new TransportError(t("chat.transport.unreachable"), { unreachable: true })), 0);
  };
  xhr.ontimeout = () => finish(call, done, failWith(new TransportError(t("chat.transport.timeout", { ms: xhr.timeout }), { unreachable: true })), 0);
  xhr.onabort = () => finish(call, done, failWith(localError(call.context.abortReason === "idle" ? t("chat.transport.idleAbandoned") : t("chat.transport.stopped"))), 0);
}

/** Sends the call and hands the decoded answer, or the error, to `done` exactly once. */
export function send<T>(call: Call<T>, done: OnReply<T>): void {
  const native = uiState().native;
  if (!native) {
    finish(call, done, failWith(localError(t("chat.transport.noSession"))), 0);
    return;
  }
  const xhr = new XMLHttpRequest();
  call.context.xhr = xhr;
  try {
    const serialized = call.body === null ? null : JSON.stringify(call.body);
    xhr.open(call.method, native.sidecarOrigin + call.path, true);
    xhr.timeout = call.context.timeoutMs || DEFAULT_TIMEOUT_MS;
    headersFor(xhr, call.context, native.token, serialized !== null);
    wireXhr(xhr, call, done);
    xhr.send(serialized);
  } catch (error) {
    finish(call, done, failWith(new TransportError(error instanceof Error ? error.message : String(error))), 0);
  }
}
