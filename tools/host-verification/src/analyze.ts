/** Turns a live host report into per-case verdicts and effect audits. */
import { createHash } from "node:crypto";
import { PLAN_TYPE_CONTRACTS, executablePlanTypes, type LedgerEffectResult, type LedgerHostEntry, type LedgerPlanTypeResult } from "@extynt/capability-catalogue";
import { EFFECT_SWEEP_PREFIX, allCases, type CaseWithMeta } from "./cases/index.js";
import type { RerunExpectation } from "./cases/helpers.js";
import { applySteps, evaluateCheck, fmt } from "./checks.js";
import { planningIssue } from "./generate.js";
import { decode, array, nullable, object, optional, string } from "@extynt/decode";
import type { JsonObject } from "./json.js";
import { planCase, type PlannedStep } from "./plan.js";
import type { CaseRunRecord, CompRef, DumpSections, HostStepRecord, LayerRef, LiveReport, ReadbackView } from "./types.js";

export { evaluateCheck } from "./checks.js";

export type VerdictPhase = "planner" | "fixture" | "runner" | "host" | "checks" | "receipt" | "rerun" | "undo";
export interface CaseVerdict {
  id: string; domain: string; covers: string[]; verifies: string[];
  status: "pass" | "fail" | "skipped" | "not-run" | "broken-case";
  failures: Array<{ phase: VerdictPhase; detail: string }>;
  rerun?: { expected: RerunExpectation; observed: string; ok: boolean };
  undo?: { ok: boolean; residue: string[] };
  notes?: string;
}
export interface EffectAudit {
  installed: number | null;
  catalogued: number;
  verified: string[];
  drift: Array<{ matchName: string; drift: string }>;
  failed: Array<{ matchName: string; detail: string }>;
  missing: string[];
  uncatalogued: string[];
  skipped: string[];
}
export interface AnalysisResult {
  hostKey: string | null; hostLabel: string; kit: LiveReport["kit"]; reportDigest: string;
  verdicts: CaseVerdict[];
  planTypes: Record<string, LedgerPlanTypeResult | { status: "untested"; cases: string[] }>;
  effects: EffectAudit;
  counts: Record<CaseVerdict["status"], number>;
  apiFacts: JsonObject;
  runnerErrors: string[];
  provenanceProblems: string[];
}

type Fail = (phase: VerdictPhase, detail: string) => void;
type HostOutcome = Extract<NonNullable<CaseWithMeta["outcome"]>, { kind: "host" }>;
type PlanTypeEntry = LedgerPlanTypeResult | { status: "untested"; cases: string[] };

const EMPTY: DumpSections = { items: {}, comps: {}, layers: {}, props: {}, files: {} };
const SECTIONS = ["items", "comps", "layers", "props", "files"] as const;

function copySections(base: DumpSections | null): DumpSections {
  const source = base ?? EMPTY;
  return { items: { ...source.items }, comps: { ...source.comps }, layers: { ...source.layers }, props: { ...source.props }, files: { ...source.files } };
}
function setOrDelete<T>(target: Record<string, T>, key: string, entry: T | null): void {
  if (entry === null) delete target[key];
  else target[key] = entry;
}
function applyDelta(out: DumpSections, delta: DumpSections | null): void {
  if (!delta) return;
  for (const [key, entry] of Object.entries(delta.items)) setOrDelete(out.items, key, entry);
  for (const [key, entry] of Object.entries(delta.comps)) setOrDelete(out.comps, key, entry);
  for (const [key, entry] of Object.entries(delta.layers)) setOrDelete(out.layers, key, entry);
  for (const [key, entry] of Object.entries(delta.props)) setOrDelete(out.props, key, entry);
  for (const [key, entry] of Object.entries(delta.files)) setOrDelete(out.files, key, entry);
}
function merge(base: DumpSections | null, delta: DumpSections | null): DumpSections {
  const out = copySections(base);
  applyDelta(out, delta);
  return out;
}
function deltaKeys(delta: DumpSections | null): string[] { return delta ? SECTIONS.flatMap((section) => Object.keys(delta[section] ?? {}).map((key) => `${section}:${key}`)) : []; }

