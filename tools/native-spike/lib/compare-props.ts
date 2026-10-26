/** Compares property trees and finds the first divergence. */
import type { JsonObject } from "@extynt/decode";
import { compareFields, compareKeyed, fieldText } from "./compare-core.ts";
import type { CompareTally, FieldSpec, OrderDivergence } from "./compare-core.ts";
import { recordFlags } from "./compare-flags.ts";
import { rowsAt, textAt } from "./json-access.ts";

const PROPERTY_FIELDS: ReadonlyArray<FieldSpec> = [
  "matchName", "displayName", "kind", "valueType", "value", "canSetValue", "expression", "expressionEnabled",
  ["keyframeCount", 0], ["animatable", true], ["hidden", false], "enabled",
];
const KEY_DIGEST_FIELDS: ReadonlyArray<FieldSpec> = ["keyDigest", "keyDigestTruncated"];

/** A layer pair whose property entries are compared. */
export interface LayerPair {
  readonly where: string;
  readonly probeLayer: JsonObject;
  readonly nativeLayer: JsonObject;
}

interface PathOrderCheck {
  readonly where: string;
  readonly probe: ReadonlyArray<JsonObject>;
  readonly native: ReadonlyArray<JsonObject>;
}

interface EntryPair {
  readonly where: string;
  readonly probe: JsonObject;
  readonly native: JsonObject;
}

/** The first position where the two per-layer path sequences disagree, over their common length. */
export function firstOrderDivergence(probePaths: ReadonlyArray<string | undefined>, nativePaths: ReadonlyArray<string | undefined>): OrderDivergence | null {
  const common = Math.min(probePaths.length, nativePaths.length);
  for (let position = 0; position < common; position += 1) {
    if (probePaths[position] !== nativePaths[position]) {
      return { position, probe: probePaths[position], native: nativePaths[position] };
    }
  }
  return null;
}

function pathsOf(rows: ReadonlyArray<JsonObject>): Array<string | undefined> {
  return rows.map((entry) => textAt(entry, "path"));
}

function checkOrder(report: CompareTally, spec: PathOrderCheck): void {
  const divergence = firstOrderDivergence(pathsOf(spec.probe), pathsOf(spec.native));
  report.order.layersChecked += 1;
  if (!divergence) return;
  report.order.layersDiverging += 1;
  if (report.order.examples.length < report.maxExamples) report.order.examples.push({ where: spec.where, ...divergence });
}

function compareEntry(report: CompareTally, spec: EntryPair): void {
  const where = `${spec.where} / ${fieldText(spec.probe, "path")}`;
  compareFields(report, { scope: "property", where, probe: spec.probe, native: spec.native, fields: PROPERTY_FIELDS });
  if (spec.native.keyDigest !== undefined) {
    compareFields(report, { scope: "property", where, probe: spec.probe, native: spec.native, fields: KEY_DIGEST_FIELDS });
  }
  recordFlags(report, spec);
}

/** Matches a layer's property entries by path and compares their fields; ordering is checked but informational. */
export function compareProperties(report: CompareTally, spec: LayerPair): void {
  const probe = rowsAt(spec.probeLayer, "propertyPaths");
  const native = rowsAt(spec.nativeLayer, "propertyPaths");
  compareKeyed(report, {
    scope: "path", key: "path", counter: "properties", probeRows: probe, nativeRows: native,
    describe: (row) => `${spec.where} / ${fieldText(row, "path")}`,
    exemptNativeOnly: () => (spec.probeLayer.propertyPathsTruncated === true ? "native-only (probe truncated)" : null),
    exemptProbeOnly: () => (spec.nativeLayer.propertyPathsTruncated === true ? "probe-only (native truncated)" : null),
    onPair: (probeEntry, nativeEntry) => compareEntry(report, { where: spec.where, probe: probeEntry, native: nativeEntry }),
  });
  checkOrder(report, { where: spec.where, probe, native });
}
