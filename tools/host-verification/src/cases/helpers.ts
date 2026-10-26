/** Shared builders for verification cases: tokens, text documents and animators. */
import type { JsonObject, JsonValue } from "../json.js";
import type { CaseStep, Check, Fixture, FixtureLayer, LiveCase } from "../types.js";

const T = "ADBE Transform Group";
export const P = { anchor: `${T}/ADBE Anchor Point`, position: `${T}/ADBE Position`, scale: `${T}/ADBE Scale`, rotation: `${T}/ADBE Rotate Z`, opacity: `${T}/ADBE Opacity`, orientation: `${T}/ADBE Orientation` } as const;
export const TEXT_DOC = "ADBE Text Properties/ADBE Text Document";
export const ANIMATOR = (n = 1) => `ADBE Text Properties/ADBE Text Animators/ADBE Text Animator${n > 1 ? `#${n}` : ""}`;
export const SHAPE_ROOT = "ADBE Root Vectors Group";
export const GROUP = (n = 1) => `${SHAPE_ROOT}/ADBE Vector Group${n > 1 ? `#${n}` : ""}`;
export const GROUP_CONTENTS = (n = 1) => `${GROUP(n)}/ADBE Vectors Group`;
export const MASK = (n = 1) => `ADBE Mask Parade/ADBE Mask Atom${n > 1 ? `#${n}` : ""}`;
export const EFFECT = (matchName: string, n = 1) => `ADBE Effect Parade/${matchName}${n > 1 ? `#${n}` : ""}`;

/** Absolute-path placeholder the runner replaces with its output folder. */
export const OUT = "/EXTYNT_OUT_DIR";
export const L = (key: string, extra: { propertyPath?: string; effectPath?: string } = {}) => ({ compositionId: "@comp", layerId: key.startsWith("__new__:") ? key : `@layer:${key}`, ...extra });
export const C = (key?: string) => ({ compositionId: key ? `@comp:${key}` : "@comp" });
export const I = (key: string) => ({ itemId: `@item:${key}` });
export const layer = (key: string, type: FixtureLayer["type"], extra: Partial<FixtureLayer> = {}): FixtureLayer => ({ key, type, name: extra.name ?? key, ...extra });
export const fixture = (...layers: FixtureLayer[]): Fixture => ({ layers });

interface CaseOptions {
  rerun?: boolean | undefined;
  undo?: boolean | undefined;
  external?: boolean | undefined;
  verifies?: string[] | undefined;
  notes?: string | undefined;
  files?: string[] | undefined;
  rerunExpect?: RerunExpectation | undefined;
}
/**
 * "changed": a rerun that alters existing state in place rather than creating anything (guides, ordinal-addressed removals). "same-or-
 * rejected": both an idempotent replay and a refused one are safe; only a replay that mutates or grows state is not.
 */
export type RerunExpectation = "same" | "grows" | "changed" | "rejected" | "same-or-rejected" | "host-ok";
export type CaseWithMeta = LiveCase & {
  files?: string[] | undefined;
  rerunExpect?: RerunExpectation | undefined;
  commandPatches?: Array<{ step: number; operation: number; set: JsonObject }>;
  effect?: { matchName: string; name: string; curated: boolean; hasEvidence: boolean };
};

const isStepList = (operations: CaseOperations): operations is JsonObject[][] => operations.every(Array.isArray);
const stepsOf = (operations: CaseOperations): CaseStep[] =>
  isStepList(operations) ? operations.map((ops) => ({ operations: ops })) : [{ operations: operations }];

export function applied(spec: AppliedSpec): CaseWithMeta {
  const steps = stepsOf(spec.operations);
  const options = spec.options ?? {};
  return { id: spec.id, domain: domainOf(spec.id), title: spec.title, covers: spec.covers, fixture: spec.fixture, steps, expect: spec.expect, outcome: { kind: "applied" }, rerun: options.rerun ?? true, undo: options.undo ?? true, external: options.external, verifies: options.verifies, notes: options.notes, files: options.files, rerunExpect: options.rerunExpect };
}
/** The planner must refuse before anything reaches After Effects. */
export function plannerRejects(spec: PlannerRefusalSpec): CaseWithMeta {
  return { id: spec.id, domain: domainOf(spec.id), title: spec.title, covers: spec.covers, fixture: spec.fixture, steps: [{ operations: spec.operations }], expect: [], outcome: { kind: "planner", code: spec.code }, rerun: false, undo: false, verifies: [], notes: spec.notes };
}
/** A plan the planner accepts, but After Effects must refuse (e.g. an expression that only fails on evaluation). */
export function plannedHostRejects(spec: HostRefusalSpec): CaseWithMeta {
  return { id: spec.id, domain: domainOf(spec.id), title: spec.title, covers: spec.covers, fixture: spec.fixture, steps: [{ operations: spec.operations }], expect: [], outcome: { kind: "host", code: spec.code, mayMutate: spec.options?.mayMutate }, rerun: false, undo: true, verifies: [], notes: spec.options?.notes };
}
/** A malformed command sent straight to the host adapter must be refused without touching the project. */
export function hostRejects(spec: HostRefusalSpec): CaseWithMeta {
  return { id: spec.id, domain: domainOf(spec.id), title: spec.title, covers: spec.covers, fixture: spec.fixture, steps: [{ rawCommand: { operations: spec.operations } }], expect: [], outcome: { kind: "host", code: spec.code, mayMutate: spec.options?.mayMutate }, rerun: false, undo: spec.options?.mayMutate === true, verifies: [], notes: spec.options?.notes };
}

export const approx = (layerRef: string | { name: string }, path: string, expected: number | number[], tolerance = 0.001): Check => ({ kind: "prop", layer: layerRef, path, approx: expected, tolerance });
export const exists = (layerRef: string | { name: string }, path: string, present = true): Check => ({ kind: "prop", layer: layerRef, path, exists: present });
export const children = (layerRef: string | { name: string }, path: string, matchName: string, count: number): Check => ({ kind: "children", layer: layerRef, path, matchName, count });
export const attr = (layerRef: string | { name: string }, field: string, equals: JsonValue): Check => ({ kind: "layer", layer: layerRef, field, equals });
export const attrApprox = (layerRef: string | { name: string }, field: string, expected: number, tolerance = 0.0005): Check => ({ kind: "layer", layer: layerRef, field, approx: expected, tolerance });
export const hostOk = (step = 0): Check => ({ kind: "host", step, ok: true });

const domainOf = (id: string): string => id.split(".")[0] ?? id;

type CaseOperations = JsonObject[] | JsonObject[][];
interface CaseSpec { id: string; covers: string[]; title: string; fixture: Fixture }
interface AppliedSpec extends CaseSpec { operations: CaseOperations; expect: Check[]; options?: CaseOptions }
interface PlannerRefusalSpec extends CaseSpec { operations: JsonObject[]; code: string; notes?: string | undefined }
interface HostRefusalSpec extends CaseSpec { operations: JsonObject[]; code: string; options?: { mayMutate?: boolean | undefined; notes?: string | undefined } }
