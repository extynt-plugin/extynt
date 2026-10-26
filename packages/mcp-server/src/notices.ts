// The classified notices a plan carries, from per-operation verdicts, undoability, plan size, effect units and user-assisted effects, worst first.
import type { HostCapabilityProfile } from "@extynt/capability-catalogue";
import { planTypeUndoability, userAssistedEffect, type OperationVerificationReport } from "@extynt/capability-catalogue";
import type { ActionPlanV2Operation } from "@extynt/action-plan";
import { ownedRemovalIndexes } from "./own-work.js";
import { booleanAt, jsonFieldsOf, stringAt } from "./json.js";
import type { Translate } from "@extynt/ui-text";
import type { PlanVerificationSummary } from "./contracts.js";
import { ENGLISH_TEXT } from "./plan-text.js";

type Undoability = "undo-group" | "host-dependent" | "not-undoable";
function undoabilityOf(planType: string): Undoability {
  return planTypeUndoability(planType);
}

const SHIPPED_INVERSE: Readonly<Record<string, string>> = {
  create_layer: "remove_layer",
  duplicate_layer: "remove_layer",
  derive_layer: "remove_layer",
  add_mask: "remove_mask",
  add_marker: "remove_marker",
  create_composition: "delete_project_item",
  duplicate_composition: "delete_project_item",
  create_folder: "delete_project_item",
  import_file: "delete_project_item",
  set_footage_proxy: "clear_footage_proxy",
  set_track_matte: "set_track_matte with no matte layer",
  set_composition_guides: "set_composition_guides with replace or clear",
};

const UNSHIPPED_REMOVAL: ReadonlySet<string> = new Set(["render_composition", "cleanup_project", "collect_project", "switch_project"]);

/** Whether After Effects can take an operation back; a render that starts writes a file outside the project, so nothing takes it back. */
export function undoabilityOfOperation(operation: ActionPlanV2Operation): Undoability {
  if (operation.type !== "render_composition") return undoabilityOf(operation.type);
  const fields = jsonFieldsOf(operation);
  return stringAt(fields, "executeAuthorization") === "RENDER_NOW" || stringAt(fields, "mediaEncoder") !== undefined ? "not-undoable" : "undo-group";
}

type NoticeSeverity = "note" | "unverified" | "error";

/** One classified remark about a plan: how serious it is, what it says, why, what to do, and which operations it concerns. */
export type PlanNotice = {
  severity: NoticeSeverity;
  title: string;
  detail: string;
  because?: string;
  action?: string;
  operationIndexes?: number[];
  code?: string | undefined;
};

/** The flat string form, for surfaces that have not been taught about notices yet. */
export function noticesToWarnings(notices: readonly PlanNotice[]): string[] {
  return notices.map((notice) => `${notice.title} ${notice.detail}`.trim());
}

const SEVERITY_ORDER: Record<NoticeSeverity, number> = {
  error: 0,
  unverified: 1,
  note: 2,
};

/** Worst first, so a reader scanning the list meets the real problems before the remarks. */
export function sortNotices(notices: readonly PlanNotice[]): PlanNotice[] {
  return [...notices].sort((left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]);
}

interface IndexedOperation {
  operation: ActionPlanV2Operation;
  index: number;
}

function describeOperations(entries: IndexedOperation[]): string {
  return entries.map(({ operation, index }) => `#${index + 1} ${operation.type}`).join(", ");
}

function createsOnRerun(operation: OperationVerificationReport): boolean {
  if (operation.rerun !== "creates") return false;
  if (operation.type !== "set_composition_guides") return true;
  return booleanAt(jsonFieldsOf(operation), "replace") !== true;
}

type NoticeText = Pick<PlanNotice, "severity" | "code" | "title" | "detail" | "action">;

function because(entries: readonly OperationVerificationReport[]): string {
  return entries.map((operation) => `#${operation.index + 1} ${operation.type}: ${operation.detail ?? operation.basis}`).join("\n");
}

