// The local preference tally: how often the user kept, undid or swapped an effect, a font, an effect control or a transform property, kept in a small owner-only file beside the other per-user state; scored with a 30-day half-life and handed to the decisions as habits.
import { array, decodeJson, object, record, string } from "@extynt/decode";
import type { Habits } from "@extynt/decide";
import { preferenceKey, preferenceScores, preferenceStore, preferenceSummary, recordSignal, type PreferenceStore } from "@extynt/decide";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FILE = "preference-tally.json";
const MAX_PLANS = 200;
const MAX_KEYS = 2000;

const stored = object({ store: preferenceStore, plans: record(string(), array(string())) });

/** What the tally reads of a plan's operations: effects added, effects taken off, a font written, an effect control written (as `effect/control`) and a transform property written (by its role). */
export interface TallyOperation {
  readonly type: string;
  readonly effectMatchName?: string;
  readonly removedEffect?: string;
  readonly font?: string;
  readonly control?: string;
  readonly property?: string;
}

function usedKeys(operations: ReadonlyArray<TallyOperation>, added: ReadonlyArray<string>): string[] {
  const kinds = [["font", "font"], ["control", "control"], ["property", "property"]] as const;
  const others = kinds.flatMap(([kind, field]) => operations.flatMap((operation) => { const name = operation[field]; return name === undefined ? [] : [preferenceKey(kind, name)]; }));
  return [...added.map((name) => preferenceKey("effect", name)), ...others];
}

function keysOf(operations: ReadonlyArray<TallyOperation>): { readonly used: string[]; readonly replaced: string[] } {
  const added = operations.flatMap((operation) => (operation.effectMatchName === undefined ? [] : [operation.effectMatchName]));
  const used = usedKeys(operations, added);
  const replaced = operations.flatMap((operation) => (operation.removedEffect !== undefined && added.length > 0 && !added.includes(operation.removedEffect) ? [preferenceKey("effect", operation.removedEffect)] : []));
  return { used: [...new Set(used)], replaced: [...new Set(replaced)] };
}

type HabitKind = "effect" | "font" | "control" | "property";

/** The user's habits: uses, undos and swaps per effect, font, control and transform property, learned only from plans that were applied and not taken back. */
export class PreferenceTally {
  private state: { store: PreferenceStore; plans: Record<string, readonly string[]> } | undefined;

  constructor(private readonly directory: string, private readonly now: () => number, private readonly enabled: () => boolean) {}

  private path(): string {
    return join(this.directory, FILE);
  }

  private loaded(): { store: PreferenceStore; plans: Record<string, readonly string[]> } {
    if (this.state !== undefined) return this.state;
    const fresh = { store: {}, plans: {} };
    try {
      const decoded = decodeJson(readFileSync(this.path(), "utf8"), stored);
      this.state = decoded.ok ? { store: decoded.value.store, plans: { ...decoded.value.plans } } : fresh;
    } catch {
      this.state = fresh;
    }
    return this.state;
  }

  private save(): void {
    try {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      const temporary = `${this.path()}.${process.pid}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(this.loaded())}\n`, { mode: 0o600 });
      renameSync(temporary, this.path());
    } catch {
      return;
    }
  }

  noteApplied(planId: string, operations: ReadonlyArray<TallyOperation>): void {
    const current = this.loaded();
    if (!this.enabled() || Object.hasOwn(current.plans, planId)) return;
    const { used, replaced } = keysOf(operations);
    if (used.length === 0 && replaced.length === 0) return;
    const at = this.now();
    current.store = replaced.reduce((store, key) => recordSignal(store, key, "replace", at), used.reduce((store, key) => recordSignal(store, key, "use", at), current.store));
    current.plans[planId] = used;
    for (const old of Object.keys(current.plans).slice(0, Math.max(0, Object.keys(current.plans).length - MAX_PLANS))) delete current.plans[old];
    this.trim();
    this.save();
  }

  noteUndone(planId: string): void {
    const current = this.loaded();
    const used = current.plans[planId];
    if (!this.enabled() || used === undefined) return;
    const at = this.now();
    current.store = used.reduce((store, key) => recordSignal(store, key, "undo", at), current.store);
    delete current.plans[planId];
    this.save();
  }

  private trim(): void {
    const current = this.loaded();
    const entries = Object.entries(current.store);
    if (entries.length > MAX_KEYS) current.store = Object.fromEntries(entries.sort((a, b) => b[1].lastUsedAt - a[1].lastUsedAt).slice(0, MAX_KEYS));
  }

  habits(kind: HabitKind, candidates: ReadonlyArray<{ readonly key: string; readonly stored: ReadonlyArray<string> }>): Habits {
    const at = this.now(), store = this.loaded().store;
    const score: Record<string, number> = {}, note: Record<string, string> = {};
    for (const candidate of candidates) {
      const names = candidate.stored.map((name) => preferenceKey(kind, name));
      const total = Object.values(preferenceScores(store, names, at)).reduce((sum, value) => sum + value, 0);
      const said = names.flatMap((name) => preferenceSummary(store[name], at) ?? []);
      if (total > 0) score[candidate.key] = total;
      const [first] = said;
      if (first !== undefined) note[candidate.key] = first;
    }
    return { score, note };
  }
}
