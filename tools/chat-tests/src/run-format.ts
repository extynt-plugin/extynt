/** Text rendering of a finished run: the verdict lines shared with `trace`, and the transcript `run` prints. */
import { elapsedSecondsText } from "./clock.js";
import type { LogLine, PlanStoreRow, ScenarioReport, ScenarioRun, ToolTrace } from "./run-types.js";
import { stringMember } from "./wire-reads.js";

/**
 * The last two lines of a run: what the plan store holds, and the verdict. Shared with the
 * trace command, because a full transcript without them hides a store-versus-card disagreement.
 */
export function formatVerdict(run: ScenarioRun): string {
  return refusalLines(run) + storeLine(run) + verdictLine(run);
}

function storeLine(run: ScenarioRun): string {
  if (!run.store) return "";
  const listed = run.store.map((row) => `${row.planId}(${row.status}${row.status === "draft" ? " — a draft, not applicable" : ""})`).join(", ");
  return `plan store after this turn: ${run.store.length ? listed : "nothing"}\n`;
}

function refusalLines(run: ScenarioRun): string {
  const refused = (run.report?.tools ?? []).filter((tool) => !tool.ok);
  if (refused.length === 0) return "";
  return `refused: ${refused.map((tool) => refusalLine(tool)).join(", ")}\n`;
}

function refusalLine(tool: ToolTrace): string {
  const many = /^(\d+) operations? cannot run as written/.exec(tool.message ?? "")?.[1];
  const one = /^One operation cannot run as written/.test(tool.message ?? "");
  const code = [tool.code ?? "?", many ? `${many} operations` : one ? "1 operation" : undefined].filter(Boolean).join(", ");
  return `${tool.name}(${code})`;
}

function verdictLine(run: ScenarioRun): string {
  if (run.failures.length === 0) return `RESULT: ok${deliveredStoreText(run)}`;
  const kind = run.report?.cutOff ? (run.report.cutOff === "harness" ? "CUT OFF (harness)" : "CUT OFF (provider)") : "FAIL";
  return `RESULT: ${kind}\n  - ${run.failures.join("\n  - ")}`;
}

function deliveredStoreText(run: ScenarioRun): string {
  const delivered = run.store ? run.store.filter((row) => row.status !== "draft").length : undefined;
  return delivered === undefined ? "" : ` (store: ${delivered} deliverable plan(s))`;
}

/** A human-readable transcript of one run, for the CLI. */
export function formatRun(run: ScenarioRun): string {
  const lines = runHeaderLines(run);
  if (run.skipped) { lines.push(`SKIPPED: ${run.skipped}`); return lines.join("\n"); }
  const report = run.report;
  if (!report) { lines.push(`NO REPORT (${run.failures.join("; ")})`); return lines.join("\n"); }
  if (report.cutOff) return lines.concat(cutOffLines(report)).join("\n");
  lines.push(runStatusLine(report));
  appendReportDetails(lines, report);
  if (run.store) lines.push(storeAfterTurnLine(run.store));
  appendPlans(lines, report);
  appendProposals(lines, run.logLines);
  lines.push(formatVerdict(run));
  return lines.join("\n");
}

function runHeaderLines(run: ScenarioRun): string[] {
  const lines: string[] = [`\n=== ${run.scenario.id}  [${run.scenario.asset}] ===`, `USER: ${run.scenario.message}`];
  for (const turn of run.scenario.history ?? []) lines.push(`  (history) ${turn.role}: ${turn.content}`);
  for (const [at, message] of (run.scenario.followUps ?? []).entries()) lines.push(`USER (turn ${at + 2}): ${message}`);
  for (const note of run.skippedChecks ?? []) lines.push(`  (${note})`);
  return lines;
}

function runStatusLine(report: ScenarioReport): string {
  return `HTTP ${report.status}  ${elapsedSecondsText(report.durationMs, 1)}  outcome=${report.outcome} steps=${report.steps} stopReason=${report.stopReason} ${report.provider ?? ""} ${report.model ?? ""}`.trim();
}

function storeAfterTurnLine(store: PlanStoreRow[]): string {
  const listed = store.map((row) => `${row.planId}(${row.status})`).join(", ");
  return `plan store after this turn: ${store.length ? listed : "nothing"}`;
}

function cutOffLines(report: ScenarioReport): string[] {
  const seconds = elapsedSecondsText(report.durationMs, 1);
  if (report.cutOff === "transport") return [`CUT OFF after ${seconds} — the request to the sidecar failed in transport — no expectation was checked and the store was not read.`];
  if (report.cutOff === "harness") return [`CUT OFF after ${seconds} by the harness ceiling — no expectation was checked and the store was not read.`];
  return [`CUT OFF after ${seconds} by the provider: ${(report.failure ? stringMember(report.failure, "message") : undefined) ?? "no reason given"} — no expectation was checked and the store was not read.`];
}

function appendReportDetails(lines: string[], report: ScenarioReport): void {
  if (report.usage) lines.push(`usage: ${JSON.stringify(report.usage)}`);
  if (report.failure) lines.push(`failure: ${JSON.stringify(report.failure)}`);
  lines.push(`tools: ${report.tools.map((tool) => `${tool.ok ? "" : "FAIL:"}${tool.name}`).join(", ") || "(none)"}`);
  for (const note of report.notes) lines.push(`note: ${note}`);
  lines.push(`ANSWER: ${report.answer}`);
}

function appendPlans(lines: string[], report: ScenarioReport): void {
  for (const plan of report.plans) {
    lines.push(`PLAN ${plan.planId} — ${plan.title}`);
    for (const operation of plan.operations) lines.push(`   - ${operation}`);
  }
}

function appendProposals(lines: string[], logLines: readonly LogLine[]): void {
  const proposals = logLines.filter((line) => stringMember(line, "event") === "agent.tool" && stringMember(line, "tool") === "ae_propose_plan");
  for (const proposal of proposals) lines.push(`  propose_plan args: ${String(proposal.args)}`);
}