function operationNotice(entries: readonly OperationVerificationReport[], { severity, code, title, detail, action }: NoticeText): PlanNotice {
  const notice: PlanNotice = { severity, code, title, detail, because: because(entries) };
  return { ...notice, ...(action === undefined ? {} : { action }), operationIndexes: entries.map((operation) => operation.index) };
}

function regressedNotice(entries: readonly OperationVerificationReport[], translate: Translate): PlanNotice {
  return operationNotice(entries, {
    severity: "error",
    code: "REGRESSED_OPERATION",
    title: translate("plan.notice.regressedTitle", { count: entries.length }),
    detail: translate("plan.notice.regressedDetail"),
    action: translate("plan.notice.regressedAction"),
  });
}

function unverifiableNotice(entries: readonly OperationVerificationReport[], translate: Translate): PlanNotice {
  return operationNotice(entries, {
    severity: "unverified",
    code: "UNVERIFIABLE_OPERATION",
    title: translate("plan.notice.unverifiableTitle", { count: entries.length }),
    detail: translate("plan.notice.unverifiableDetail"),
  });
}

function unknownOperationNotice(entries: readonly OperationVerificationReport[], translate: Translate): PlanNotice {
  return operationNotice(entries, {
    severity: "error",
    code: "UNKNOWN_OPERATION",
    title: translate("plan.notice.unknownTitle", { count: entries.length }),
    detail: translate("plan.notice.unknownDetail"),
  });
}

function notIdempotentNotice(entries: readonly OperationVerificationReport[], translate: Translate): PlanNotice {
  return operationNotice(entries, {
    severity: "note",
    code: "NOT_IDEMPOTENT",
    title: translate(entries.length === 1 ? "plan.notice.notIdempotentTitleOne" : "plan.notice.notIdempotentTitleMany"),
    detail: translate("plan.notice.notIdempotentDetail", { count: entries.length }),
    action: translate("plan.notice.notIdempotentAction"),
  });
}

function whenAny<T>(entries: readonly T[], build: (entries: readonly T[], translate: Translate) => PlanNotice, translate: Translate): PlanNotice[] {
  return entries.length ? [build(entries, translate)] : [];
}

/** Per-operation verdicts, built from the structured reports rather than by matching text against the old warning strings, so the wording can change freely. */
export function verificationNotices(verification: PlanVerificationSummary, translate: Translate = ENGLISH_TEXT): PlanNotice[] {
  const operations = verification.operations ?? [];
  const withStatus = (status: string): OperationVerificationReport[] => operations.filter((operation) => operation.status === status);
  return [
    ...whenAny(withStatus("regressed"), regressedNotice, translate),
    ...whenAny(withStatus("unverifiable"), unverifiableNotice, translate),
    ...whenAny(withStatus("unknown_type"), unknownOperationNotice, translate),
    ...whenAny(operations.filter(createsOnRerun), notIdempotentNotice, translate),
  ];
}

/** What After Effects will and will not take back, in the order it matters: nothing reverses it at all; Undo reverses it and no operation here does yet; it deletes something, so Undo is the only way back once it has run. */
export function undoNotices(operations: readonly ActionPlanV2Operation[], jobCreatedIds?: ReadonlySet<string>, translate: Translate = ENGLISH_TEXT): PlanNotice[] {
  const notices: PlanNotice[] = [];
  const entries: IndexedOperation[] = operations.map((operation, index) => ({ operation, index }));
  const withUndoability = (wanted: Undoability) => {
    return entries.filter(({ operation }) => undoabilityOfOperation(operation) === wanted);
  };

  const permanent = withUndoability("not-undoable");
  if (permanent.length) notices.push(notUndoableNotice(permanent, translate));
  const undoOnly = entries.filter(({ operation }) => isUndoOnly(operation));
  if (undoOnly.length) notices.push(undoOnlyNotice(undoOnly, translate));
  const byOperation = entries.filter(({ operation }) => isReversedByOperation(operation));
  if (byOperation.length) notices.push(reversibleByOperationNotice(byOperation, translate));
  const owned = ownedRemovalIndexes(operations, jobCreatedIds);
  const destructive = entries.filter(({ operation, index }) => booleanAt(jsonFieldsOf(operation), "destructive") === true && !owned.has(index));
  if (destructive.length) notices.push(destructiveNotice(destructive, translate));
  const precomposed = entries.filter(({ operation }) => operation.type === "precompose_layers");
  if (precomposed.length) notices.push(precomposeNotice(precomposed, translate));

  return notices;
}