function diffSections(left: DumpSections, right: DumpSections): string[] {
  const out: string[] = [];
  for (const section of ["items", "comps", "layers", "props"] as const) {
    const a = left[section], b = right[section];
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) out.push(`${section}:${key}`);
  }
  return out;
}

export function makeView(sections: DumpSections, record: Pick<CaseRunRecord, "tokens" | "caseCompId">): ReadbackView {
  const compId = (ref?: CompRef): string | null => { if (!ref || ref === "case") return record.caseCompId; const found = Object.entries(sections.comps).find(([, comp]) => comp?.name === ref.name); return found ? found[0] : null; };
  const layerId = (ref: LayerRef, comp?: CompRef): string | null => {
    if (typeof ref === "string") return record.tokens[`@layer:${ref}`] ?? null;
    const scope = comp ? compId(comp) : null;
    const matches = Object.entries(sections.layers)
      .filter(([, attrs]) => attrs?.name === ref.name && (!scope || attrs.comp === scope))
      .sort((a, b) => (a[1]?.comp === record.caseCompId ? 0 : 1) - (b[1]?.comp === record.caseCompId ? 0 : 1));
    return matches[0]?.[0] ?? null;
  };
  return {
    sections, tokens: record.tokens, caseCompId: record.caseCompId, layerId,
    prop: (ref, path, comp) => { const id = layerId(ref, comp); return id ? sections.props[`${id}|${path}`] ?? null : null; },
    layer: (ref, comp) => { const id = layerId(ref, comp); return id ? sections.layers[id] ?? null : null; },
    comp: (ref) => { const id = compId(ref); return id ? sections.comps[id] ?? null : null; },
  };
}

function rerunExpectation(liveCase: CaseWithMeta, lastStepTypes: string[]): RerunExpectation {
  if (liveCase.rerunExpect) return liveCase.rerunExpect;
  const behaviours = lastStepTypes.map((type) => PLAN_TYPE_CONTRACTS[type]?.rerun ?? "set");
  if (behaviours.includes("external")) return "host-ok";
  if (behaviours.includes("destructive")) return "rejected";
  if (behaviours.includes("creates")) return "grows";
  if (behaviours.includes("rejects-rerun")) return "rejected";
  return "same";
}

/**
 * Files the case declares (an exported PNG cannot be un-written) are expected after undo; any other difference still counts. Lazy "ADBE Vector
 * Materials Group" materialisation is bookkeeping, not residue; overshoot only matters when something was left behind.
 */
export function judgeUndo(record: Pick<CaseRunRecord, "afterUndo" | "undo">, expectedFiles: string[] = []): { verdict: { ok: boolean; residue: string[] }; failures: string[] } {
  const undo = record.undo ?? { attempted: 0, errors: [] };
  const residue = deltaKeys(record.afterUndo).filter((key) => !(key.startsWith("props:") && key.endsWith("/ADBE Vector Materials Group")) && !(key.startsWith("files:") && expectedFiles.some((file) => key.endsWith(file.split(/[\\/]/).pop() ?? file))));
  const ok = residue.length === 0 && undo.errors.length === 0, failures: string[] = [];
  if (undo.overshot && !ok) failures.push(`undoing every apply took the fixture with it: After Effects needed more undo steps than this plan opened`);
  if (!ok) failures.push(`undo left ${residue.length} difference(s)${undo.errors.length ? ` and errors ${undo.errors.join("; ")}` : ""}: ${residue.slice(0, 6).join(", ")}`);
  return { verdict: { ok, residue: residue.slice(0, 10) }, failures };
}

const plannedOutcome = (liveCase: CaseWithMeta): NonNullable<CaseWithMeta["outcome"]> => liveCase.outcome ?? { kind: "applied" };

function baseVerdict(liveCase: CaseWithMeta): CaseVerdict {
  return { id: liveCase.id, domain: liveCase.domain, covers: liveCase.covers, verifies: liveCase.verifies ?? ((liveCase.outcome?.kind ?? "applied") === "applied" ? liveCase.covers : []), status: "pass", failures: [], ...(liveCase.notes ? { notes: liveCase.notes } : {}) };
}

