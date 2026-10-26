// Turns provider errors into failures a user can act on, and decides which failed runs fall back to another model.
import { decode, decodeJson, errorCauseCode, fallback, number, object, optional, string } from "@extynt/decode";
import { supportsTools, type ChatProvider, type ToolCallingProvider } from "@extynt/llm";
import type { Translate } from "@extynt/ui-text";
import { ENGLISH_FAILURE_TEXT } from "./failure-english.js";
import { MAX_PROVIDER_ERROR_CHARS } from "./agent-policy.js";
import type { AgentFailure, AgentRunInput, AgentRunResult } from "./agent-types.js";
import { TRAINING_RISK_CODE, TrainingRiskRefusal } from "./training-policy.js";

interface FailureContext {
  readonly name: string;
  readonly keyVariable: string | undefined;
  readonly t: Translate;
  readonly status: number;
  readonly errorCode: string | undefined;
}

type StatusFailure = (context: FailureContext) => AgentFailure;

const APPLY_INSTRUCTION = /\b(apply|approve)\b[^.!?]*\b(button|card)\b|\b(press|click|tap|hit|use)\b[^.!?]*\bapply\b/i;
const DROPPED_CONNECTION_CODES: ReadonlySet<string> = new Set(["ECONNRESET", "EPIPE", "UND_ERR_SOCKET", "UND_ERR_CLOSED"]);
const NO_CREDIT_CODES: ReadonlySet<string> = new Set(["credit_balance_exhausted", "insufficient_quota"]);
const USAGE_LIMIT_CODES: ReadonlySet<string> = new Set(["organization_usage_limit_exceeded", "organization_spend_limit_exceeded", "project_spend_limit_exceeded"]);
const NOT_HANDED_TO_FALLBACK: ReadonlySet<string> = new Set(["CANCELLED", "PROVIDER_TIMEOUT", TRAINING_RISK_CODE]);

const RESPONSE_ERROR = object({ status: optional(number()), detail: optional(fallback(string(), undefined)) });
const RESPONSE_ERROR_BODY = object({ error: object({ code: string() }) });

function authFailure({ name, status, keyVariable, t }: FailureContext): AgentFailure {
  const message = keyVariable ? t("failure.provider.authRejectedKey", { name, status, variable: keyVariable }) : t("failure.provider.authRejected", { name, status });
  return { code: "PROVIDER_AUTH", message };
}

function noBalanceFailure({ name, t }: FailureContext): AgentFailure {
  return { code: "PROVIDER_BILLING", message: t("failure.provider.noBalance", { name }) };
}

function rateLimitFailure({ name, errorCode, t }: FailureContext): AgentFailure {
  if (errorCode !== undefined && NO_CREDIT_CODES.has(errorCode)) return { code: "PROVIDER_BILLING", message: t("failure.provider.noCredits", { name }) };
  if (errorCode !== undefined && USAGE_LIMIT_CODES.has(errorCode)) return { code: "PROVIDER_BILLING", message: t("failure.provider.usageLimit", { name, limit: errorCode }) };
  return { code: "PROVIDER_RATE_LIMIT", message: t("failure.provider.rateLimited", { name }) };
}

const STATUS_FAILURES: ReadonlyMap<number, StatusFailure> = new Map<number, StatusFailure>([
  [401, authFailure],
  [403, authFailure],
  [402, noBalanceFailure],
  [429, rateLimitFailure],
]);

function statusFailure(context: FailureContext): AgentFailure | undefined {
  const known = STATUS_FAILURES.get(context.status);
  if (known) return known(context);
  return context.status >= 500 ? { code: "PROVIDER_UNAVAILABLE", message: context.t("failure.provider.serverError", { name: context.name, status: context.status }) } : undefined;
}

function isDroppedConnection(error: Error, causeCode: string | undefined): boolean {
  return (error.name === "TypeError" && error.message === "terminated") || (causeCode !== undefined && DROPPED_CONNECTION_CODES.has(causeCode));
}

function thrownFailure(error: Error | undefined, causeCode: string | undefined, named: { readonly name: string; readonly t: Translate }): AgentFailure {
  const { name, t } = named;
  if (error?.name === "AbortError") return { code: "PROVIDER_TIMEOUT", message: t("failure.provider.timeout", { name }) };
  if (error && isDroppedConnection(error, causeCode)) return { code: "PROVIDER_DISCONNECTED", message: t("failure.provider.disconnected", { name }) };
  return { code: "PROVIDER_ERROR", message: error?.message ? t("failure.provider.error", { name, detail: error.message.slice(0, MAX_PROVIDER_ERROR_CHARS) }) : t("failure.provider.requestFailed", { name }) };
}

function responseErrorCode(detail: string | undefined): string | undefined {
  if (detail === undefined) return undefined;
  const body = decodeJson(detail, RESPONSE_ERROR_BODY);
  return body.ok ? body.value.error.code : undefined;
}

/** Removes the sentences that tell the reader to press, click or approve an Apply button or card. */
export function withoutApplyInstructions(text: string): string {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [];
  return sentences.filter((sentence) => !APPLY_INSTRUCTION.test(sentence)).join("").trim();
}

type FailureBase = Pick<FailureContext, "name" | "keyVariable" | "t">;

function failureBase(provider: AgentRunInput["providerName"], t: Translate): FailureBase {
  return { name: provider?.displayName ?? t("failure.provider.defaultName"), keyVariable: provider?.keyVariable || undefined, t };
}

function failureFromResponse<Thrown>(error: Thrown, base: FailureBase): AgentFailure | undefined {
  const reported = decode(RESPONSE_ERROR, error);
  if (!reported.ok || reported.value.status === undefined) return undefined;
  return statusFailure({ ...base, status: reported.value.status, errorCode: responseErrorCode(reported.value.detail) });
}

/** The user-facing failure for anything a provider call threw: a training-risk refusal, an HTTP status, a timeout, a dropped stream or any other error, naming the provider and, for a rejected key, the variable that holds it, in the language of `t`. The thrown value is whatever the `catch` bound. */
export function providerFailure<Thrown>(error: Thrown, provider: AgentRunInput["providerName"], t: Translate = ENGLISH_FAILURE_TEXT): AgentFailure {
  if (error instanceof TrainingRiskRefusal) return { code: error.code, message: t("failure.trainingRisk", { label: error.label }) };
  const base = failureBase(provider, t);
  const fromStatus = failureFromResponse(error, base);
  if (fromStatus) return fromStatus;
  const caused = decode(errorCauseCode, error);
  return thrownFailure(error instanceof Error ? error : undefined, caused.ok ? caused.value : undefined, base);
}

/**
 * Whether a failed run is handed to the fallback model. Only a failed run is: `runAgent` withholds the cards of a failed turn, so there is nothing to apply.
 * A cancellation is a decision the user already made, a provider timeout is a clock condition and a training-risk refusal is a policy decision, so none is handed over; a run whose auto-apply already changed the project is not either, because a second model would apply the work again.
 */
export function shouldFallBack(result: AgentRunResult): boolean {
  if (result.outcome !== "failed" || result.mutated) return false;
  const code = result.failure?.code;
  return code === undefined || !NOT_HANDED_TO_FALLBACK.has(code);
}

/** Whether the provider can run the tool-calling agent loop. */
export function canRunAgent(provider: ChatProvider | undefined): provider is ToolCallingProvider {
  return supportsTools(provider);
}