function notUndoableNotice(entries: IndexedOperation[], translate: Translate): PlanNotice {
  return {
    severity: "unverified",
    code: "NOT_UNDOABLE",
    title: translate("plan.notice.notUndoableTitle", { count: entries.length }),
    detail: translate("plan.notice.notUndoableDetail", { count: entries.length }),
    because: describeOperations(entries),
    action: translate("plan.notice.notUndoableAction"),
    operationIndexes: entries.map(({ index }) => index),
  };
}

function undoOnlyNotice(entries: IndexedOperation[], translate: Translate): PlanNotice {
  return {
    severity: "note",
    code: "UNDO_ONLY",
    title: translate("plan.notice.undoOnlyTitle", { count: entries.length }),
    detail: translate("plan.notice.undoOnlyDetail"),
    because: describeOperations(entries),
    action: translate("plan.notice.undoOnlyAction"),
    operationIndexes: entries.map(({ index }) => index),
  };
}

function reversibleByOperationNotice(entries: IndexedOperation[], translate: Translate): PlanNotice {
  return {
    severity: "note",
    code: "REVERSIBLE_BY_OPERATION",
    title: translate("plan.notice.reversibleTitle", { count: entries.length }),
    detail: translate("plan.notice.reversibleDetail"),
    because: entries.map(({ operation, index }) => `#${index + 1} ${operation.type} (${SHIPPED_INVERSE[operation.type]})`).join(", "),
    action: translate("plan.notice.reversibleAction"),
    operationIndexes: entries.map(({ index }) => index),
  };
}

function destructiveNotice(entries: IndexedOperation[], translate: Translate): PlanNotice {
  return {
    severity: "note",
    code: "DESTRUCTIVE",
    title: translate("plan.notice.destructiveTitle", { count: entries.length }),
    detail: translate("plan.notice.destructiveDetail"),
    because: describeOperations(entries),
    action: translate("plan.notice.destructiveAction"),
    operationIndexes: entries.map(({ index }) => index),
  };
}

function precomposeNotice(entries: IndexedOperation[], translate: Translate): PlanNotice {
  return {
    severity: "note",
    code: "UNPRECOMPOSE_TWO_STEPS",
    title: translate("plan.notice.precomposeTitle"),
    detail: translate("plan.notice.precomposeDetail"),
    because: describeOperations(entries),
    action: translate("plan.notice.precomposeAction"),
    operationIndexes: entries.map(({ index }) => index),
  };
}

function isUndoOnly(operation: ActionPlanV2Operation): boolean {
  const undoability = undoabilityOfOperation(operation);
  if (undoability === "not-undoable") return false;
  if (SHIPPED_INVERSE[operation.type]) return false;
  return undoability === "host-dependent" || UNSHIPPED_REMOVAL.has(operation.type);
}

function isReversedByOperation(operation: ActionPlanV2Operation): boolean {
  return undoabilityOfOperation(operation) === "host-dependent" && SHIPPED_INVERSE[operation.type] !== undefined;
}

/** A long plan is not a wrong plan, and the panel splits it into undo groups itself. */
export function largePlanNotice(operationCount: number, batchSize: number, translate: Translate = ENGLISH_TEXT): PlanNotice | undefined {
  if (operationCount <= batchSize) return undefined;
  const groups = Math.ceil(operationCount / batchSize);
  const last = String(Math.min(batchSize, operationCount));
  return {
    severity: "note",
    code: "LARGE_PLAN",
    title: translate("plan.notice.largeTitle", { operationCount: String(operationCount), groups: String(groups) }),
    detail: translate("plan.notice.largeDetail", { batchSize: String(batchSize), last, groups: String(groups) }),
    action: translate("plan.notice.largeAction", { groups: String(groups) }),
  };
}