function halted(verdict: CaseVerdict, status: CaseVerdict["status"], phase: VerdictPhase, detail: string): CaseVerdict {
  return { ...verdict, status, failures: [{ phase, detail }] };
}

function withoutApply(verdict: CaseVerdict, record: CaseRunRecord): CaseVerdict | undefined {
  if (record.status === "host-crashed") return halted(verdict, "fail", "host", record.error ?? "After Effects crashed during this case");
  if (record.status === "runner-error") return halted(verdict, "not-run", "runner", record.error ?? "runner error");
  return undefined;
}

function haltedVerdict(verdict: CaseVerdict, record: CaseRunRecord): CaseVerdict | undefined {
  if (record.status === "skipped") return halted(verdict, "skipped", "runner", record.skipReason ?? "skipped");
  if (record.status === "fixture-failed") return halted(verdict, "not-run", "fixture", record.error ?? "fixture failed");
  return record.afterApply ? undefined : withoutApply(verdict, record);
}

function annotateStoppedRun(verdict: CaseVerdict, record: CaseRunRecord, fail: Fail): void {
  if (record.status === "host-crashed" && record.afterApply) fail("host", record.error ?? "After Effects crashed during this case");
  if (record.status === "pending-undo") verdict.notes = `${verdict.notes ? verdict.notes + " " : ""}After Effects stopped before undo was checked for this case.`;
}

interface RefusalResponse { ok?: boolean; error?: { code?: string; message?: string }; mayHaveMutated?: boolean }
const refusalResponse = (step: HostStepRecord | undefined): RefusalResponse | null | undefined => step?.response;
const responseCode = (response: RefusalResponse | null | undefined): string | undefined => response?.error?.code;

function refusalDetail(response: RefusalResponse | null | undefined, last: HostStepRecord): string {
  const code = responseCode(response) ?? "invalid response";
  const message = response?.error?.message ?? last.raw ?? "";
  return `${code} (${message})`;
}

function judgeRefusalReceipt(fail: Fail, outcome: HostOutcome, changed: string[], response: RefusalResponse | null | undefined): void {
  if (changed.length && response?.mayHaveMutated !== true) fail("receipt", `the host reported no mutation but the project changed: ${changed.slice(0, 6).join(", ")}`);
  if (!outcome.mayMutate && changed.length) fail("host", `refusal mutated the project: ${changed.slice(0, 6).join(", ")}`);
}

function judgeRefusal(fail: Fail, outcome: HostOutcome, applies: HostStepRecord[], record: CaseRunRecord): void {
  const last = applies[applies.length - 1], response = refusalResponse(last);
  if (!last) fail("host", "no host result");
  else if (last.ok) fail("host", `host accepted a command it must refuse (${outcome.code})`);
  else if (responseCode(response) !== outcome.code) fail("host", `host refused with ${refusalDetail(response, last)}, expected ${outcome.code}`);
  judgeRefusalReceipt(fail, outcome, deltaKeys(record.afterApply), response);
}

function judgeAppliedSteps(fail: Fail, liveCase: CaseWithMeta, applies: HostStepRecord[]): void {
  applies.forEach((step, index) => { if (!step.ok) fail("host", `step ${index} refused: ${fmt(step.response?.error ?? step.raw)}`); });
  if (applies.length < liveCase.steps.length) fail("host", `only ${applies.length} of ${liveCase.steps.length} step(s) ran`);
}

function observedRerun(rerun: HostStepRecord, changes: string[], grew: boolean): string {
  if (!rerun.ok) return changes.length ? "rejected-after-mutating" : "rejected";
  if (changes.length === 0) return "same";
  return grew ? "grows" : "changed";
}

function grewAfterRerun(before: DumpSections, after: DumpSections): boolean {
  const size = (state: DumpSections) =>
    Object.keys(state.props).length + Object.keys(state.layers).length + Object.keys(state.items).length + Object.keys(state.comps).length;
  return size(after) > size(before);
}

