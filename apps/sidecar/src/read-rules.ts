/**
 * The rules that decide, from the sidecar's own record, whether After Effects must be read again and how little of it: the
 * first read after a pair, a project switch, a composition the snapshot lacks, one the item list names that nothing holds,
 * and an edit that has settled. Pure: the stored view, the live focus and stamp and the scheduler's memory in, a decision out.
 */
import { sameProject, type LiveFocus } from "./live-focus.js";
import type { BaseView } from "./read-base-view.js";
import type { LiveStamp } from "./read-currency.js";
import { MAX_READ_COMPOSITIONS, type ReadSpec } from "./read-queue.js";

const REASK_PAIR_MS = 30_000, REASK_FULL_MS = 10_000, REASK_COMPOSITION_MS = 5000;
const MAX_ASKS = 2;

/**
 * What the scheduler remembers between ticks so the same ask is not made again and again: the newest revision already asked
 * about, the last ask made repeatedly (how often, when, whether the sidecar gave up on it) and when a pair read was asked.
 */
export interface SchedulerMemory {
  settledRevision: number | null;
  ask: { key: string; count: number; at: number; gaveUp: boolean } | null;
  pairAskedAt: number | null;
}

/** A scheduler that has asked nothing yet. */
export function freshSchedulerMemory(): SchedulerMemory { return { settledRevision: null, ask: null, pairAskedAt: null }; }

/**
 * Everything a tick decides from. `source` is a plugin `event` or the sidecar's own look (`focus`, `claim`); `pending` means a
 * refresh is queued or running; only a fresh `focus` report counts, an old one says nothing about what AE shows now.
 */
export interface ReadInput {
  now: number;
  source: "claim" | "focus" | "event";
  awaitingFirstRead: boolean;
  inventoryKnown: boolean;
  pending: boolean;
  base: BaseView | undefined;
  focus: LiveFocus | null;
  stamp: LiveStamp | null;
  memory: SchedulerMemory;
}
/** The read a tick asks for (or none) and the scheduler memory after deciding. */
export interface ReadDecision { spec: ReadSpec | null; memory: SchedulerMemory }

const full = (reason: ReadSpec["reason"], includeEffects = false): ReadSpec => ({ reason, read: { scope: "full" }, ...(includeEffects ? { includeEffects: true } : {}) });
const scoped = (reason: ReadSpec["reason"], ids: string[], includeItems: boolean): ReadSpec => ({ reason, read: { scope: "compositions", compositionIds: ids.slice(0, MAX_READ_COMPOSITIONS), includeItems } });

function mayAsk(memory: SchedulerMemory, key: string, now: number, spacing: number): boolean {
  const ask = memory.ask;
  if (!ask || ask.key !== key) { memory.ask = { key, count: 1, at: now, gaveUp: false }; return true; }
  if (ask.count >= MAX_ASKS) { memory.ask = { ...ask, gaveUp: true }; return false; }
  if (now - ask.at < spacing) return false;
  memory.ask = { key, count: ask.count + 1, at: now, gaveUp: false };
  return true;
}

function firstRead(input: ReadInput, memory: SchedulerMemory): ReadSpec | null {
  if (input.base || !input.awaitingFirstRead || input.source === "focus" || input.pending) return null;
  if (memory.pairAskedAt !== null && input.now - memory.pairAskedAt < REASK_PAIR_MS) return null;
  memory.pairAskedAt = input.now;
  return full("pair", !input.inventoryKnown);
}

function foreignProject({ focus, stamp }: Pick<ReadInput, "focus" | "stamp">, base: BaseView): boolean {
  if (focus !== null && !sameProject(focus, base)) return true;
  return stamp !== null && base.epoch !== null && stamp.epoch !== base.epoch;
}

function projectSwitch(input: ReadInput, base: BaseView, memory: SchedulerMemory): ReadSpec | null {
  if (!foreignProject(input, base)) return null;
  const { focus, stamp } = input, key = JSON.stringify(["project", focus?.projectPath, focus?.projectName, focus?.epoch, stamp?.epoch, base.project, base.epoch]);
  return mayAsk(memory, key, input.now, REASK_FULL_MS) ? full("project") : null;
}

function itemsKnown(stamp: LiveStamp | null, base: BaseView): boolean {
  return stamp !== null && stamp.items !== null && base.itemCount !== null;
}

function itemsChanged(stamp: LiveStamp | null, base: BaseView): boolean {
  return itemsKnown(stamp, base) && stamp?.items !== base.itemCount;
}

function unknownComposition(input: ReadInput, base: BaseView, memory: SchedulerMemory): ReadSpec | null {
  const active = input.focus?.activeCompositionId;
  if (!active || base.coverage || base.held.has(active) || base.gaps.has(active)) return null;
  if (!mayAsk(memory, `composition:${active}`, input.now, REASK_COMPOSITION_MS)) return null;
  return scoped("composition", [active], !itemsKnown(input.stamp, base) || itemsChanged(input.stamp, base));
}

function missingComposition(input: ReadInput, base: BaseView, memory: SchedulerMemory): ReadSpec | null {
  if (base.coverage || base.missing.length === 0 || input.pending || input.source === "focus") return null;
  const ids = base.missing.slice(0, MAX_READ_COMPOSITIONS);
  return mayAsk(memory, `missing:${ids.join(",")}`, input.now, REASK_COMPOSITION_MS) ? scoped("composition", ids, false) : null;
}

function openCompositionRead(active: string, base: BaseView, stamp: LiveStamp): ReadSpec | null {
  const changed = itemsChanged(stamp, base);
  return base.observed[active] === stamp.revision && !changed ? null : scoped("edit", [active], changed);
}

function itemListRead(base: BaseView, stamp: LiveStamp): ReadSpec | null {
  if (!itemsChanged(stamp, base)) return null;
  return base.cheapest ? scoped("edit", [base.cheapest], true) : full("edit");
}

function editRead(input: ReadInput, base: BaseView, stamp: LiveStamp): ReadSpec | null {
  const active = input.focus?.activeCompositionId ?? null;
  if (base.coverage) return full("edit");
  return active && !base.gaps.has(active) ? openCompositionRead(active, base, stamp) : itemListRead(base, stamp);
}

function settledEdit(input: ReadInput, base: BaseView, memory: SchedulerMemory): ReadSpec | null {
  const stamp = input.stamp;
  if (input.source === "focus") return null;
  if (!stamp || input.pending || base.newest === null || stamp.revision === base.newest || stamp.revision === memory.settledRevision) return null;
  memory.settledRevision = stamp.revision;
  return editRead(input, base, stamp);
}

/**
 * The rules in order. A selection change decides nothing: the focus overlay answers it. A missing or old stamp is unknown
 * and decides nothing either; the turn and tool gates cover a host that has gone quiet.
 */
export function decideRead(input: ReadInput): ReadDecision {
  const memory: SchedulerMemory = { ...input.memory }, { base } = input;
  const first = firstRead(input, memory);
  if (first || !base) return { spec: first, memory };
  return { spec: projectSwitch(input, base, memory) ?? unknownComposition(input, base, memory) ?? missingComposition(input, base, memory) ?? settledEdit(input, base, memory), memory };
}
