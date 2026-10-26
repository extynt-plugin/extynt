// What a probe snapshot must contain to be accepted: the envelope, the runtime that produced it and the parts of the project it reports.
import { array, boolean, Failure, jsonValueWithin, literal, map, nullable, number, object, optional, record, refine, skippingInvalid, string, tuple } from "@extynt/decode";
import type { Decoder, Infer, JsonValue } from "@extynt/decode";
import { interruptedApply } from "./interrupted-apply-wire.js";
import { SNAPSHOT_SCHEMA_VERSION } from "./server-limits.js";
import { probeComposition } from "./server-probe-composition.js";

const runtimeReport = object({
  application: literal("After Effects"),
  appVersion: string(),
  buildNumber: nullable(string()),
  buildName: nullable(string()),
  platform: literal("macOS", "Windows", "unknown"),
  architecture: literal("arm64", "x86_64", "unknown"),
  compatible: boolean(),
  isoLanguage: optional(nullable(string())),
});

/** The After Effects runtime that answered. `compatible` is what the host reported; a host below the supported version reports false and the decoder refuses it, so a decoded runtime came from a supported host. */
export const probeRuntime = refine(runtimeReport, (runtime): runtime is typeof runtime => runtime.compatible, "a supported After Effects host (compatible: true)");

const MAX_NAME_CHARS = 512;

/** One effect a host reports as installed. */
export const installedEffect = object({
  matchName: string({ nonEmpty: true, maxLength: MAX_NAME_CHARS }),
  displayName: optional(string()),
  category: optional(nullable(string())),
  version: optional(nullable(string())),
  available: optional(boolean()),
  hasOptionsDialog: optional(boolean()),
});

const inventory = map(array(object({ index: number(), matchName: string() })), (rows) => [...rows]);

const localEffect = object({
  effectMatchName: literal("ADBE Gaussian Blur 2"),
  effectIndex: number(),
  inventory,
  effectEnabled: boolean(),
  matchNames: map(array(string()), (names) => [...names]),
  valueType: literal("number"),
  canSetValue: literal(true),
  keyframeCount: literal(0),
  expressionEnabled: literal(false),
  expression: literal(""),
  value: number(),
  minimum: number(),
  maximum: number(),
  unitsText: optional(nullable(string())),
  isTimeVarying: optional(nullable(boolean())),
  propertyIndices: optional(map(array(number()), (indices) => [...indices])),
  dependencyPolicy: literal("local-literal-assignment"),
});

const localCreation = object({
  effectMatchName: literal("ADBE Gaussian Blur 2"),
  inventory,
  absent: literal(true),
  canAdd: literal(true),
  dependencyPolicy: literal("local-effect-creation"),
});

const coverage = object({
  kind: literal("composition-metadata"),
  compositionId: string(),
  properties: literal("unknown"),
  otherCompositions: literal("unknown"),
  otherLayers: optional(literal("unknown")),
  observedLayerIds: optional(map(array(string()), (ids) => [...ids])),
  localEffect: optional(localEffect),
  localCreation: optional(localCreation),
  collectionSessionId: optional(string()),
});

const projectItem = object({
  id: string(),
  name: string(),
  type: literal("composition", "footage", "folder", "unknown"),
  parentFolderId: nullable(string()),
  compositionId: nullable(string()),
  sourceId: nullable(string()),
});

const interpretation = object({
  nativeFrameRate: optional(number()),
  conformFrameRate: optional(number()),
  displayFrameRate: optional(number()),
  alphaMode: optional(literal("ignore", "straight", "premultiplied")),
  premulColor: optional(map(tuple(number(), number(), number()), ([red, green, blue]): [number, number, number] => [red, green, blue])),
  hasAlpha: optional(boolean()),
  loop: optional(number()),
  pixelAspect: optional(number()),
  fieldSeparationType: optional(literal("off", "upper-field-first", "lower-field-first")),
  invertAlpha: optional(boolean()),
  highQualityFieldSeparation: optional(boolean()),
  removePulldown: optional(string()),
  isStill: optional(boolean()),
});

const source = object({
  id: string(),
  name: string(),
  type: literal("footage", "solid", "placeholder", "unknown"),
  filePath: optional(nullable(string())),
  missing: boolean(),
  width: optional(number()),
  height: optional(number()),
  duration: optional(number()),
  interpretation: optional(interpretation),
});

const MAX_PROBE_NESTING = 40;
const jsonRows = map(array(jsonValueWithin(MAX_PROBE_NESTING)), (rows) => [...rows]);

function checkedRows<T>(row: Decoder<T>): Decoder<JsonValue[]> {
  const checked = array(row);
  return {
    run(input) {
      const rows = jsonRows.run(input);
      if (rows instanceof Failure) return rows;
      const failure = checked.run(rows);
      return failure instanceof Failure ? failure : rows;
    },
  };
}

/** The project items a full read lists, converted for the snapshot. */
export const probeItems = map(array(projectItem), (items) => [...items]);

/** The sources a full read lists, converted for the snapshot. */
export const probeSources = map(array(source), (sources) => sources.map((entry) => ({ ...entry, filePath: entry.filePath ?? null })));

const pages = object({ unread: optional(array(string())), partial: optional(array(string())), oversized: optional(array(string())), capped: optional(boolean()) });

const probeResult = object({
  runtime: probeRuntime,
  project: object({ name: string(), filePath: nullable(string()) }),
  activeCompositionId: nullable(string()),
  selectedLayerIds: array(string()),
  compositions: checkedRows(probeComposition),
  hostStamp: optional(object({ epoch: number(), revision: number() })),
  coverage: optional(coverage),
  revision: optional(string()),
  currentTime: optional(nullable(number())),
  itemCount: optional(number()),
  readScope: optional(object({ compositions: optional(string()), items: optional(string()) })),
  items: optional(checkedRows(projectItem)),
  sources: optional(checkedRows(source)),
  compositionPages: optional(pages),
  interruptedApply: optional(interruptedApply),
  installedEffects: optional(skippingInvalid(installedEffect)),
  inventoryTruncated: optional(boolean()),
  capabilityEnumeration: optional(object({ effects: optional(string()), presets: optional(string()), commands: optional(string()) })),
  truncation: optional(object({ truncated: boolean(), limits: record(string(), number()) })),
});

const probeEnvelope = object({
  schemaVersion: literal(SNAPSHOT_SCHEMA_VERSION),
  ok: literal(true),
  requestId: string({ nonEmpty: true }),
  warnings: array(string()),
  result: probeResult,
});

/**
 * A successful read of the open project as the host reports it, with the members a full or scoped read adds: the host stamp, the coverage of a
 * scoped read, the items and sources of a full one, and the host's own revision and playhead time. Fields the host may leave out are optional.
 * The composition, item and source rows are checked against their row decoders and carried as the JSON the host sent, so a merge moves a row
 * without copying it; the normaliser reads them through the same decoders. The effect rows under `installedEffects` that fail the effect
 * decoder are skipped without rejecting the read, because a host may list an effect it cannot name; a malformed `interruptedApply` reads as
 * absent for the same reason. The blur observation keeps the key order the host writes, because the host compares it serialised.
 */
export type ProbeSnapshot = Infer<typeof probeEnvelope>;

const nestingLimit = jsonValueWithin(MAX_PROBE_NESTING);

/** Decodes a probe snapshot: a successful read of the supported schema from a supported host, nested at most 40 levels deep. */
export const probeSnapshot: Decoder<ProbeSnapshot> = {
  run(input) {
    const bounded = nestingLimit.run(input);
    return bounded instanceof Failure ? bounded : probeEnvelope.run(input);
  },
};
