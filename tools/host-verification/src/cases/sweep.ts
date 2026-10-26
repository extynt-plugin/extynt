/** The effect sweep: which controls each swept effect is expected to expose. */
import { BASE_CATALOGUE, DIALOG_EFFECTS, EFFECT_HOST_CAVEATS, type Capability, type EffectProbeEvidence, type EffectProbeRow } from "@extynt/capability-catalogue";
import type { Check, PropEntry, ReadbackView } from "../types.js";
import { EFFECT, L, applied, fixture, layer, plannedHostRejects, type CaseWithMeta, type RerunExpectation } from "./helpers.js";
import { loadFixtureEffectEvidence } from "@extynt/capability-catalogue/test-evidence";

export const EFFECT_SWEEP_PREFIX = "effects.sweep.";
type Effects = EffectProbeEvidence["effects"];
const EVIDENCE_ROW_CAP = 96;
const segment = (matchName: string) => matchName.split("/").join("%2F");
const effectRoot = (matchName: string) => `ADBE Effect Parade/${segment(matchName)}`;
const PROBE_VALUE_TYPES = new Set(["OneD", "TwoD", "TwoD_SPATIAL", "ThreeD", "ThreeD_SPATIAL", "COLOR", "LAYER_INDEX", "MASK_INDEX", "CUSTOM_VALUE", "NO_VALUE", "SHAPE", "TEXT_DOCUMENT", "MARKER"]);

interface ExpectedControl { path: string; matchName: string; name: string; group: boolean; valueType: string | null; min?: number; max?: number }
const controlName = (row: EffectProbeRow): string => String(row.n ?? "");
const groupControl = (path: string, matchName: string, row: EffectProbeRow): ExpectedControl => ({
  path,
  matchName,
  name: controlName(row),
  group: true,
  valueType: null,
});
function leafControl(path: string, matchName: string, row: EffectProbeRow): ExpectedControl {
  const valueType = row.t && PROBE_VALUE_TYPES.has(String(row.t)) ? String(row.t) : null;
  return { path, matchName, name: controlName(row), group: false, valueType, ...(typeof row.min === "number" ? { min: row.min } : {}), ...(typeof row.max === "number" ? { max: row.max } : {}) };
}

interface ControlWalk { rows: readonly EffectProbeRow[]; index: number; out: ExpectedControl[] }
function visitControls(walk: ControlWalk, prefix: string, budget: number): void {
  const seen = new Map<string, number>();
  for (let visited = 0; visited < budget && walk.index < walk.rows.length; visited += 1) {
    const row = walk.rows[walk.index];
    if (!row) break;
    walk.index += 1;
    const matchName = String(row.m ?? "");
    const ordinal = (seen.get(matchName) ?? 0) + 1; seen.set(matchName, ordinal);
    const path = `${prefix}/${segment(matchName)}${ordinal > 1 ? `#${ordinal}` : ""}`;
    if (typeof row.g === "number") { walk.out.push(groupControl(path, matchName, row)); visitControls(walk, path, row.g); continue; }
    walk.out.push(leafControl(path, matchName, row));
  }
}

/** Flatten probe evidence rows (depth-first with group child counts) into exact dump paths. */
export function expectedControls(effectMatchName: string, rows: readonly EffectProbeRow[]): ExpectedControl[] {
  const walk: ControlWalk = { rows, index: 0, out: [] };
  visitControls(walk, effectRoot(effectMatchName), Number.POSITIVE_INFINITY);
  return walk.out;
}

const isPseudo = (control: ExpectedControl): boolean => control.matchName.startsWith("Pseudo/");
/**
 * AE's own per-effect rows (Masks, Effect Opacity, GPU Rendering): which of them a readback enumerates differs by platform and build, so
 * neither their presence nor their absence says anything about the effect's controls.
 */
