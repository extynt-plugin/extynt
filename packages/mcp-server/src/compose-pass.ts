// The state one composition pass carries: the placeholder tables it fills, the ids its declaration
// pre-pass pins, and the refusal shape its stages speak in.
import type { ActionPlanV2Operation } from "@extynt/action-plan";
import type { ProjectSnapshot } from "@extynt/project-graph";
import { asObject, objectAt, stringAt } from "./json.js";
import type { JsonObject, JsonValue } from "@extynt/decode";
import type { OperationFields } from "./operation-fields.js";
import { operationOf } from "./operations.js";
import { CANONICAL_FIELDS, CANONICAL_PREFIX, DECLARES } from "./placeholders.js";

/** A refusal carries the exact code and message the tool returns; nothing is translated on the way out. */
export interface Refusal {
  code: string;
  message: string;
}

/** A stage's value, or the refusal that stops the pass. */
export type Resolved<T> = { ok: true; value: T } | { ok: false; refusal: Refusal };

/** A failed stage carrying the given code and message. */
export function refusal(code: string, message: string): { ok: false; refusal: Refusal } {
  return { ok: false, refusal: { code, message } };
}

/** The caller's own vocabulary for a plan: the placeholder names it wrote, the canonical ids it pinned and the job it belongs to. */
export interface ComposeSeed {
  names?: Readonly<Record<string, string>>;
  canonicalAt?: Readonly<Record<number, string>>;
  forwardReferences?: boolean;
  jobId?: string;
}

/** A new layer's placeholder: the layer it names and the composition that layer lives in. */
export interface LayerPlaceholder {
  compositionId: string;
  layerId: string;
}

interface ScopedPlaceholder extends LayerPlaceholder {
  id: string;
}

/** The placeholder tables one composition pass fills: one map per kind of object a plan declares. */
export interface PlaceholderMaps {
  compositions: Map<string, string>;
  layers: Map<string, LayerPlaceholder>;
  items: Map<string, string>;
  masks: Map<string, ScopedPlaceholder>;
  shapes: Map<string, ScopedPlaceholder>;
  animators: Map<string, ScopedPlaceholder>;
  shapeItems: Map<string, ScopedPlaceholder>;
}

/** Everything one pass reads and everything it accumulates, shared by the walk and every family handler. */
export interface ComposePass {
  rawOperations: readonly JsonValue[];
  snapshot: ProjectSnapshot;
  seed: ComposeSeed;
  forwardPlaceholders: boolean;
  maps: PlaceholderMaps;
  preBound: Set<string>;
  operations: ActionPlanV2Operation[];
  totalKeyframes: number;
  maxExpressionLength: number;
}

/** The outcome of one family handler: it owned the operation, refused it, or left it to the next family. */
export type FamilyOutcome = { kind: "done" } | { kind: "error"; error: Refusal };

/** The refusal as the outcome a family handler returns. */
export function refused(problem: Refusal): FamilyOutcome {
  return { kind: "error", error: problem };
}

/** Keeps the operation in the plan and reports it handled. */
export function storeOperation(pass: ComposePass, candidate: OperationFields): FamilyOutcome {
  const operation = operationOf(candidate);
  if (!operation) return refused({ code: "INVALID_ARGUMENT", message: "Each operation needs a type." });
  pass.operations.push(operation);
  return { kind: "done" };
}

/** Pins the operation to the snapshot the plan was composed against. */
export function stampFingerprints(pass: ComposePass, candidate: OperationFields): void {
  Object.assign(candidate, { snapshotFingerprint: pass.snapshot.fingerprint, selectionFingerprint: pass.snapshot.selectionFingerprint });
}

/** A target made of the given fields and the snapshot's fingerprints. */
export function stampedTarget(pass: ComposePass, fields: JsonObject): JsonObject {
  return { ...fields, snapshotFingerprint: pass.snapshot.fingerprint, selectionFingerprint: pass.snapshot.selectionFingerprint };
}