type EffectControl = NonNullable<ReturnType<typeof effectControlOf>>;
type ControlWriteOperation = Extract<ActionPlanV2Operation, { type: "set_effect_control" | "animate_control" }>;

/** A numeric control gets a scale note only when a number the plan writes lies outside the range its own catalogue entry reports. */
export function effectUnitNotices(operations: readonly ActionPlanV2Operation[], profile: HostCapabilityProfile | undefined, translate: Translate = ENGLISH_TEXT): PlanNotice[] {
  const notices: PlanNotice[] = [];
  for (const [index, operation] of operations.entries()) {
    if (!isControlWrite(operation)) continue;
    const controlMatchName = controlMatchNameOf(operation.target?.propertyPath);
    const control = effectControlOf(profile, operation.effectMatchName, controlMatchName);
    if (!hasRange(control) || !writtenNumbers(operation).some((value) => value < control.min || value > control.max)) continue;
    notices.push(effectUnitNotice(control, { operation, controlMatchName, index }, translate));
  }
  return notices;
}

type RangedControl = EffectControl & { min: number; max: number };

function hasRange(control: EffectControl | undefined): control is RangedControl {
  return !!control && control.valueType === "number" && !control.menu && typeof control.min === "number" && typeof control.max === "number";
}

function writtenNumbers(operation: ControlWriteOperation): number[] {
  const values = operation.type === "set_effect_control" ? [operation.value] : (operation.keyframes ?? []).map((keyframe) => keyframe.value);
  return values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function isControlWrite(operation: ActionPlanV2Operation): operation is ControlWriteOperation {
  return operation.type === "set_effect_control" || operation.type === "animate_control";
}

function controlMatchNameOf(propertyPath: string | undefined): string {
  return (propertyPath ?? "").split("/").pop() ?? "";
}

function effectUnitNotice(control: RangedControl, { operation, controlMatchName, index }: { operation: ControlWriteOperation; controlMatchName: string; index: number }, translate: Translate): PlanNotice {
  const range = { min: String(control.min), max: String(control.max) };
  return {
    severity: "note", code: "EFFECT_CONTROL_UNITS",
    title: translate("plan.notice.unitsTitle", { name: control.displayName, ...range }),
    detail: translate("plan.notice.unitsDetail"),
    because: `#${index + 1} ${operation.type} on ${operation.effectMatchName}, control ${controlMatchName}.`,
    action: translate("plan.notice.unitsAction", range),
    operationIndexes: [index],
  };
}

function effectControlOf(profile: HostCapabilityProfile | undefined, matchName: string | undefined, controlMatchName: string) {
  const entry = profile?.entries.find((candidate) => candidate.kind === "effect" && candidate.matchName === matchName);
  return entry?.controls?.find((candidate) => candidate.matchName === controlMatchName);
}

function assistedText(reason: string, name: string, translate: Translate): Pick<PlanNotice, "title" | "detail"> {
  if (reason === "analyzes-in-background") return { title: translate("plan.notice.analysisTitle", { name }), detail: translate("plan.notice.analysisDetail") };
  return { title: translate("plan.notice.dialogTitle", { name }), detail: translate("plan.notice.dialogDetail") };
}

/** After Effects will show a dialog while a user assisted effect is added; the card says so, by name, before the plan is approved. */
export function userAssistedNotices(operations: readonly ActionPlanV2Operation[], profile: HostCapabilityProfile | undefined, translate: Translate = ENGLISH_TEXT): PlanNotice[] {
  const notices: PlanNotice[] = [];
  for (const [index, operation] of operations.entries()) {
    const matchName = operation.type === "ensure_effect" ? operation.effectMatchName : undefined;
    const assisted = matchName ? userAssistedEffect(profile, matchName) : undefined;
    if (!assisted) continue;
    notices.push({
      severity: "note", code: "EFFECT_USER_ASSISTED",
      ...assistedText(assisted.reason, assisted.displayName, translate),
      because: assisted.note,
      operationIndexes: [index],
    });
  }
  return notices;
}
