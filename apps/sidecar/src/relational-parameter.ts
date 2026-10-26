/**
 * Judges a request to set one control against the exact current observation and the scoped native snapshot, and prepares the
 * one `set_effect_control` operation when every check passes. Only a Gaussian Blur amount has a demonstrated native
 * assignment, so every other control stays descriptive. SQL identity narrows the request; only the typed read-set pipeline admits a write.
 */
import { computePlanDigest, metadataReadSet, validateActionPlan, type ActionPlan, type SetEffectControlOperation } from '@extynt/action-plan';
import type { LocalBlurObservation, ProjectSnapshot } from '@extynt/project-graph';
import type { ParameterChangeFailure, ParameterPreparationInput, PreparedParameterChange } from './relational-types.js';
import { isRow, type Opaque, type Row } from './snapshot-view.js';

const EFFECT = 'ADBE Gaussian Blur 2';
const CONTROL = 'ADBE Gaussian Blur 2-0001';
const EFFECT_PATH = 'ADBE Effect Parade/' + EFFECT;
const PROPERTY_PATH = EFFECT_PATH + '/' + CONTROL;
interface Binding { root: Row; address: Row; current: Row; stamp: Row }
function failure(code: string, message: string): ParameterChangeFailure { return { ok: false, error: { code, message } }; }
function binding(value: Opaque): Binding | undefined {
  if (!isRow(value) || !isRow(value.address) || !isRow(value.current) || !isRow(value.stamp)) return undefined;
  return { root: value, address: value.address, current: value.current, stamp: value.stamp };
}
function currentIdentity(input: ParameterPreparationInput, observed: Binding): ParameterChangeFailure | undefined {
  const { request, panelInstanceId, now } = input, root = observed.root;
  if (root.state !== 'observed' || root.controlInstanceId !== request.controlInstanceId || root.observationId !== request.observationId) return failure('STALE_PARAMETER_OBSERVATION', 'The exact current control observation is unavailable; demand and query fresh native evidence.');
  if (!currentSession(root, panelInstanceId)) return failure('PARAMETER_SESSION_MISMATCH', 'The control observation belongs to another panel or collection session.');
  const age = typeof root.observedAt === 'number' ? now - root.observedAt : Number.NaN;
  if (!currentAge(age)) return failure('STALE_PARAMETER_OBSERVATION', 'The current control observation is aged or its clock identity is unavailable.');
  return undefined;
}
function currentSession(root: Row, panel: string | undefined): boolean { return !!panel && root.panelInstanceId === panel && typeof root.collectionSessionId === 'string' && root.collectionSessionId.length > 0; }
function currentAge(age: number): boolean { return Number.isFinite(age) && age >= 0 && age < 15000; }
function supportedAddress(_input: ParameterPreparationInput, observed: Binding): ParameterChangeFailure | undefined {
  const address = observed.address;
  if (address.effectMatchName !== EFFECT || address.controlMatchName !== CONTROL || address.propertyPath !== PROPERTY_PATH) return failure('PARAMETER_WRITE_UNSUPPORTED', 'This control has no demonstrated bounded native assignment adapter; its definition and current observations remain descriptive.');
  return undefined;
}
function snapshotIdentity(input: ParameterPreparationInput, observed: Binding): ParameterChangeFailure | undefined {
  const { snapshot } = input, { address, stamp } = observed;
  if (!snapshot || !scopedSnapshot(snapshot)) return failure('PARAMETER_NATIVE_EVIDENCE_REQUIRED', 'Demand a complete local blur page for this target before preparing a parameter change.');
  const scopeFailure = scopedIdentity(snapshot, observed);
  if (scopeFailure) return scopeFailure;
  if (!sameStamp(snapshot, stamp)) return failure('PARAMETER_REVISION_MISMATCH', 'The relational observation and native snapshot have different epoch or revision.');
  return targetFailure(snapshot, address);
}
function targetFailure(snapshot: ProjectSnapshot, address: Row): ParameterChangeFailure | undefined {
  const composition = snapshot.compositions.find(item => item.id === address.compositionId);
  const layer = composition?.layers.find(item => item.id === address.layerId);
  if (!composition || !layer || !sameAddress(composition.itemIndex, layer.index, localBlur(snapshot), address)) return failure('PARAMETER_TARGET_MISMATCH', 'The exact native composition, layer and effect addresses do not match the current observation.');
  return layer.locked ? failure('TARGET_LOCKED', 'The native target layer is locked.') : undefined;
}
function localBlur(snapshot: ProjectSnapshot | undefined): LocalBlurObservation | undefined { return snapshot?.coverage?.localEffect; }
function scopedIdentity(snapshot: ProjectSnapshot, observed: Binding): ParameterChangeFailure | undefined {
  if (!coverageTarget(snapshot, observed.address)) return failure('PARAMETER_COVERAGE_MISMATCH', 'The scoped native coverage does not name this exact composition and layer.');
  if (!sameCollectionSession(snapshot, observed.root)) return failure('PARAMETER_SESSION_MISMATCH', 'The scoped native snapshot and relational observation have different collection sessions.');
  return undefined;
}
function coverageTarget(snapshot: ProjectSnapshot, address: Row): boolean {
  const coverage = snapshot.coverage;
  if (!coverage || coverage.compositionId !== address.compositionId) return false;
  return coverage.observedLayerIds === undefined || coverage.observedLayerIds.some(id => id === address.layerId);
}
function sameCollectionSession(snapshot: ProjectSnapshot, root: Row): boolean {
  return snapshot.coverage?.collectionSessionId === root.collectionSessionId;
}
function scopedSnapshot(snapshot: ProjectSnapshot): boolean { return snapshot.coverage?.kind === 'composition-metadata' && !!snapshot.coverage.localEffect && !!snapshot.hostStamp; }
function sameStamp(snapshot: ProjectSnapshot, stamp: Row): boolean { return snapshot.hostStamp?.epoch === stamp.epoch && snapshot.hostStamp?.revision === stamp.revision; }
function sameAddress(item: number | undefined, layer: number, local: LocalBlurObservation | undefined, address: Row): boolean { return item === address.itemIndex && layer === address.layerIndex && local?.effectIndex === address.effectIndex; }
function staticObservation(input: ParameterPreparationInput, observed: Binding): ParameterChangeFailure | undefined {
  const current = observed.current, local = input.snapshot?.coverage?.localEffect;
  if (!scalarObserved(current)) return failure('PARAMETER_VALUE_SHAPE_UNKNOWN', 'A demonstrated scalar native value is required for this assignment.');
  if (!staticPolicy(current)) return failure('PARAMETER_STATIC_POLICY', 'Static assignment requires exact settable, unanimated and expression-free current evidence.');
  if (!local || !sameNativeObservation(current, local) || !sameNativeUnits(current, local)) return failure('PARAMETER_OBSERVATION_MISMATCH', 'The exact current value, bounds or expression state differs from the scoped native read set.');
  return undefined;
}
function scalarObserved(current: Row): boolean { return current.valueType === 'OneD' && typeof current.value === 'number' && Number.isFinite(current.value); }
function staticPolicy(current: Row): boolean { return current.canSetValue === true && current.keyframeCount === 0 && ['isTimeVarying', 'expressionEnabled', 'expressionPresent'].every(key => current[key] === false); }
function sameNativeObservation(current: Row, local: LocalBlurObservation): boolean {
  return current.value === local.value && current.minimum === local.minimum && current.maximum === local.maximum && local.keyframeCount === 0 && local.expressionEnabled === false && local.expression === '';
}
function sameNativeUnits(current: Row, local: LocalBlurObservation): boolean {
  const native = isRow(local) && typeof local.unitsText === 'string' ? local.unitsText : null;
  return current.units === native;
}
function validRange(minimum: Opaque, maximum: Opaque): boolean { return typeof minimum === 'number' && typeof maximum === 'number' && Number.isFinite(minimum) && Number.isFinite(maximum) && minimum <= maximum; }
function nativeValue(input: ParameterPreparationInput, observed: Binding): ParameterChangeFailure | undefined {
  const { value } = input.request, { minimum, maximum, units } = observed.current;
  if (!validRange(minimum, maximum)) return failure('PARAMETER_RANGE_UNKNOWN', 'The exact current native control bounds are unknown.');
  if (value.value < Number(minimum) || value.value > Number(maximum)) return failure('PARAMETER_VALUE_RANGE', 'The requested native scalar value is outside the current observed range.');
  if (value.unit !== undefined && (typeof units !== 'string' || units !== value.unit)) return failure('PARAMETER_UNIT_CONVERSION_UNSUPPORTED', 'Units must exactly match the current native unit spelling; unknown units and semantic conversions are refused.');
  return undefined;
}
function operationFor(input: ParameterPreparationInput, observed: Binding): SetEffectControlOperation | undefined {
  const snapshot = input.snapshot, address = observed.address;
  if (!snapshot || typeof address.compositionId !== 'string' || typeof address.layerId !== 'string') return undefined;
  return { type: 'set_effect_control', effectMatchName: EFFECT, value: input.request.value.value, target: { compositionId: address.compositionId, layerId: address.layerId, effectPath: EFFECT_PATH, propertyPath: PROPERTY_PATH, snapshotFingerprint: snapshot.fingerprint, selectionFingerprint: snapshot.selectionFingerprint } };
}
function firstRefusal(input: ParameterPreparationInput, observed: Binding): ParameterChangeFailure | undefined {
  for (const check of [currentIdentity, supportedAddress, snapshotIdentity, staticObservation, nativeValue]) { const refused = check(input, observed); if (refused) return refused; }
  return undefined;
}
/** The prepared change when the request matches the exact current observation, otherwise the first refusal. */
export function prepareParameterChange(input: ParameterPreparationInput): PreparedParameterChange | ParameterChangeFailure {
  const observed = binding(input.current);
  if (!observed) return failure('PARAMETER_OBSERVATION_UNKNOWN', 'The exact current relational control observation is unknown.');
  const checked = firstRefusal(input, observed);
  if (checked) return checked;
  const operation = operationFor(input, observed), snapshot = input.snapshot;
  if (!operation || !snapshot) return failure('PARAMETER_NATIVE_EVIDENCE_REQUIRED', 'The exact scoped native snapshot is unavailable.');
  const summary = input.request.summary ?? 'Set Gaussian Blur native amount';
  const refused = admitOperation(operation, snapshot, summary);
  if (refused) return refused;
  return { ok: true, summary, operations: [operation], desired: { controlInstanceId: input.request.controlInstanceId, sourceObservationId: input.request.observationId, value: input.request.value.value, unit: typeof observed.current.units === 'string' ? observed.current.units : null } };
}

function admitOperation(operation: SetEffectControlOperation, snapshot: ProjectSnapshot, summary: string): ParameterChangeFailure | undefined {
  const plan: ActionPlan = { schemaVersion: '0.2', planId: 'relational-admission', snapshotFingerprint: snapshot.fingerprint, selectionFingerprint: snapshot.selectionFingerprint, freshness: snapshot.freshness, summary, requiresApproval: true, operations: [operation], bounds: { maxOperations: 1 }, preconditions: [], conflicts: [], postconditions: [] };
  plan.digest = computePlanDigest(plan);
  const validation = validateActionPlan(plan, snapshot);
  if (!validation.ok) return failure(validation.code, validation.message);
  if (metadataReadSet(plan, snapshot)?.schemaVersion !== 'blur-control-read-set/1') return failure('PARAMETER_READ_SET_UNSUPPORTED', 'This request lacks the exact demonstrated native Gaussian assignment read set.');
  return undefined;
}
