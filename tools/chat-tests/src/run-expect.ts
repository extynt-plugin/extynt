/** Checks a finished scenario run against what the scenario expects; every check names what failed. */
import { decode, map, object, string } from "@extynt/decode";
import type { Decoder } from "@extynt/decode";
import { compositionAsset } from "./assets.js";
import { elapsedSecondsText } from "./clock.js";
import { controlValueFailures } from "./control-values.js";
import { lenient, skippingInvalid } from "./lenient.js";
import type { PlanCard, PlanStoreRow, RunUnderCheck, ScenarioReport } from "./run-types.js";
import type { ScenarioExpectation } from "./scenarios.js";
import { stringMember } from "./wire-reads.js";
import type { WireValue } from "./wire-types.js";

/** The tools that author or queue operations, which is where a plan's targets show. */
export const MUTATING_TOOLS = ["ae_queue_add", "ae_queue_fix", "ae_queue_finish", "ae_propose_plan", "ae_plan_add", "ae_plan_complete"];

function toolArguments(run: RunUnderCheck, only?: readonly string[]): string[] {
  const texts: string[] = [];
  for (const line of run.logLines) {
    const args = stringMember(line, "args");
    const tool = stringMember(line, "tool");
    if (stringMember(line, "event") !== "agent.tool" || args === undefined) continue;
    if (!only || (tool !== undefined && only.includes(tool))) texts.push(args);
  }
  return texts;
}

/**
 * Everything the turn said about targeting, in one string: the propose_plan arguments from
 * the log, the card's operation lines, and the answer. The sidecar redacts and truncates
 * those arguments, so expectations name layers and common property paths, not deep detail.
 */
export function targetingHaystack(run: RunUnderCheck): string {
  const fromCards = (run.report?.plans ?? []).flatMap((plan) => plan.operations);
  return [...toolArguments(run), ...fromCards, run.report?.answer ?? ""].join("\n");
}

function mutationHaystack(run: RunUnderCheck): string {
  const fromCards = (run.report?.plans ?? []).flatMap((plan) => plan.operations);
  return [...toolArguments(run, MUTATING_TOOLS), ...(run.storedOperations ?? []), ...fromCards].join("\n");
}

const layerRow = object({ id: string(), name: string() });
const layerNames: Decoder<Array<{ id: string; name: string }>> = map(
  object({ result: lenient(object({ compositions: lenient(skippingInvalid(object({ layers: lenient(skippingInvalid(layerRow)) }))) })) }),
  (probe) => (probe.result?.compositions ?? []).flatMap((composition) => composition.layers ?? []),
);

function findLayerName(probe: WireValue, layerId: string): string | undefined {
  const decoded = decode(layerNames, probe);
  return decoded.ok ? decoded.value.find((layer) => layer.id === layerId)?.name : undefined;
}

function requiredNeedleFailures(haystack: string, needles: readonly string[] | undefined, message: (needle: string) => string): string[] {
  return (needles ?? []).filter((needle) => !haystack.includes(needle)).map(message);
}

function forbiddenNeedleFailures(haystack: string, needles: readonly string[] | undefined): string[] {
  return (needles ?? []).filter((needle) => haystack.includes(needle)).map((needle) => `an authored mutation referenced forbidden target ${needle}`);
}

function layerTargetFailures(run: RunUnderCheck, layerId: string | undefined, mutations: string): string[] {
  if (!layerId) return [];
  const name = findLayerName(compositionAsset(run.scenario.asset).probe, layerId);
  if (mutations.includes(layerId) || (name && mutations.includes(name))) return [];
  return [`nothing targeted ${layerId}${name ? ` ("${name}")` : ""}`];
}

function targetFailures(run: RunUnderCheck, expectation: ScenarioExpectation, haystack: string): string[] {
  const mutations = mutationHaystack(run);
  const anyOperationFailure = expectation.anyOperationMatches?.length && !expectation.anyOperationMatches.some((needle) => haystack.includes(needle)) ? [`no operation mentioned any of ${JSON.stringify(expectation.anyOperationMatches)}`] : [];
  const compositionFailure = expectation.targetsComposition && !mutations.includes(expectation.targetsComposition) ? [`nothing targeted composition ${expectation.targetsComposition}`] : [];
  return [
    ...anyOperationFailure,
    ...layerTargetFailures(run, expectation.targetsLayer, mutations),
    ...compositionFailure,
    ...requiredNeedleFailures(mutations, expectation.requiredOperationTypes, (operation) => `no authored operation used ${operation}`),
    ...requiredNeedleFailures(mutations, expectation.requiredPropertyPaths, (path) => `no authored operation used property path ${path}`),
    ...controlValueFailures(run.storedOperations, expectation.requiredControlValues),
    ...forbiddenNeedleFailures(mutations, expectation.forbiddenTargets),
  ];
}

function mentionFailures(report: ScenarioReport, needles: readonly string[] | undefined): string[] {
  return (needles ?? []).filter((needle) => !report.answer.toLowerCase().includes(needle.toLowerCase())).map((needle) => `the answer never mentioned ${JSON.stringify(needle)}`);
}

