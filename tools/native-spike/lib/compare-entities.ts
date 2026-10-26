/** Compares project items, sources and compositions between the native snapshot and the probe. */
import type { JsonObject } from "@extynt/decode";
import { compareFields, compareKeyed, compareValue, fieldText } from "./compare-core.ts";
import type { CompareTally } from "./compare-core.ts";
import { compareProperties } from "./compare-props.ts";
import { objectAt, rowsAt } from "./json-access.ts";

const ITEM_FIELDS = ["name", "type", "parentFolderId"];
const SOURCE_FIELDS = ["name", "type", "missing", "width", "height", "duration"];
const COMP_FIELDS = [
  "name", "width", "height", "pixelAspect", "duration", "frameRate",
  "workAreaStart", "workAreaDuration", "currentTime", "backgroundColor",
];
const LAYER_FIELDS = [
  "index", "name", "selected", "label", "type", "enabled", "shy", "solo", "locked", "threeD",
  "startTime", "inPoint", "outPoint", "stretch", "parentId", "matteLayerId", "matteType",
  "sourceId", "compositionSourceId",
];
const SKIPPED_SWITCHES: ReadonlySet<string> = new Set(["per-character-3d"]);

/** The compositions the probe's own paging says it did not fully read. */
export interface ProbeGaps {
  readonly capped: boolean;
  readonly unread: ReadonlySet<string>;
  readonly partial: ReadonlySet<string>;
}

/** The composition lists of both sides, with the probe's gaps. */
export interface CompositionComparison {
  readonly probeComps: ReadonlyArray<JsonObject>;
  readonly nativeComps: ReadonlyArray<JsonObject>;
  readonly gaps: ProbeGaps;
}

interface RowPair {
  readonly where: string;
  readonly probe: JsonObject;
  readonly native: JsonObject;
}

interface LayerComparison {
  readonly compId: string;
  readonly probe: JsonObject;
  readonly native: JsonObject;
}

interface CompositionPair {
  readonly probe: JsonObject;
  readonly native: JsonObject;
  readonly gaps: ProbeGaps;
}

const describeNamed = (row: JsonObject): string => `${fieldText(row, "id")} "${fieldText(row, "name")}"`;

/** Compares the project items matched by id. */
export function compareItems(report: CompareTally, probeItems: ReadonlyArray<JsonObject>, nativeItems: ReadonlyArray<JsonObject>): void {
  compareKeyed(report, {
    scope: "item", key: "id", counter: "items", probeRows: probeItems, nativeRows: nativeItems,
    describe: describeNamed,
    onPair: (probe, native) => compareFields(report, { scope: "item", where: `item ${fieldText(probe, "id")}`, probe, native, fields: ITEM_FIELDS }),
  });
}

/** Compares the footage and solid sources matched by id. */
export function compareSources(report: CompareTally, probeSources: ReadonlyArray<JsonObject>, nativeSources: ReadonlyArray<JsonObject>): void {
  compareKeyed(report, {
    scope: "source", key: "id", counter: "sources", probeRows: probeSources, nativeRows: nativeSources,
    describe: describeNamed,
    onPair: (probe, native) => {
      compareFields(report, { scope: "source", where: `source ${fieldText(probe, "id")}`, probe, native, fields: SOURCE_FIELDS });
    },
  });
}

function compareSwitches(report: CompareTally, spec: RowPair): void {
  const probe = objectAt(spec.probe, "switches"), native = objectAt(spec.native, "switches");
  const names = new Set([...Object.keys(probe), ...Object.keys(native)]);
  for (const name of names) {
    if (SKIPPED_SWITCHES.has(name)) continue;
    compareValue(report, { scope: "layer.switches", where: spec.where, field: name, probe: probe[name], native: native[name] });
  }
}

function compareLayer(report: CompareTally, spec: LayerComparison): void {
  const { probe, native } = spec;
  const where = `comp ${spec.compId} / layer ${fieldText(probe, "id")} "${fieldText(probe, "name")}"`;
  compareFields(report, { scope: "layer", where, probe, native, fields: LAYER_FIELDS });
  const probeAudio = probe.audioEnabled, nativeAudio = native.audioEnabled;
  if (probeAudio !== undefined && probeAudio !== null && nativeAudio !== undefined && nativeAudio !== null) {
    compareValue(report, { scope: "layer", where, field: "audioEnabled", probe: probeAudio, native: nativeAudio });
  }
  compareSwitches(report, { where, probe, native });
  compareProperties(report, { where, probeLayer: probe, nativeLayer: native });
}

function layerExemption(probeComp: JsonObject, nativeComp: JsonObject): string | null {
  if (probeComp.truncated === true) return "probe composition truncated";
  if (nativeComp.truncated === true) return "native composition truncated";
  return null;
}

function compareLayers(report: CompareTally, spec: CompositionPair): void {
  const { probe, native, gaps } = spec;
  const compId = fieldText(probe, "id");
  const partial = gaps.partial.has(compId) ? "probe composition partial" : null;
  const reason = partial ?? layerExemption(probe, native);
  compareKeyed(report, {
    scope: "layer", key: "id", counter: "layers", probeRows: rowsAt(probe, "layers"), nativeRows: rowsAt(native, "layers"),
    describe: (row) => `comp ${compId} / layer ${fieldText(row, "id")} "${fieldText(row, "name")}" (index ${fieldText(row, "index")})`,
    exemptNativeOnly: () => reason,
    exemptProbeOnly: () => (native.truncated === true ? "native composition truncated" : null),
    onPair: (probeLayer, nativeLayer) => compareLayer(report, { compId, probe: probeLayer, native: nativeLayer }),
  });
}

function compositionReason(row: JsonObject, gaps: ProbeGaps): string | null {
  if (gaps.capped) return "probe composition cap";
  if (gaps.unread.has(fieldText(row, "id"))) return "probe left unread";
  return null;
}

/** Compares the compositions matched by id, then the layers inside each matched pair. */
export function compareCompositions(report: CompareTally, spec: CompositionComparison): void {
  const { probeComps, nativeComps, gaps } = spec;
  compareKeyed(report, {
    scope: "composition", key: "id", counter: "compositions", probeRows: probeComps, nativeRows: nativeComps,
    describe: describeNamed,
    exemptNativeOnly: (row) => compositionReason(row, gaps),
    onPair: (probe, native) => {
      const where = `comp ${fieldText(probe, "id")} "${fieldText(probe, "name")}"`;
      compareFields(report, { scope: "composition", where, probe, native, fields: COMP_FIELDS });
      compareLayers(report, { probe, native, gaps });
    },
  });
}
