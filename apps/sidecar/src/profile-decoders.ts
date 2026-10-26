/** Decoders for the three JSON files the profile store reads back: the host capability profile, the effect control probe evidence, and the runtime operation evidence. */
import { array, boolean, type Decoder, fallback, type Infer, literal, map, nullable, nullValue, number, object, skippingInvalidRecord, string, union } from "@extynt/decode";
import { legacyHostCapabilityProfile, type EffectProbeEvidence, type EffectProbeRow } from "@extynt/capability-catalogue";
import { opaque } from "./snapshot-view.js";

type RuntimeEntry = { count: number; lastVerifiedAt: string; hostVersion: string; lastFailedAt?: string; failures?: number; lastFailureBasis?: string };

/** Per-host record of plan types a live receipt verified exactly; never contains project data. */
export interface RuntimeEvidenceFile { schemaVersion: "0.1"; hosts: Record<string, Record<string, RuntimeEntry>>; }

/** Accepts a stored host profile, including one written before fonts were inventoried; every entry is decoded, so a malformed profile reads as absent. */
export const legacyHostProfile = legacyHostCapabilityProfile;

const probeRowFields = object({
  m: fallback(string(), undefined), n: fallback(string(), undefined), t: fallback(nullable(string()), undefined), v: opaque, min: fallback(number(), undefined), max: fallback(number(), undefined),
  dd: fallback(boolean(), undefined), items: fallback(nullable(map(array(string()), (items) => [...items])), undefined), static: fallback(boolean(), undefined), hid: fallback(boolean(), undefined), g: fallback(number(), undefined),
});

function present<Key extends keyof EffectProbeRow>(key: Key, value: EffectProbeRow[Key] | undefined): Partial<Record<Key, EffectProbeRow[Key]>> {
  const field: Partial<Record<Key, EffectProbeRow[Key]>> = {};
  if (value !== undefined) field[key] = value;
  return field;
}

function probeRow(fields: Infer<typeof probeRowFields>): EffectProbeRow {
  return {
    ...present("m", fields.m), ...present("n", fields.n), ...present("t", fields.t), ...present("v", fields.v), ...present("min", fields.min), ...present("max", fields.max),
    ...present("dd", fields.dd), ...present("items", fields.items), ...present("static", fields.static), ...present("hid", fields.hid), ...present("g", fields.g),
  };
}

const probeRows = fallback(map(array(fallback(probeRowFields, undefined)), (rows) => rows.flatMap((row) => (row ? [probeRow(row)] : []))), undefined);
const probeEffect = object({ name: fallback(string(), undefined), category: fallback(string(), undefined), controls: probeRows });

function effectEntry(effect: Infer<typeof probeEffect>): EffectProbeEvidence["effects"][string] {
  return { ...(effect.name !== undefined ? { name: effect.name } : {}), ...(effect.category !== undefined ? { category: effect.category } : {}), ...(effect.controls ? { controls: effect.controls } : {}) };
}

const probeEvidenceShape = object({
  host: fallback(object({ version: union(string(), nullValue) }), undefined),
  effects: map(skippingInvalidRecord(probeEffect), (effects) => Object.fromEntries(Object.entries(effects).map(([name, effect]) => [name, effectEntry(effect)]))),
});

/** Reads the effect control probe file leniently: a bad row, control list or effect is dropped, and only a missing effects table rejects the file. */
export const effectProbeEvidence: Decoder<EffectProbeEvidence> = map(probeEvidenceShape, (shape) => ({ ...(shape.host ? { host: shape.host } : {}), effects: shape.effects }));

const runtimeEntryShape = object({ count: number(), lastVerifiedAt: string(), hostVersion: string(), lastFailedAt: fallback(string(), undefined), failures: fallback(number(), undefined), lastFailureBasis: fallback(string(), undefined) });

function runtimeEntry(shape: Infer<typeof runtimeEntryShape>): RuntimeEntry {
  return {
    count: shape.count, lastVerifiedAt: shape.lastVerifiedAt, hostVersion: shape.hostVersion,
    ...(shape.lastFailedAt !== undefined ? { lastFailedAt: shape.lastFailedAt } : {}),
    ...(shape.failures !== undefined ? { failures: shape.failures } : {}),
    ...(shape.lastFailureBasis !== undefined ? { lastFailureBasis: shape.lastFailureBasis } : {}),
  };
}

const runtimeHost = skippingInvalidRecord(map(runtimeEntryShape, runtimeEntry));

/** Reads the runtime operation evidence file, dropping malformed hosts and entries while keeping the rest. */
export const runtimeEvidence: Decoder<RuntimeEvidenceFile> = map(
  object({ schemaVersion: literal("0.1"), hosts: skippingInvalidRecord(runtimeHost) }),
  (shape): RuntimeEvidenceFile => ({ schemaVersion: "0.1", hosts: shape.hosts }),
);