function toolFailures(report: ScenarioReport, onlyTools: readonly string[] | undefined): string[] {
  if (!onlyTools?.length) return [];
  const unexpected = report.tools.map((tool) => tool.name).filter((name) => !onlyTools.includes(name));
  return unexpected.length ? [`unexpected tools: ${[...new Set(unexpected)].join(", ")}`] : [];
}

function toolErrorFailures(report: ScenarioReport, enabled: boolean | undefined): string[] {
  const failedTools = enabled ? report.tools.filter((tool) => !tool.ok) : [];
  return failedTools.length ? [`tool errors: ${failedTools.map((tool) => `${tool.name}(${tool.code ?? "?"})`).join(", ")}`] : [];
}

function answerFailures(report: ScenarioReport, expectation: ScenarioExpectation): string[] {
  return [
    ...mentionFailures(report, expectation.answerMentions),
    ...toolFailures(report, expectation.onlyTools),
    ...toolErrorFailures(report, expectation.noToolErrors),
  ];
}

function settlementFailures(run: RunUnderCheck, expectation: ScenarioExpectation): string[] {
  if (expectation.execution !== "success" || run.report?.outcome !== "failed") return [];
  const code = run.report.failure ? stringMember(run.report.failure, "code") : undefined;
  return [`the host applied every operation but the turn failed (${code ?? "no code"})`];
}

function executionFailures(run: RunUnderCheck, expectation: ScenarioExpectation): string[] {
  if (!run.fakeHostBatches) return [];
  const refused = run.fakeHostBatches.flatMap((batch) => batch.refused);
  if (expectation.execution === "refused") return refused.length ? [] : ["fake-host execution was expected to refuse but every dispatched operation applied"];
  const incomplete = run.fakeHostBatches.filter((batch) => batch.refused.length > 0 || batch.applied !== batch.operations);
  if (incomplete.length) return [`fake-host execution did not succeed for ${incomplete.map((batch) => batch.planId).join(", ")} (${refused.map((entry) => entry.code).join(", ") || "incomplete apply"})`];
  return settlementFailures(run, expectation);
}

function cutoffFailure(report: ScenarioReport): string[] | undefined {
  if (!report.cutOff) return undefined;
  const seconds = elapsedSecondsText(report.durationMs, 0);
  const reason = (report.failure ? stringMember(report.failure, "message") : undefined) ?? "no reason given";
  if (report.cutOff === "harness") return [`the harness cut the turn off after ${seconds} with no answer, so this run says nothing about whether the agent could do it. Raise --timeout for a prompt this size.`];
  if (report.cutOff === "transport") return [`the request to the sidecar failed after ${seconds} (${reason}), so this run says nothing about whether the agent could do it. This is a harness transport failure, not the model and not the ceiling.`];
  return [`the provider stopped answering after ${seconds} (${reason}), so this run says nothing about whether the agent could do it.`];
}

function outcomeFailures(report: ScenarioReport, expectation: ScenarioExpectation): string[] {
  const failures: string[] = [];
  if (expectation.outcome && report.outcome !== expectation.outcome) failures.push(`outcome was ${report.outcome ?? "(none)"}, expected ${expectation.outcome}`);
  if (report.status !== 200) failures.push(`HTTP ${report.status}`);
  return failures;
}

function planCountFailures(planCount: number, expectation: ScenarioExpectation): string[] {
  const failures: string[] = [];
  const min = expectation.plans?.min, max = expectation.plans?.max;
  if (min !== undefined && planCount < min) failures.push(`${planCount} plan(s), expected at least ${min}`);
  if (max !== undefined && planCount > max) failures.push(`${planCount} plan(s), expected at most ${max}`);
  return failures;
}

function storeProjectionFailures(store: readonly PlanStoreRow[], plans: readonly PlanCard[]): string[] {
  const listed = store.filter((row) => row.status !== "draft").map((row) => row.planId).sort();
  const carded = plans.map((plan) => plan.planId).sort();
  if (listed.join(",") === carded.join(",")) return [];
  return [`the plan store holds ${listed.length ? listed.join(", ") : "nothing"} while the turn reported ${carded.length ? carded.join(", ") : "nothing"} — the report disagrees with the store`];
}

function reportShapeFailures(run: RunUnderCheck, report: ScenarioReport, expectation: ScenarioExpectation): string[] {
  const failures = [...outcomeFailures(report, expectation), ...planCountFailures(report.plans.length, expectation)];
  if (run.store && report.outcome !== "failed") failures.push(...storeProjectionFailures(run.store, report.plans));
  return failures;
}

/** Every way a finished run falls short of what its scenario expects. */
export function checkExpectations(run: RunUnderCheck, expectation: ScenarioExpectation): string[] {
  const report = run.report;
  if (!report) return ["the turn produced no report"];
  const cutOff = cutoffFailure(report);
  if (cutOff) return cutOff;
  return [
    ...reportShapeFailures(run, report, expectation),
    ...targetFailures(run, expectation, targetingHaystack(run)),
    ...answerFailures(report, expectation),
    ...executionFailures(run, expectation),
  ];
}