const shouldJudgeRerun = (liveCase: CaseWithMeta, verdict: CaseVerdict): boolean => (liveCase.outcome?.kind ?? "applied") === "applied" && liveCase.rerun !== false && verdict.failures.length === 0;

interface RerunContext {
  verdict: CaseVerdict;
  fail: Fail;
  liveCase: CaseWithMeta;
  record: CaseRunRecord;
  planned: PlannedStep[];
  baseline: DumpSections;
  after: DumpSections;
}

function rerunPlan(liveCase: CaseWithMeta, planned: PlannedStep[]): RerunExpectation {
  const lastTypes = planned[planned.length - 1]?.operationTypes ?? [];
  return rerunExpectation(liveCase, lastTypes);
}

const rerunVerdict = (expected: RerunExpectation, observed: string, changes: string[], ok: boolean): NonNullable<CaseVerdict["rerun"]> =>
  ({ expected, observed: changes.length && observed !== "same" ? `${observed} (${changes.slice(0, 4).join(", ")})` : observed, ok });

function judgeRerunPhase(context: RerunContext): void {
  const { verdict, fail, liveCase, record, planned, baseline, after } = context;
  if (!shouldJudgeRerun(liveCase, verdict)) return;
  const expected = rerunPlan(liveCase, planned);
  const rerun = record.host.find((step) => step.phase === "rerun");
  if (!rerun || !record.afterRerun) { verdict.rerun = { expected, observed: "not run", ok: false }; return; }
  const rerunState = merge(baseline, record.afterRerun), changes = diffSections(after, rerunState);
  const observed = observedRerun(rerun, changes, grewAfterRerun(after, rerunState));
  const ok = expected === "host-ok" ? rerun.ok : expected === "same-or-rejected" ? observed === "same" || observed === "rejected" : observed === expected;
  verdict.rerun = rerunVerdict(expected, observed, changes, ok);
  if (!ok) fail("rerun", `expected ${expected} on rerun, observed ${verdict.rerun.observed}`);
}

function judgeUndoPhase(verdict: CaseVerdict, fail: Fail, liveCase: CaseWithMeta, record: CaseRunRecord): void {
  if (liveCase.undo === false || !record.undo) return;
  const { verdict: undone, failures } = judgeUndo(record, liveCase.files ?? []);
  verdict.undo = undone;
  for (const detail of failures) fail("undo", detail);
}

interface RunJudgement { verdict: CaseVerdict; fail: Fail; liveCase: CaseWithMeta; record: CaseRunRecord; planned: PlannedStep[] }

function judgeRun({ verdict, fail, liveCase, record, planned }: RunJudgement): CaseVerdict {
  const baseline = record.baseline ?? EMPTY, after = merge(baseline, record.afterApply), applies = applySteps(record.host);
  const view = makeView(after, record);
  const outcome = plannedOutcome(liveCase);
  if (outcome.kind === "host") judgeRefusal(fail, outcome, applies, record);
  else judgeAppliedSteps(fail, liveCase, applies);
  for (const check of liveCase.expect) { const problem = evaluateCheck(check, view, record.host); if (problem) fail("checks", problem); }
  judgeRerunPhase({ verdict, fail, liveCase, record, planned, baseline, after });
  judgeUndoPhase(verdict, fail, liveCase, record);
  return verdict;
}

function judgeCase(liveCase: CaseWithMeta, record: CaseRunRecord | undefined): CaseVerdict {
  const verdict = baseVerdict(liveCase);
  const fail: Fail = (phase, detail) => { verdict.failures.push({ phase, detail }); verdict.status = "fail"; };
  const planned = planCase(liveCase), issue = planningIssue(liveCase, planned);
  const outcome = plannedOutcome(liveCase);
  if (outcome.kind === "planner") { if (issue) fail("planner", issue); return verdict; }
  if (issue) return halted(verdict, "broken-case", "planner", issue);
  if (outcome.kind === "dialog") return verdict;
  if (!record) return halted(verdict, "not-run", "runner", "case is not in this report");
  const stopped = haltedVerdict(verdict, record);
  if (stopped) return stopped;
  annotateStoppedRun(verdict, record, fail);
  return judgeRun({ verdict, fail, liveCase, record, planned });
}