export const COMMON_EFFECT_ROWS: ReadonlySet<string> = new Set(["ADBE Effect Mask Parade", "ADBE Effect Mask Opacity", "ADBE Force CPU GPU"]);
const isCommonRowPath = (path: string, root: string): boolean => path.slice(root.length + 1).split("/").some((part) => COMMON_EFFECT_ROWS.has(part.replace(/#\d+$/, "").split("%2F").join("/")));
const DYNAMIC_GROUPS: ReadonlySet<string> = new Set(["ADBE FreePin3 Outlines", "ADBE FreePin3 Mesh Group"]);
const isPositionalSegment = (part: string): boolean => part.startsWith("%2F");
const isDynamicRowPath = (path: string, root: string): boolean => path.slice(root.length + 1).split("/").some((part) => isPositionalSegment(part) || DYNAMIC_GROUPS.has(part.replace(/#\d+$/, "").split("%2F").join("/")));
const isMenuRange = (control: ExpectedControl): boolean => control.min === 1 && typeof control.max === "number" && Number.isInteger(control.max);
const minDrift = (control: ExpectedControl, entry: PropEntry): string[] =>
  control.min !== undefined && typeof entry.min === "number" && Math.abs(entry.min - control.min) > Math.max(1e-6, Math.abs(control.min) * 1e-6)
    ? [`${control.matchName} min ${control.min} -> ${entry.min}`]
    : [];
const maxDrift = (control: ExpectedControl, entry: PropEntry): string[] =>
  control.max !== undefined && typeof entry.max === "number" && Math.abs(entry.max - control.max) > Math.max(1e-6, Math.abs(control.max) * 1e-6)
    ? [`${control.matchName} max ${control.max} -> ${entry.max}`]
    : [];
const rangeProblems = (control: ExpectedControl, entry: PropEntry): string[] =>
  isMenuRange(control) ? [] : [...minDrift(control, entry), ...maxDrift(control, entry)];

interface LiveControl { path: string; entry: PropEntry }
function liveControls(view: ReadbackView, layerId: string, root: string): LiveControl[] {
  return Object.entries(view.sections.props).filter(([key, entry]) => entry && key.startsWith(`${layerId}|${root}/`)).flatMap(([key, entry]) => (entry ? [{ path: key.slice(layerId.length + 1), entry }] : []));
}

function controlProblems(view: ReadbackView, layerId: string, root: string, control: ExpectedControl): string[] {
  const entry = view.sections.props[`${layerId}|${control.path}`];
  if (!entry) return [`missing control ${control.path.slice(root.length + 1)} (${control.name})`];
  if (control.group !== (entry.pt !== "P")) return [`${control.matchName} changed between group and property`];
  const problems: string[] = [];
  if (!control.group && control.valueType && entry.vt && entry.vt !== control.valueType) problems.push(`${control.matchName} value type ${control.valueType} -> ${entry.vt}`);
  problems.push(...rangeProblems(control, entry));
  return problems;
}

function extraControlDrift(live: LiveControl[], expected: readonly ExpectedControl[], root: string): string[] {
  const expectedPaths = new Set(expected.filter((control) => !isPseudo(control)).map((control) => control.path));
  const extras = live.filter((row) => !expectedPaths.has(row.path) && !row.path.includes("/Pseudo%2F") && !isCommonRowPath(row.path, root) && !isDynamicRowPath(row.path, root)).map((row) => row.path);
  const drift: string[] = [];
  if (extras.length && expected.length < EVIDENCE_ROW_CAP) drift.push(`controls not in evidence: ${extras.slice(0, 8).map((path) => path.slice(root.length + 1)).join(", ")}${extras.length > 8 ? ` (+${extras.length - 8})` : ""}`);
  const pseudoCount = expected.filter(isPseudo).length, livePseudo = live.filter((row) => row.path.includes("/Pseudo%2F")).length;
  if (pseudoCount && expected.length < EVIDENCE_ROW_CAP && livePseudo !== pseudoCount) drift.push(`pseudo control count ${pseudoCount} -> ${livePseudo}`);
  return drift;
}

/** Compare the live control tree of one effect against probe evidence; returns human-readable drift, empty when identical. */
export function controlTreeDrift(view: ReadbackView, layerRef: string, effectMatchName: string, expected: readonly ExpectedControl[]): string[] {
  const layerId = view.layerId(layerRef); if (!layerId) return ["fixture layer missing"];
  const root = effectRoot(effectMatchName), live = liveControls(view, layerId, root), drift: string[] = [];
  for (const control of expected) {
    if (isPseudo(control) || isCommonRowPath(control.path, root) || isDynamicRowPath(control.path, root)) continue;
    drift.push(...controlProblems(view, layerId, root, control));
  }
  drift.push(...extraControlDrift(live, expected, root));
  return drift;
}

/** Catalogue entries typed as effects that are really layer property groups; they are not in app.effects and cannot be added. */
export const LAYER_PROPERTY_GROUPS: ReadonlySet<string> = new Set(["ADBE AV Layer", "ADBE Audio Levels", "ADBE Camera Layer", "ADBE Light Layer", "ADBE Mask Parade", "ADBE Root Vectors Group", "ADBE Text Properties", "ADBE Transform Group"]);

const SELF_RENAMING_EFFECTS: Record<string, string> = { "ISL MochaShapeImporter": "renames its own effect instance after it is added, so its display name is not stable; address it by match name." };

/**
 * Effects that open a modal dialog when added, so an unattended run would stall on them: the catalogue's curated dialog list plus the plug-in
 * seen holding a live run (mocha AE). They are checked from the catalogue probe only and never applied.
 */
export const DIALOG_ON_APPLY: ReadonlySet<string> = new Set(Object.keys(DIALOG_EFFECTS));
const isTestFixtureEffect = (matchName: string): boolean => matchName.startsWith("FXV ");

const EFFECT_CAPABILITIES = BASE_CATALOGUE.capabilities.filter((capability): capability is Capability & { matchName: string } => capability.kind === "effect" && !!capability.matchName && !LAYER_PROPERTY_GROUPS.has(capability.matchName));

function effectChecks(name: string, matchName: string, rows: EffectProbeRow[] | undefined): Check[] {
  const checks: Check[] = [{ kind: "children", layer: "top", path: "ADBE Effect Parade", matchName, count: 1 }];
  if (rows?.length) {
    const expected = expectedControls(matchName, rows);
    checks.push({ kind: "custom", describe: `${name} control tree matches AE 26.2.1 probe evidence (${expected.length} rows)`, check: (view) => { const drift = controlTreeDrift(view, "top", matchName, expected); return drift.length ? drift.join("; ") : undefined; } });
  }
  return checks;
}

const effectName = (matchName: string, evidence: Effects, capability: (Capability & { matchName: string }) | undefined): string =>
  capability?.displayName ?? evidence[matchName]?.name ?? matchName;
const evidenceNote = (rows: EffectProbeRow[] | undefined): string | undefined =>
  rows ? undefined : "No probe evidence; the report records the live control tree for the catalogue.";

function sweepOptions(
  renames: string | undefined,
  rows: EffectProbeRow[] | undefined,
): { verifies: string[]; rerunExpect: RerunExpectation | undefined; notes: string | undefined } {
  return { verifies: [], rerunExpect: renames ? "host-ok" : undefined, notes: renames ?? evidenceNote(rows) };
}

function effectSweepCase(matchName: string, curated: Map<string, Capability & { matchName: string }>, evidence: Effects): CaseWithMeta {
  const capability = curated.get(matchName), rows = evidence[matchName]?.controls, name = effectName(matchName, evidence, capability);
  const operation = { type: "ensure_effect", target: L("top", { effectPath: EFFECT(matchName) }), capabilityId: capability ? capability.id : `host:${matchName}`, effectMatchName: matchName, effectPath: EFFECT(matchName) };
  const id = `${EFFECT_SWEEP_PREFIX}${matchName}`;
  const caveat = EFFECT_HOST_CAVEATS[matchName];
  if (caveat) return { ...plannedHostRejects({ id: id, covers: ["ensure_effect"], title: `${name} cannot be added unattended`, fixture: fixture(layer("top", "solid")), operations: [operation], code: caveat.code }), outcome: { kind: "planner" as const, code: caveat.code }, notes: caveat.message };
  if (DIALOG_ON_APPLY.has(matchName)) return { ...plannedHostRejects({ id, covers: ["ensure_effect"], title: `${name} opens a dialog when added; checked without applying`, fixture: fixture(layer("top", "solid")), operations: [operation], code: "EFFECT_DIALOG_CANCELLED" }), outcome: { kind: "dialog" as const }, notes: `Opens a modal dialog when added, so it is never applied unattended; its control tree comes from the catalogue probe${rows ? ` (${rows.length} rows)` : " (no probe rows)"} only.`, effect: { matchName, name, curated: !!capability, hasEvidence: !!rows } };
  const options = sweepOptions(SELF_RENAMING_EFFECTS[matchName], rows);
  return { ...applied({ id: id, covers: ["ensure_effect"], title: `Add ${name} and read back its control tree`, fixture: fixture(layer("top", "solid", { name: "Effect host" })), operations: [operation], expect: effectChecks(name, matchName, rows), options }), effect: { matchName, name, curated: !!capability, hasEvidence: !!rows } };
}

/** One case per catalogued or evidence-backed effect: add it through ensure_effect, read the control tree, compare with evidence. */
export function effectSweepCases(): CaseWithMeta[] {
  const evidence = loadFixtureEffectEvidence()?.effects ?? {};
  const curated = new Map<string, Capability & { matchName: string }>(EFFECT_CAPABILITIES.map((capability) => [capability.matchName, capability]));
  const matchNames = [...new Set([...Object.keys(evidence), ...curated.keys()])].filter((matchName) => !isTestFixtureEffect(matchName)).sort();
  return matchNames.map((matchName) => effectSweepCase(matchName, curated, evidence));
}
