/** Turns the sidecar's chat answer into a scenario report, and merges the reports of a multi-turn scenario. */
import type { ChatResponse } from "./chat-wire.js";
import { sumUsageRecords } from "./ledger-usage.js";
import type { CutOff, ScenarioReport } from "./run-types.js";
import { stringMember } from "./wire-reads.js";

function cutOffKind(status: number, failureCode: string | undefined): CutOff | undefined {
  if (failureCode === "HARNESS_TIMEOUT") return "harness";
  if (failureCode === "PROVIDER_TIMEOUT") return "provider";
  return status === 0 ? "transport" : undefined;
}

/** Reads the report out of one chat answer. */
export function reportFromResponse(response: ChatResponse, durationMs: number | undefined): ScenarioReport {
  const { body, status } = response;
  const failureCode = body.failure ? stringMember(body.failure, "code") : undefined;
  const cutOff = cutOffKind(status, failureCode);
  return {
    status, outcome: body.outcome, steps: body.steps, stopReason: body.stopReason,
    provider: body.provider ? stringMember(body.provider, "displayName") : undefined, model: body.model,
    answer: body.answer ?? "", notes: body.notes ?? [], tools: body.tools ?? [], plans: body.plans ?? [],
    usage: body.usage, failure: body.failure, durationMs, ...(cutOff ? { cutOff } : {}),
  };
}

/** Whether the answer is one the harness gave up on rather than one the agent produced. */
export function wasCutOff(response: ChatResponse): boolean {
  const failureCode = response.body.failure ? stringMember(response.body.failure, "code") : undefined;
  return cutOffKind(response.status, failureCode) !== undefined;
}

/** One report for a scenario that took several turns: the last turn's wording over everyone's tools, plans and cost. */
export function mergedReport(reports: readonly ScenarioReport[]): ScenarioReport | undefined {
  const last = reports.at(-1);
  if (!last || reports.length === 1) return last;
  const cutOff = reports.find((report) => report.cutOff)?.cutOff;
  const durations = reports.map((report) => report.durationMs);
  const usage = reports.map((report) => report.usage).reduce<ScenarioReport["usage"]>((sum, next) => sumUsageRecords(sum, next), undefined);
  return {
    ...last,
    steps: reports.reduce((sum, report) => sum + (report.steps ?? 0), 0),
    plans: reports.flatMap((report) => report.plans), tools: reports.flatMap((report) => report.tools), notes: reports.flatMap((report) => report.notes),
    ...(usage ? { usage } : {}),
    ...(durations.every((value) => value !== undefined) ? { durationMs: durations.reduce<number>((sum, value) => sum + (value ?? 0), 0) } : {}),
    ...(cutOff ? { cutOff } : {}),
  };
}
