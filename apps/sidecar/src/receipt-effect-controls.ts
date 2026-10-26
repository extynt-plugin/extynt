/**
 * The controls of the effects an apply just added, read back from its receipt. A receipt lists them so the model need not run
 * a discovery pass, and they are fed into the live host profile so the next describe call returns them.
 */
import { applyEffectControlEvidence, controlsFromProbeRows, type ControlSchema, type EffectProbeEvidence, type EffectProbeRow, type HostCapabilityProfile } from "@extynt/capability-catalogue";
import { jsonOf, type StoredReceipt } from "@extynt/mcp-server";
import { array, boolean, decode, fallback, type Infer, number, object, string } from "@extynt/decode";
import type { SidecarState } from "./server-state.js";
import { opaque, type Opaque } from "./snapshot-view.js";

const RECEIPT_EFFECT_CONTROL_LIMIT = 40;
const RECEIPT_EFFECT_LIMIT = 8;

interface ReceiptEffectControl { path: string; matchName: string; name: string; valueType: string; value?: number | number[] }
interface ReceiptEffectControls { effect: string; controls: ReceiptEffectControl[] }
type Receipt = StoredReceipt;

const probeRowShape = object({ m: fallback(string(), undefined), n: fallback(string(), undefined), t: fallback(string(), undefined), v: opaque, min: fallback(number(), undefined), max: fallback(number(), undefined), g: fallback(number(), undefined), items: fallback(array(opaque), undefined) });
const stepShape = object({ operation: fallback(string(), undefined), created: fallback(boolean(), undefined), effectMatchName: fallback(string(), undefined), controls: fallback(array(fallback(probeRowShape, undefined)), undefined) });
const receiptShape = object({ verification: fallback(object({ steps: fallback(array(fallback(stepShape, undefined)), undefined) }), undefined) });

type ProbeFacts = Infer<typeof probeRowShape>;
type StepFacts = Infer<typeof stepShape>;

const field = <V>(key: string, value: V | undefined): Record<string, V> => (value === undefined ? {} : { [key]: value });

function probeRowOf(row: ProbeFacts): EffectProbeRow {
  const menu = row.items ? { dd: true, items: row.items.map(String) } : {};
  return { ...field("m", row.m), ...field("n", row.n), ...field("t", row.t), ...field("v", row.v ?? undefined), ...field("min", row.min), ...field("max", row.max), ...field("g", row.g), ...menu };
}

function stepRows(step: StepFacts): EffectProbeRow[] | undefined {
  if (step.operation !== "ensure_effect" || step.created !== true || !step.controls) return undefined;
  const rows = step.controls.filter((control) => control !== undefined).slice(0, RECEIPT_EFFECT_CONTROL_LIMIT * 2).map(probeRowOf);
  return rows.length ? rows : undefined;
}

function stepsOf(receipt: Receipt): ReadonlyArray<StepFacts | undefined> {
  const decoded = decode(receiptShape, receipt);
  return decoded.ok ? decoded.value.verification?.steps ?? [] : [];
}

function addedEffectRows(receipt: Receipt): Array<{ effect: string; rows: EffectProbeRow[] }> {
  const found = new Map<string, EffectProbeRow[]>();
  for (const step of stepsOf(receipt)) {
    const rows = step && stepRows(step);
    if (rows && step.effectMatchName !== undefined && !found.has(step.effectMatchName)) found.set(step.effectMatchName, rows);
  }
  return [...found].slice(0, RECEIPT_EFFECT_LIMIT).map(([effect, rows]) => ({ effect, rows }));
}

function uncached(profile: HostCapabilityProfile | undefined, effect: string): boolean {
  const entry = profile?.entries.find((candidate) => candidate.kind === "effect" && candidate.matchName === effect);
  return !(entry?.controls ?? []).length;
}

function numericValue(value: Opaque): number | number[] | undefined {
  if (typeof value === "number") return value;
  return Array.isArray(value) && value.every((entry) => typeof entry === "number") ? value : undefined;
}

function receiptControl(control: ControlSchema): ReceiptEffectControl {
  const value = numericValue(control.defaultValue);
  return { path: `ADBE Effect Parade/${control.path}`, matchName: control.matchName, name: control.displayName, valueType: control.valueType, ...(value !== undefined ? { value } : {}) };
}

/**
 * Effects this apply added whose control schema the host profile does not hold: the controls the host read back after adding them.
 * They are the effect's values as just added (before any later set_effect_control), listed so the model need not run a discovery pass.
 */
export function uncachedEffectControls(receipt: Receipt, profile: HostCapabilityProfile | undefined): Array<ReceiptEffectControls & { rows: EffectProbeRow[] }> {
  return addedEffectRows(receipt).filter(({ effect }) => uncached(profile, effect)).map(({ effect, rows }) => ({
    effect,
    rows,
    controls: controlsFromProbeRows(effect, rows).filter((control) => control.valueType !== "group").slice(0, RECEIPT_EFFECT_CONTROL_LIMIT).map(receiptControl),
  }));
}

/** Stamps the receipt with those controls and feeds them into the live host profile, so the next describe call returns them. */
export function recordObservedEffectControls(state: Pick<SidecarState, "hostProfile">, receipt: Receipt): void {
  const found = uncachedEffectControls(receipt, state.hostProfile);
  if (!found.length) return;
  receipt.effectControls = jsonOf(found.map(({ effect, controls }) => ({ effect, controls })));
  const profile = state.hostProfile;
  if (!profile) return;
  const evidence: EffectProbeEvidence = { effects: Object.fromEntries(found.map(({ effect, rows }) => [effect, { controls: rows }])) };
  state.hostProfile = applyEffectControlEvidence(profile, evidence);
}
