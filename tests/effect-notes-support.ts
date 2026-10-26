/** Helpers for the effect-notes tests: control rows, paths, a notes harness, note writers and narrowing of service results. */
import { jsonOf } from '../packages/mcp-server/dist/src/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { EffectNotesService } from '../apps/sidecar/dist/src/effect-notes-service.js';
import { EffectNotesSettings } from '../apps/sidecar/dist/src/effect-notes-settings.js';
import type { CatalogueEffectResult, CatalogueControlRow } from '../apps/sidecar/dist/src/catalogue-page.js';
import type { JsonValue } from '../packages/decode/dist/src/index.js';
import type { NoteFailure, NoteValue, NotesReadResponse } from '../apps/sidecar/dist/src/effect-notes-types.js';
import { ProjectGraphStore } from '../apps/sidecar/dist/src/project-graph-store.js';
import type { HostCensus } from '../apps/sidecar/dist/src/server-types.js';
import { census, censusWith, effectResult, group, HOST_KEY, prop } from './catalogue-support.ts';
import type { ControlRow, GroupRow } from './catalogue-support.ts';

export { HOST_KEY };

export interface LandOptions {
  readonly version?: string;
  readonly effectVersion?: string;
  readonly probe?: boolean | undefined;
}

export interface NotesHarnessOptions extends LandOptions {
  readonly names?: readonly string[];
  readonly categories?: readonly string[];
  readonly controls?: (matchName: string) => ControlRow[];
}

export interface NoteFields {
  readonly text: string | number;
  readonly controlPath?: string | null | undefined;
  readonly value?: NoteValue | string | undefined;
  readonly replaces?: string | undefined;
  readonly reason?: string | undefined;
}

export interface NoteCaps {
  readonly effect: string | undefined;
  readonly control: string | undefined;
}

export interface NotesHarness {
  readonly directory: string;
  readonly clock: { now: number };
  readonly names: readonly string[];
  readonly graph: ProjectGraphStore;
  service: EffectNotesService;
  land(landOptions?: LandOptions): void;
  probe(probed: readonly string[], landOptions?: LandOptions): void;
  optIn(pluginKey?: string, enabled?: boolean): ReturnType<EffectNotesService['setPluginOptIn']>;
  restart(): void;
}

interface HarnessState {
  graph: ProjectGraphStore;
}

/** Narrows a service result to its success shape; fails the test when the service refused. */
export function succeeded<R extends { readonly ok: boolean }>(result: R): Extract<R, { readonly ok: true }> {
  if (!isSuccess(result)) throw new Error(`expected a success, got ${JSON.stringify(result).slice(0, 200)}`);
  return result;
}

function isSuccess<R extends { readonly ok: boolean }>(result: R): result is Extract<R, { readonly ok: true }> {
  return result.ok;
}

/** Narrows a service result to its refusal; fails the test when the service accepted. */
export function refusal<R extends { readonly ok: boolean }>(result: R): Extract<R, { readonly ok: false }> {
  if (!isRefusal(result)) throw new Error(`expected a refusal, got ${JSON.stringify(result).slice(0, 200)}`);
  return result;
}

function isRefusal<R extends { readonly ok: boolean }>(result: R): result is Extract<R, { readonly ok: false }> {
  return !result.ok;
}

/** The value of a lookup that must have found something. */
export function present<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('expected a value');
  return value;
}

/** The refusal's code, or undefined when the result is a success. */
export function codeOf(result: NoteFailure | { readonly ok: true }): string | undefined {
  return result.ok ? undefined : result.code;
}

/** The current notes a stale or capped refusal carries. */
export function currentOf(failure: NoteFailure): NotesReadResponse {
  if (failure.current === undefined) throw new Error('the refusal carries no current notes');
  return failure.current;
}

/** Two value controls and a group row: `Amount` (0..100, default 12) and `Mode`, under `Group`. */
export function glowControls(matchName: string): ControlRow[] {
  return [
    prop(`${matchName}-0001`, { name: 'Amount', defaultValue: 12, hasMin: true, min: 0, hasMax: true, max: 100 }),
    prop(`${matchName}-0002`, { name: 'Radius', defaultValue: 5 }),
    prop(`${matchName}-0003`, { name: 'Gain', defaultValue: 1 }),
    group(`${matchName}-Group`, [prop(`${matchName}-Inner`, { name: 'Inner' })]),
  ];
}

/** The control path of the n-th (1-based) leaf control of `glowControls`. */
export function controlPath(matchName: string, n: number): string { return `${matchName}-000${n}`; }

function censusOf(names: readonly string[], options: NotesHarnessOptions, landOptions: LandOptions): HostCensus {
  const value = census(names, { version: landOptions.version ?? options.version ?? '26.2', effectVersion: landOptions.effectVersion ?? options.effectVersion ?? 'v1' });
  const categories = options.categories;
  return categories ? censusWith(value, { installedEffects: value.result.installedEffects.map((effect, index) => ({ ...effect, category: categories[index] ?? '' })) }) : value;
}

function vectorOrNumber(value: JsonValue): number | number[] | null {
  if (typeof value === 'number') return value;
  if (Array.isArray(value) && value.every(entry => typeof entry === 'number')) return value.flatMap(entry => typeof entry === 'number' ? [entry] : []);
  return null;
}

function numberOrNull(value: JsonValue): number | null {
  return typeof value === 'number' ? value : null;
}

function groupRowOf(row: GroupRow): CatalogueControlRow {
  return { matchName: row.matchName, name: row.name, index: row.index, kind: 'group', childCount: row.childCount, children: row.children.map(catalogueRowOf), valueType: null,
    defaultValue: null, min: null, max: null, units: null, items: null, isDropdown: false, canVary: null, canSetExpression: null, hidden: null };
}