/** The string at `key` when it names a placeholder the caller declared, otherwise `undefined`. */
export function placeholderAt(object: JsonObject, key: string): string | undefined {
  const value = stringAt(object, key);
  return value?.startsWith(CANONICAL_PREFIX) ? value : undefined;
}

type PlaceholderTable = keyof PlaceholderMaps;

const DECLARED_TABLES: Readonly<Record<string, PlaceholderTable>> = {
  create_composition: "compositions", duplicate_composition: "compositions", precompose_layers: "compositions",
  create_layer: "layers", duplicate_layer: "layers", derive_layer: "layers",
  create_folder: "items", import_file: "items", create_vector_artwork: "items",
  add_mask: "masks", create_shape_group: "shapes", add_text_animator: "animators", add_shape_item: "shapeItems",
};

function bindPlaceholder(maps: PlaceholderMaps, type: string, name: string, canonical: string): void {
  const table = DECLARED_TABLES[type];
  if (table === "compositions" || table === "items") maps[table].set(name, canonical);
  else if (table === "layers") maps.layers.set(name, { compositionId: "", layerId: canonical });
  else if (table) maps[table].set(name, { compositionId: "", layerId: "", id: canonical });
}

function emptyPlaceholderMaps(): PlaceholderMaps {
  return {
    compositions: new Map(), layers: new Map(), items: new Map(),
    masks: new Map(), shapes: new Map(), animators: new Map(), shapeItems: new Map(),
  };
}

/** A canonical placeholder resolves through its table; a real host id passes through unchanged. */
export function mappedPlaceholder(placeholders: ReadonlyMap<string, string>, id: string): string | undefined {
  if (!id.startsWith(CANONICAL_PREFIX)) return id;
  return placeholders.get(id);
}

/** Whether an id names a placeholder this pass may still resolve. */
export function isPlaceholderId<T>(placeholders: ReadonlyMap<string, T>, id: string): boolean {
  return id.startsWith(CANONICAL_PREFIX) || placeholders.has(id);
}

function impliedCompositionId(pass: ComposePass): string {
  const active = pass.snapshot.activeCompositionId;
  if (active) return active;
  const declared = [...new Set(pass.maps.compositions.values())];
  return declared.length === 1 ? (declared[0] ?? "") : "";
}

/** The plan-wide declaration number of an operation, counted over the declaring fields before it. */
export function declarationNumberOf(operations: readonly JsonValue[], index: number): number {
  let declarations = 0;
  for (const raw of operations.slice(0, index)) declarations += (DECLARES[stringAt(asObject(raw), "type") ?? ""] ?? []).length;
  return declarations;
}

function createdComposition(pass: ComposePass, index: number): { id: string; description: string } | undefined {
  const operation = asObject(pass.rawOperations[index]);
  if (stringAt(operation, "type") !== "create_composition") return undefined;
  const callerId = stringAt(operation, "newCompositionId");
  const number = declarationNumberOf(pass.rawOperations, index);
  const id = callerId?.startsWith(CANONICAL_PREFIX) ? callerId : (pass.seed.canonicalAt?.[number] ?? `${CANONICAL_PREFIX}comp${number}`);
  return { id, description: `"${stringAt(operation, "name") ?? id}" (${id})` };
}

function createdCompositions(pass: ComposePass): Array<{ id: string; description: string }> {
  return pass.rawOperations.flatMap((_, index) => createdComposition(pass, index) ?? []);
}

function ambiguousComposition(pass: ComposePass, input: { index: number; type: string }, created: Array<{ id: string; description: string }>): Refusal {
  const activeId = pass.snapshot.activeCompositionId ?? "";
  const activeName = pass.snapshot.compositions.find((composition) => composition.id === activeId)?.name ?? activeId;
  const newIds = created.map((entry) => `"${entry.id}"`).join(" or ");
  const described = created.map((entry) => entry.description).join(", ");
  return {
    code: "AMBIGUOUS_COMPOSITION",
    message: `Operation ${input.index} (${input.type}) does not name a composition, and this plan creates ${described} while "${activeName}" ("${activeId}") is open, so a missing compositionId could mean either. Set target.compositionId to ${newIds} for the new composition, or "${activeId}" for the open one. Name it once on create_layer: later operations on that layer use that layer's composition.`,
  };
}