function verdictForCase(verdicts: CaseVerdict[], id: string): CaseVerdict {
  const found = verdicts.find((verdict) => verdict.id === id);
  if (!found) throw new Error(`no verdict for case ${id}`);
  return found;
}

function countVerdicts(verdicts: CaseVerdict[]): AnalysisResult["counts"] {
  const counts: AnalysisResult["counts"] = { pass: 0, fail: 0, skipped: 0, "not-run": 0, "broken-case": 0 };
  for (const verdict of verdicts) counts[verdict.status] += 1;
  return counts;
}

const failureNotes = (verdicts: CaseVerdict[], failed: string[]): string => verdicts.filter((verdict) => failed.includes(verdict.id)).flatMap((verdict) => verdict.failures.map((failure) => `${verdict.id}: ${failure.phase}: ${failure.detail}`)).slice(0, 6).join(" | ");

function planTypeEntry(type: string, verdicts: CaseVerdict[]): PlanTypeEntry {
  const related = verdicts.filter((verdict) => verdict.verifies.includes(type));
  const passed = related.filter((verdict) => verdict.status === "pass").map((verdict) => verdict.id), failed = related.filter((verdict) => verdict.status === "fail").map((verdict) => verdict.id);
  const contract = PLAN_TYPE_CONTRACTS[type];
  if (contract?.readBack === "unobservable") return { status: "unverifiable", cases: passed, ...(failed.length ? { failedCases: failed } : {}), ...(contract.notes === undefined ? {} : { notes: contract.notes }) };
  if (failed.length) return { status: "failed", cases: passed, failedCases: failed, notes: failureNotes(verdicts, failed) };
  if (passed.length) return { status: "verified", cases: passed };
  return { status: "untested", cases: [] };
}

function buildPlanTypeAudit(verdicts: CaseVerdict[]): AnalysisResult["planTypes"] {
  const planTypes: AnalysisResult["planTypes"] = {};
  for (const type of executablePlanTypes()) planTypes[type] = planTypeEntry(type, verdicts);
  return planTypes;
}

const installedProbe = object({ installedEffects: optional(nullable(array(object({ matchName: optional(nullable(string())) })))) });
const installedEffects = (report: LiveReport): ReadonlyArray<{ matchName?: string | null | undefined }> | null | undefined => {
  const probe = decode(installedProbe, report.apiProbes);
  return probe.ok ? probe.value.installedEffects : undefined;
};

const driftText = (failures: CaseVerdict["failures"]): string => failures.map((failure) => failure.detail).join(" | ");
const failureText = (failures: CaseVerdict["failures"], separator = " | "): string => failures.map((failure) => `${failure.phase}: ${failure.detail}`).join(separator);
const isDrift = (verdict: CaseVerdict, matchName: string): boolean => verdict.failures.every((failure) => failure.phase === "checks" && !failure.detail.includes("× " + matchName));

const plannerOnly = (liveCase: CaseWithMeta): boolean => liveCase.outcome?.kind === "planner" || liveCase.outcome?.kind === "dialog";

function sweepOutcome(verdict: CaseVerdict, liveCase: CaseWithMeta): "verified" | "skipped" | "judge" {
  if (verdict.status === "pass" && !plannerOnly(liveCase)) return "verified";
  if (verdict.status === "skipped" || verdict.status === "not-run" || plannerOnly(liveCase)) return "skipped";
  return "judge";
}

function classifySweepCase(effects: EffectAudit, liveCase: CaseWithMeta, verdict: CaseVerdict, installedSet: ReadonlySet<string> | null): void {
  const matchName = liveCase.id.slice(EFFECT_SWEEP_PREFIX.length);
  if (installedSet && !installedSet.has(matchName)) { effects.missing.push(matchName); return; }
  const outcome = sweepOutcome(verdict, liveCase);
  if (outcome === "verified") { effects.verified.push(matchName); return; }
  if (outcome === "skipped") { effects.skipped.push(matchName); return; }
  if (isDrift(verdict, matchName)) effects.drift.push({ matchName, drift: driftText(verdict.failures) });
  else effects.failed.push({ matchName, detail: failureText(verdict.failures) });
}

