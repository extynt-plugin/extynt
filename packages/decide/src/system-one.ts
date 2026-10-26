// A decision model that speaks the "system one" dialect (POST /v1/systemone): many keyed questions in one request, one keyed answer each.
import { decodeJson } from "@extynt/decode";
import type { HttpFetch, HttpReply } from "./http.js";
import { failureOfThrown } from "./http-port.js";
import { LANGUAGE_MODEL_BANDS } from "./language-model.js";
import type { JsonValue } from "./json.js";
import type { Answer, DecisionModel, DecisionOutcome, Failure, Question } from "./port.js";
import type { Bands, DecisionKind } from "./spec.js";
import { answerFor, wireProblem, wireQuestions, wireReply } from "./system-one-wire.js";

/** How to reach one system-one server. The key is optional because local servers take none. */
export interface SystemOneConfig {
  readonly id: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey?: string;
  readonly threshold: number;
  readonly calibrated: boolean;
  readonly bands?: Bands | null;
  readonly fetch: HttpFetch;
  readonly pause?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly jitter?: () => number;
}

const SUPPORTED: ReadonlySet<DecisionKind> = new Set(["choice", "score", "binary"]);

const BACKOFF_STATUSES: ReadonlySet<number> = new Set([429, 529]);

const BACKOFF_BASE_MS = 150;

const STATE_TOO_LARGE = "max_tokens_exceeded";

function pauseUnlessAborted(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

function failed(reason: Failure["reason"], detail: string): DecisionOutcome {
  return { ok: false, failure: { reason, detail } };
}

function headersOf(config: SystemOneConfig): Readonly<Record<string, string>> {
  const json = { "Content-Type": "application/json" };
  return config.apiKey === undefined || config.apiKey === "" ? json : { ...json, Authorization: `Bearer ${config.apiKey}` };
}

function problemDetail(body: string): string {
  const parsed = decodeJson(body, wireProblem);
  if (!parsed.ok) return "The server rejected the request.";
  return parsed.value.detail.map((problem) => `${problem.loc.join(".")}: ${problem.msg}`).join("; ");
}

function failureOfBadRequest(body: string): DecisionOutcome {
  return body.includes(STATE_TOO_LARGE) ? failed("state-too-large", "The state is larger than a decision model reads; trim it and ask again.") : failed("rejected", "The server rejected the request.");
}

async function failureOfStatus(reply: HttpReply): Promise<DecisionOutcome> {
  const { status } = reply;
  if (status === 401 || status === 403) return failed("unauthorized", `The server refused the API key (HTTP ${status}).`);
  if (status === 400) return failureOfBadRequest(await reply.text());
  if (status === 422) return failed("rejected", problemDetail(await reply.text()));
  if (BACKOFF_STATUSES.has(status)) return failed("backoff", `The server asked to back off (HTTP ${status}).`);
  return failed("unavailable", `The server answered HTTP ${status}.`);
}

function answersOf(body: string, questions: ReadonlyArray<Question>): DecisionOutcome {
  const parsed = decodeJson(body, wireReply);
  if (!parsed.ok) return failed("malformed", parsed.error.message);
  const answers = new Map<string, Answer>();
  for (const question of questions) {
    const answer = answerFor(parsed.value.answers, question);
    if (answer !== null) answers.set(question.id, answer);
  }
  return { ok: true, answers, usage: { model: parsed.value.model ?? null, inputTokens: parsed.value.usage?.input_tokens ?? null } };
}

function failureOfError(error: Error, signal: AbortSignal): DecisionOutcome {
  const failure = failureOfThrown(error, signal);
  return failed(failure.reason, failure.message);
}

async function exchange(config: SystemOneConfig, body: string, signal: AbortSignal): Promise<HttpReply | Error> {
  try {
    return await config.fetch(`${config.baseUrl.replace(/\/+$/, "")}/v1/systemone`, { method: "POST", headers: headersOf(config), body, signal });
  } catch (error) {
    return error instanceof Error ? error : new Error("The request failed.");
  }
}

async function exchangeOnce(config: SystemOneConfig, body: string, signal: AbortSignal): Promise<HttpReply | Error> {
  const reply = await exchange(config, body, signal);
  if (reply instanceof Error || !BACKOFF_STATUSES.has(reply.status) || signal.aborted) return reply;
  const wait = BACKOFF_BASE_MS * (1 + (config.jitter ?? Math.random)());
  await (config.pause ?? pauseUnlessAborted)(wait, signal);
  return exchange(config, body, signal);
}

async function ask(config: SystemOneConfig, state: JsonValue, questions: ReadonlyArray<Question>, signal: AbortSignal): Promise<DecisionOutcome> {
  const wire = wireQuestions(questions);
  if (wire === null) return failed("rejected", "A question of a kind this dialect cannot ask was sent.");
  const reply = await exchangeOnce(config, JSON.stringify({ model: config.model, state, questions: wire }), signal);
  if (reply instanceof Error) return failureOfError(reply, signal);
  if (reply.status < 200 || reply.status >= 300) return failureOfStatus(reply);
  return answersOf(await reply.text(), questions);
}

/** A decision model for any server that speaks the system-one dialect; an uncalibrated one routes with the conservative language-model bands, a calibrated one with the bands it is given or each spec's own. It asks choice, score and yes or no questions natively. */
export function systemOneDecisionModel(config: SystemOneConfig): DecisionModel {
  const bands = config.bands === undefined ? (config.calibrated ? null : LANGUAGE_MODEL_BANDS) : config.bands;
  return {
    id: config.id,
    tier: "decision-model",
    supports: SUPPORTED,
    calibrated: config.calibrated,
    threshold: config.threshold,
    ...(bands === null ? {} : { bands }),
    decide: (state, questions, signal) => ask(config, state, questions, signal),
  };
}