function catalogueRowOf(row: ControlRow): CatalogueControlRow {
  if (row.kind === 'group') return groupRowOf(row);
  return { matchName: row.matchName, name: row.name, index: row.index, kind: 'property', childCount: 0, children: [], valueType: row.valueType,
    defaultValue: vectorOrNumber(row.defaultValue), min: numberOrNull(row.min), max: numberOrNull(row.max), units: row.units ?? null, items: row.items,
    isDropdown: row.isDropdown, canVary: row.canVary, canSetExpression: row.canSetExpression, hidden: row.hidden };
}

/** A probed effect in the shape the graph store writes: the catalogue test builders' control rows, converted. */
export function probeResult(matchName: string, controls: ControlRow[]): CatalogueEffectResult {
  const result = effectResult(matchName, controls);
  return { matchName: result.matchName, displayName: result.displayName, controls: result.controls.map(catalogueRowOf), truncated: result.truncated,
    applyMs: null, createdItems: 0 };
}

interface ProbeContext {
  readonly state: HarnessState;
  readonly harness: NotesHarness;
  readonly options: NotesHarnessOptions;
}

function probeOf(context: ProbeContext, probed: readonly string[], landOptions: LandOptions): void {
  const { state, harness, options } = context;
  harness.clock.now += 1;
  const hostKey = `After Effects:${landOptions.version ?? options.version ?? '26.2'}:macOS`;
  const result = state.graph.writeCatalogueProbe(probed.map(name => ({ hostKey, runId: `run-${harness.clock.now}`, observedAt: harness.clock.now, hostBuild: '2', version: landOptions.effectVersion ?? options.effectVersion ?? 'v1', effect: probeResult(name, (options.controls ?? glowControls)(name)) })));
  if (result.failed.length) throw new Error(JSON.stringify(result.failed));
}

/** A real host-catalogue file in a temporary state directory, with a census landed and every effect probed, and the notes service over it. */
export function notesHarness(t: TestContext, options: NotesHarnessOptions = {}): NotesHarness {
  const directory = mkdtempSync(join(tmpdir(), 'extynt-notes-'));
  const names = options.names ?? ['ADBE Glo2', 'ADBE Blur'], clock = { now: 1000 }, state: HarnessState = { graph: new ProjectGraphStore(directory) };
  const build = () => new EffectNotesService({ graph: state.graph, settings: new EffectNotesSettings(directory), now: () => clock.now });
  const harness: NotesHarness = {
    directory, clock, names, get graph() { return state.graph; }, service: build(),
    land(landOptions = {}) {
      clock.now += 10;
      state.graph.observeCensus(censusOf(names, options, landOptions), clock.now);
      if (landOptions.probe !== false) harness.probe(names, landOptions);
    },
    probe(probed, landOptions = {}) { probeOf({ state, harness, options }, probed, landOptions); },
    optIn(pluginKey = 'Synthetic', enabled = true) { return harness.service.setPluginOptIn({ pluginKey, enabled }); },
    restart() { state.graph.close(); state.graph = new ProjectGraphStore(directory); harness.service = build(); },
  };
  harness.land({ probe: options.probe });
  t.after(() => { state.graph.close(); rmSync(directory, { recursive: true, force: true }); });
  return harness;
}

/** The successful read of an effect's notes, optionally narrowed to one control. */
export function readNotes(harness: NotesHarness, matchName: string, controlPathFilter?: string): NotesReadResponse {
  return succeeded(harness.service.read(controlPathFilter === undefined ? { matchName } : { matchName, controlPath: controlPathFilter }));
}

/** An event record whose kind is any string: the shape of a record that has not been checked yet. */
export interface UncheckedKeptEvent {
  readonly planId: string;
  readonly kind: string;
  readonly name: string;
}

/** A kept control value record whose value may be any text or number: the shape of a record that has not been checked yet. */
export interface UncheckedKeptUsage {
  readonly planId: string;
  readonly matchName: string;
  readonly controlPath: string;
  readonly value: NoteValue | string;
}

/** The service seen through methods that take records it must refuse; method parameters are bivariant, so the wider parameter is accepted. */
export interface UncheckedKeptRecorder {
  recordKeptUsage(input: UncheckedKeptUsage | readonly UncheckedKeptUsage[]): ReturnType<EffectNotesService['recordKeptUsage']>;
  recordKeptEvents(input: UncheckedKeptEvent | readonly UncheckedKeptEvent[]): ReturnType<EffectNotesService['recordKeptEvents']>;
}

/** The service as a recorder of unchecked event records. */
export function uncheckedRecorder(service: EffectNotesService): UncheckedKeptRecorder {
  return service;
}

/** Writes through the service with the effect's current ids, the way an agent that just read would. */
export function writeNote(harness: NotesHarness, matchName: string, fields: NoteFields): ReturnType<EffectNotesService['write']> {
  const current = harness.service.read({ matchName });
  return harness.service.write(jsonOf({ matchName, expectedNoteIds: current.ok ? current.noteIds : undefined, ...fields }));
}

function applyEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
}

/** Sets EXTYNT_NOTES_* for the rest of one test. */
export function withCaps(t: TestContext, caps: Partial<NoteCaps>): void {
  const saved = { effect: process.env.EXTYNT_NOTES_PER_EFFECT, control: process.env.EXTYNT_NOTES_PER_CONTROL };
  applyEnv('EXTYNT_NOTES_PER_EFFECT', caps.effect); applyEnv('EXTYNT_NOTES_PER_CONTROL', caps.control);
  t.after(() => { applyEnv('EXTYNT_NOTES_PER_EFFECT', saved.effect); applyEnv('EXTYNT_NOTES_PER_CONTROL', saved.control); });
}
