/**
 * Host commands into the plan vocabulary the fixture applies: `operation` becomes `type`, target fields move under `target`, and grouped shape
 * and text writes are unpacked.
 */

import { isWireArray, isWireObject } from "@extynt/fake-plugin";
import { translateTextAnimatorGrouping } from "./fake-host-animators.js";
import { SHAPE_ITEMS, type ShapeItemSpec } from "./fake-host-tables.js";
import { own } from "./fake-host-values.js";
import type { WireObject, WireValue } from "./wire-types.js";

type Members = { [key: string]: WireValue };

const HOST_TARGET_FIELDS: readonly string[] = ["compositionId", "layerId", "propertyPath", "effectPath", "itemId"];

const HOST_OPERATION_KEYS: ReadonlySet<string> = new Set(["operation", "type", "target"]);

const SHAPE_ITEM_KIND_BY_MATCH_NAME: ReadonlyMap<string, string> = new Map(Object.entries(SHAPE_ITEMS).map(([kind, spec]) => [spec.matchName, kind]));

function rowsOf(value: WireValue | undefined): WireObject[] { return isWireArray(value) ? value.filter(isWireObject) : []; }

function settingKeyOf(spec: ShapeItemSpec, path: WireValue | undefined): string {
  const found = typeof path === "string" ? Object.keys(spec.settings).find((key) => spec.settings[key]?.[0] === path) : undefined;
  return found ?? String(path);
}

function groupedMembers(spec: ShapeItemSpec, rows: WireObject[], member: string): Members {
  const grouped: Members = {};
  for (const row of rows) {
    const value = row[member];
    if (value !== undefined) grouped[settingKeyOf(spec, row.path)] = value;
  }
  return grouped;
}

function keyframeModes(animations: WireObject[]): Members {
  const modes = new Set(animations.map((animation) => animation.keyframeMode).filter((mode): mode is string => typeof mode === "string"));
  if (modes.size === 0) return {};
  return { keyframeMode: modes.size === 1 ? [...modes].join("") : [...modes].sort().join("|") };
}

function shapeKindOf(operation: WireObject): string | undefined {
  const { item, itemMatchName } = operation;
  if (typeof item === "string" && own(SHAPE_ITEMS, item)) return item;
  return typeof itemMatchName === "string" ? SHAPE_ITEM_KIND_BY_MATCH_NAME.get(itemMatchName) : undefined;
}

function translateShapeItemGrouping(operation: WireObject): WireObject {
  const type = operation.type;
  if (type !== "add_shape_item" && type !== "update_shape_item") return operation;
  const writes = rowsOf(operation.writes);
  const animations = rowsOf(operation.animations);
  const kind = shapeKindOf(operation);
  const spec = kind === undefined ? undefined : own(SHAPE_ITEMS, kind);
  if (writes.length + animations.length === 0 || !spec) return operation;
  return { ...operation, item: kind ?? "", values: groupedMembers(spec, writes, "value"), keyframes: groupedMembers(spec, animations, "keyframes"), ...keyframeModes(animations) };
}

function hostOperationType(hostOperation: WireObject): string | undefined {
  const { type, operation } = hostOperation;
  if (typeof type === "string") return type;
  return typeof operation === "string" ? operation : undefined;
}

function splitHostFields(hostOperation: WireObject): { target: Members; translated: Members } {
  const given = hostOperation.target;
  const target: Members = isWireObject(given) ? { ...given } : {};
  const translated: Members = {};
  for (const [key, value] of Object.entries(hostOperation)) {
    if (HOST_OPERATION_KEYS.has(key)) continue;
    if (HOST_TARGET_FIELDS.includes(key)) target[key] = value;
    else translated[key] = value;
  }
  return { target, translated };
}

function translateHostOperation(hostOperation: WireObject): WireObject {
  const type = hostOperationType(hostOperation);
  const { target, translated } = splitHostFields(hostOperation);
  const planned: Members = { ...translated, ...(type === undefined ? {} : { type }), ...(Object.keys(target).length > 0 ? { target } : {}) };
  return translateTextAnimatorGrouping(translateShapeItemGrouping(planned));
}

/**
 * `compileV2Plan` output -> the plan vocabulary `applyOperationsToFixture` takes: `operation`
 * becomes `type`, target-shaped fields move under `target`, and every other field stays where the
 * host put it, including unmodelled ones. Idempotent: an operation already in plan shape is unchanged.
 */
export function planOperationsFromHostCommand(operations: readonly WireObject[]): WireObject[] { return operations.map(translateHostOperation); }