function buildEffectAudit(report: LiveReport, cases: CaseWithMeta[], verdicts: CaseVerdict[]): EffectAudit {
  const installed = installedEffects(report);
  const installedSet = installed ? new Set(installed.map((effect) => String(effect.matchName))) : null;
  const sweep = cases.filter((liveCase) => liveCase.id.startsWith(EFFECT_SWEEP_PREFIX));
  const effects: EffectAudit = {
    installed: installed ? installed.length : null,
    catalogued: sweep.length,
    verified: [],
    drift: [],
    failed: [],
    missing: [],
    uncatalogued: [],
    skipped: [],
  };
  for (const liveCase of sweep) classifySweepCase(effects, liveCase, verdictForCase(verdicts, liveCase.id), installedSet);
  if (installedSet) {
    const known = new Set(sweep.map((liveCase) => liveCase.id.slice(EFFECT_SWEEP_PREFIX.length)));
    effects.uncatalogued = [...installedSet].filter((matchName) => !known.has(matchName)).sort();
  }
  return effects;
}

function hostLabel(runtime: LiveReport["runtime"]): string {
  if (!runtime) return "unknown host";
  return `After Effects ${String(runtime.appVersion).replace(/x\d+$/, "")}${runtime.buildNumber ? ` (build ${runtime.buildNumber})` : ""} ${runtime.platform}/${runtime.architecture}`;
}

const reportDigest = (report: LiveReport): string => createHash("sha256").update(JSON.stringify(report.cases.map((record) => [record.id, record.status, record.host.map((step) => step.ok)]))).digest("hex");

function notInstalledVerdict(verdict: CaseVerdict, installedSet: ReadonlySet<string> | null): CaseVerdict {
  if (!installedSet || !verdict.id.startsWith(EFFECT_SWEEP_PREFIX) || installedSet.has(verdict.id.slice(EFFECT_SWEEP_PREFIX.length)) || verdict.status === "pass") return verdict;
  return halted(verdict, "skipped", "runner", "effect is catalogued but not installed on this host");
}

export function analyzeReport(report: LiveReport, cases: CaseWithMeta[] = allCases()): AnalysisResult {
  const records = new Map(report.cases.map((record) => [record.id, record]));
  const installed = installedEffects(report), installedSet = installed ? new Set(installed.map((effect) => String(effect.matchName))) : null;
  const verdicts = cases.map((liveCase) => notInstalledVerdict(judgeCase(liveCase, records.get(liveCase.id)), installedSet));
  return {
    hostKey: report.hostKey, hostLabel: hostLabel(report.runtime), kit: report.kit, reportDigest: reportDigest(report),
    verdicts, planTypes: buildPlanTypeAudit(verdicts), effects: buildEffectAudit(report, cases, verdicts), counts: countVerdicts(verdicts),
    apiFacts: {
      projectSettings: report.apiProbes.projectSettings ?? null,
      compGuidesReadable: report.apiProbes.compGuidesReadable ?? null,
      globals: report.apiProbes.globals ?? null,
    },
    runnerErrors: report.runnerErrors,
    provenanceProblems: report.provenanceProblems ?? [],
  };
}

function ledgerPlanTypes(planTypes: AnalysisResult["planTypes"]): Record<string, LedgerPlanTypeResult> {
  const out: Record<string, LedgerPlanTypeResult> = {};
  for (const [type, entry] of Object.entries(planTypes)) if (entry.status !== "untested") out[type] = entry;
  return out;
}

