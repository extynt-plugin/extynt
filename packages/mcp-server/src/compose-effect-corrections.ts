// Effect identity has one canonical spelling: effectMatchName is the bare matchName, target.effectPath is
// "ADBE Effect Parade/<matchName>[#N]" and a control's propertyPath is "<effectPath>/<control matchName>".
// A caller who gives a bare matchName, a display name, or a bare control name has named the same thing in
// another vocabulary, so the composer rewrites it instead of refusing.
import { EFFECT_PARADE_PREFIX } from "@extynt/action-plan";
import { queryLayerEffects } from "@extynt/project-graph";
import { ownTarget, recordChange, targetLayer } from "./compose-correction-core.js";
import type { CorrectionContext, CorrectionStep } from "./compose-correction-core.js";
import { stringAt } from "./json.js";
import type { OperationFields } from "./operation-fields.js";

const EFFECT_TARGETING: ReadonlySet<string> = new Set(["ensure_effect", "set_effect_control", "animate_control"]);
const ORDINAL = /#([0-9]{1,4})$/;

interface PathSlot {
  readonly holder: OperationFields;
  readonly key: string;
  readonly label: string;
}

interface EffectScope {
  readonly operation: OperationFields;
  readonly target: OperationFields;
}

function matchNameOf(effectPath: string): string | undefined {
  if (!effectPath.startsWith(EFFECT_PARADE_PREFIX)) return undefined;
  const segment = effectPath.slice(EFFECT_PARADE_PREFIX.length).replace(ORDINAL, "");
  return segment ? segment.replace(/%2F/g, "/").replace(/%23/g, "#").replace(/%25/g, "%") : undefined;
}

function observedEffectName(target: OperationFields, name: string, context: CorrectionContext): string | undefined {
  const layer = targetLayer(context.snapshot, target);
  if (!layer) return undefined;
  const found = queryLayerEffects(layer).filter((effect) => effect.displayName === name || effect.matchName === name);
  return found.length === 1 ? found[0]?.matchName : undefined;
}

function canonicalEffectPath(given: string, scope: EffectScope, context: CorrectionContext): string | undefined {
  if (given.startsWith(EFFECT_PARADE_PREFIX)) return undefined;
  const matchName = stringAt(scope.operation, "effectMatchName");
  const ordinal = ORDINAL.exec(given)?.[0] ?? "";
  const bare = given.slice(0, given.length - ordinal.length);
  const name = observedEffectName(scope.target, bare, context) ?? (matchName === undefined || bare === matchName ? bare : undefined);
  return name ? `${EFFECT_PARADE_PREFIX}${name}${ordinal}` : undefined;
}

function canonicalPropertyPath(given: string, effectPath: string): string | undefined {
  if (given.startsWith(`${effectPath}/`)) return undefined;
  if (!given.includes("/")) return `${effectPath}/${given}`;
  const bareEffect = effectPath.slice(EFFECT_PARADE_PREFIX.length);
  return given.startsWith(`${bareEffect}/`) ? `${EFFECT_PARADE_PREFIX}${given}` : undefined;
}

function setPath(slot: PathSlot, to: string, context: CorrectionContext): void {
  const why = `${context.type} spells effect paths in one canonical form: "ADBE Effect Parade/<matchName>[#N]" and "<effectPath>/<control matchName>"`;
  recordChange(context, { field: slot.label, from: slot.holder[slot.key], to, why });
  slot.holder[slot.key] = to;
}

function canonicaliseEffectPath(slot: PathSlot, scope: EffectScope, context: CorrectionContext): boolean {
  const given = stringAt(slot.holder, slot.key);
  if (given === undefined) return false;
  const canonical = canonicalEffectPath(given, scope, context);
  if (canonical) setPath(slot, canonical, context);
  return true;
}

function settleEffectPath(scope: EffectScope, context: CorrectionContext): void {
  const { operation, target } = scope;
  const own = context.type === "ensure_effect";
  const present = canonicaliseEffectPath({ holder: target, key: "effectPath", label: "target.effectPath" }, scope, context);
  const repeated = own && canonicaliseEffectPath({ holder: operation, key: "effectPath", label: "effectPath" }, scope, context);
  if (present || repeated) return;
  const matchName = stringAt(operation, "effectMatchName"), property = stringAt(target, "propertyPath");
  if (matchName && (own || property?.startsWith(`${EFFECT_PARADE_PREFIX}${matchName}/`))) {
    const effectPath = `${EFFECT_PARADE_PREFIX}${matchName}`;
    target.effectPath = effectPath;
    recordChange(context, { field: "target.effectPath", from: undefined, to: effectPath, why: "the effect path follows from effectMatchName" });
  }
}

function settleMatchName(scope: EffectScope, context: CorrectionContext): void {
  const path = stringAt(scope.target, "effectPath");
  const derived = path === undefined ? undefined : matchNameOf(path);
  if (scope.operation.effectMatchName === undefined && derived) {
    scope.operation.effectMatchName = derived;
    recordChange(context, { field: "effectMatchName", from: undefined, to: derived, why: "effectMatchName is the bare matchName inside effectPath" });
  }
}

function namesMatchName(named: string, matchName: string, scope: EffectScope, context: CorrectionContext): boolean {
  return named.replace(ORDINAL, "") === matchName || observedEffectName(scope.target, named, context) === matchName;
}

function settleCapability(scope: EffectScope, context: CorrectionContext): void {
  const capabilityId = stringAt(scope.operation, "capabilityId"), matchName = stringAt(scope.operation, "effectMatchName");
  if (!capabilityId?.startsWith("host:") || !matchName || capabilityId === `host:${matchName}`) return;
  if (namesMatchName(capabilityId.slice("host:".length), matchName, scope, context)) {
    setPath({ holder: scope.operation, key: "capabilityId", label: "capabilityId" }, `host:${matchName}`, context);
  }
}

function settleEnsureEffect(scope: EffectScope, context: CorrectionContext): void {
  const { operation, target } = scope;
  const targetPath = stringAt(target, "effectPath"), operationPath = stringAt(operation, "effectPath");
  if (operation.effectPath === undefined && targetPath) {
    operation.effectPath = targetPath;
    recordChange(context, { field: "effectPath", from: undefined, to: targetPath, why: "ensure_effect repeats the target's effectPath at the top level" });
  } else if (operationPath !== undefined && targetPath === undefined) {
    target.effectPath = operationPath;
    recordChange(context, { field: "target.effectPath", from: undefined, to: operationPath, why: "ensure_effect's target carries the same effectPath as the operation" });
  }
  settleCapability(scope, context);
}

function settlePropertyPath(target: OperationFields, context: CorrectionContext): void {
  const effectPath = stringAt(target, "effectPath"), property = stringAt(target, "propertyPath");
  if (!effectPath || !property || context.type === "ensure_effect") return;
  const canonical = canonicalPropertyPath(property, effectPath);
  if (canonical) setPath({ holder: target, key: "propertyPath", label: "target.propertyPath" }, canonical, context);
}

/** Canonical effect identity on the operations that target an effect or one of its controls. */
export const correctEffectOperation: CorrectionStep = (operation, context) => {
  if (!EFFECT_TARGETING.has(context.type)) return undefined;
  const target = ownTarget(operation);
  if (!target) return undefined;
  const scope = { operation, target };
  settleEffectPath(scope, context);
  settleMatchName(scope, context);
  settlePropertyPath(target, context);
  if (context.type === "ensure_effect") settleEnsureEffect(scope, context);
  return undefined;
};