/** Resolve the target composition when omitted. Resolution order: layer inheritance from a bound layer
 * if the operation is not create_layer, ambiguity refusal if the plan creates compositions and an active
 * composition is set, or fallback to the active composition or the only declared one. */
export function impliedComposition(pass: ComposePass, input: { index: number; type: string; layerId?: string | undefined }): Resolved<string> {
  const inherited = input.type !== "create_layer" && input.layerId ? pass.maps.layers.get(input.layerId)?.compositionId : undefined;
  if (inherited) return { ok: true, value: inherited };
  const created = pass.snapshot.activeCompositionId ? createdCompositions(pass) : [];
  if (created.length > 0) return { ok: false, refusal: ambiguousComposition(pass, input, created) };
  return { ok: true, value: impliedCompositionId(pass) };
}

function bindSeedNames(pass: ComposePass): void {
  for (const [name, canonical] of Object.entries(pass.seed.names ?? {})) {
    const kind = name.slice(CANONICAL_PREFIX.length).replace(/\d+$/, "");
    if (kind === "comp") pass.maps.compositions.set(name, canonical);
    else if (kind === "folder" || kind === "item") pass.maps.items.set(name, canonical);
  }
}

function writtenDeclaration(operation: JsonObject, path: string): string | undefined {
  const [head = "", tail] = path.split(".");
  const value = tail === undefined ? undefined : objectAt(operation, head)?.[tail];
  return typeof value === "string" && value.startsWith(CANONICAL_PREFIX) ? value : undefined;
}

interface DeclaredField {
  type: string;
  path: string;
  declaration: number;
}

function canonicalDeclaration(pass: ComposePass, field: DeclaredField, written: string | undefined): string {
  const named = written ? pass.seed.names?.[written] : undefined;
  const kind = CANONICAL_FIELDS[field.type]?.[field.path] ?? "object";
  return named || pass.seed.canonicalAt?.[field.declaration] || `${CANONICAL_PREFIX}${kind}${field.declaration}`;
}

function bindDeclaration(pass: ComposePass, operation: JsonObject, field: DeclaredField): void {
  const written = writtenDeclaration(operation, field.path);
  const canonical = canonicalDeclaration(pass, field, written);
  bindPlaceholder(pass.maps, field.type, canonical, canonical);
  pass.preBound.add(canonical);
  if (written && written !== canonical) bindPlaceholder(pass.maps, field.type, written, canonical);
}

function bindDeclaredPlaceholders(pass: ComposePass): void {
  let declaration = 0;
  for (const raw of pass.rawOperations) {
    const operation = asObject(raw);
    if (!operation) continue;
    const type = stringAt(operation, "type") ?? "";
    for (const path of DECLARES[type] ?? []) {
      bindDeclaration(pass, operation, { type, path, declaration });
      declaration += 1;
    }
  }
}

/** Opens one composition pass: the placeholder tables, the caller's seed names, then the ids every
 *  declaration pins before the walk starts. */
export function beginComposePass(rawOperations: readonly JsonValue[], snapshot: ProjectSnapshot, seed: ComposeSeed): ComposePass {
  const pass: ComposePass = {
    rawOperations, snapshot, seed, forwardPlaceholders: seed.forwardReferences === true,
    maps: emptyPlaceholderMaps(), preBound: new Set(), operations: [], totalKeyframes: 0, maxExpressionLength: 0,
  };
  bindSeedNames(pass);
  bindDeclaredPlaceholders(pass);
  return pass;
}