function ledgerEffects(audit: EffectAudit): Record<string, LedgerEffectResult> {
  const effects: Record<string, LedgerEffectResult> = {};
  for (const matchName of audit.verified) effects[matchName] = { status: "verified" };
  for (const entry of audit.drift) effects[entry.matchName] = { status: "drift", detail: entry.drift.slice(0, 400) };
  for (const entry of audit.failed) effects[entry.matchName] = { status: "failed", detail: entry.detail.slice(0, 400) };
  for (const matchName of audit.missing) effects[matchName] = { status: "missing" };
  for (const matchName of Object.keys(effects)) if (!matchName.startsWith("ADBE ")) delete effects[matchName];
  return effects;
}

/** The committed ledger entry one analyzed run produces. */
export function ledgerEntryOf(result: AnalysisResult, runAt: string): LedgerHostEntry {
  if (!result.hostKey) throw new Error("The report has no host key; the runner could not read the After Effects runtime.");
  if (result.provenanceProblems.length)
    throw new Error(`The run mixes hosts or packs and cannot become ledger evidence: ${result.provenanceProblems.join("; ")}`);
  const planTypes = ledgerPlanTypes(result.planTypes),
    effects = ledgerEffects(result.effects);
  return {
    hostKey: result.hostKey,
    hostLabel: result.hostLabel,
    runAt,
    reportDigest: result.reportDigest,
    kit: { extyntVersion: result.kit.extyntVersion, packDigest: result.kit.packDigest },
    planTypes,
    ...(Object.keys(effects).length ? { effects } : {}),
  };
}

function summaryHeader(result: AnalysisResult): string[] {
  return [`# Live verification — ${result.hostLabel}`, "", `Host key: \`${result.hostKey ?? "unknown"}\` · kit ${result.kit.extyntVersion} · pack ${result.kit.packDigest.slice(0, 12)}`, "", `Cases: ${result.counts.pass} pass, ${result.counts.fail} fail, ${result.counts.skipped} skipped, ${result.counts["not-run"]} not run, ${result.counts["broken-case"]} broken case(s).`, ""];
}

function planTypeTable(result: AnalysisResult): string[] {
  const lines = ["## Plan types", "", "| Plan type | Status | Passing cases | Failing cases |", "| --- | --- | --- | --- |"];
  for (const [type, entry] of Object.entries(result.planTypes).sort()) lines.push(`| \`${type}\` | ${entry.status} | ${entry.cases.length} | ${"failedCases" in entry && entry.failedCases ? entry.failedCases.join(", ") : ""} |`);
  return lines;
}

const failedVerdicts = (result: AnalysisResult): CaseVerdict[] => result.verdicts.filter((entry) => entry.status === "fail" || entry.status === "broken-case");

function effectReport(result: AnalysisResult): string[] {
  const lines = ["", "## Effects", "", `Installed: ${result.effects.installed ?? "unknown"} · catalogued: ${result.effects.catalogued} · verified: ${result.effects.verified.length} · drift: ${result.effects.drift.length} · failed: ${result.effects.failed.length} · missing: ${result.effects.missing.length} · uncatalogued: ${result.effects.uncatalogued.length} · skipped: ${result.effects.skipped.length}`, ""];
  if (result.effects.missing.length) lines.push(`Missing (catalogued, not installed): ${result.effects.missing.join(", ")}`, "");
  if (result.effects.uncatalogued.length) lines.push(`Uncatalogued (installed, unknown to the catalogue): ${result.effects.uncatalogued.join(", ")}`, "");
  for (const entry of result.effects.drift) lines.push(`- drift **${entry.matchName}**: ${entry.drift}`);
  for (const entry of result.effects.failed) lines.push(`- failed **${entry.matchName}**: ${entry.detail}`);
  return lines;
}

export function renderSummary(result: AnalysisResult): string {
  const lines = summaryHeader(result);
  if (result.runnerErrors.length) lines.push("## Runner errors", "", ...result.runnerErrors.map((error) => `- ${error}`), "");
  lines.push(...planTypeTable(result));
  lines.push("", "## Failures", "");
  for (const verdict of failedVerdicts(result)) lines.push(`- **${verdict.id}** (${verdict.status}): ${failureText(verdict.failures, "; ")}`);
  lines.push(...effectReport(result));
  return `${lines.join("\n")}\n`;
}
