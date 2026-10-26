// The bounded observational memory of a collection service: the rows kept from accepted pages, the stamp they are bound to and the live pulse that extends their freshness.
import type { JsonObject } from "@extynt/decode";
import { decode, fallback, jsonObject, nullValue, number, object, union } from "@extynt/decode";
import { liveCurrent } from "./graph-freshness.js";
import type { PageStamp, RetainedCollectionRow } from "./collection-job.js";

const MAX_ROWS = 16384;
const MAX_BYTES = 33554432;
const storedRow = object({ stamp: fallback(jsonObject, undefined) });
const storedParts = object({ epoch: number(), revision: union(nullValue, number()) });

interface StampParts { epoch: number; revision: number | null }

interface Retained { row: JsonObject; observedAt: number; bytes: number }
interface NativeStamp { epoch: number; revision: number }
interface LivePulse extends NativeStamp { at: number }

function storedStamp(row: JsonObject): (StampParts & { key: string }) | undefined {
  const holder = decode(storedRow, row);
  const raw = holder.ok ? holder.value.stamp : undefined;
  const parts = decode(storedParts, raw);
  return raw !== undefined && parts.ok ? { ...parts.value, key: JSON.stringify(raw) } : undefined;
}

/** Rows retained oldest-first within a row and byte budget, bound to one native stamp; a pulse newer than that stamp extends their freshness and any invalidation discards it. */
export class RetainedObservations {
  private readonly rows = new Map<string, Retained>();
  private bytes = 0;
  private bound: PageStamp | undefined;
  private acceptedAt = 0;
  private items: number | null = null;
  private live: LivePulse | undefined;
  private newest: NativeStamp | undefined;

  boundKey(): string | undefined { return this.bound?.key; }

  forget(): void {
    this.rows.clear();
    this.bytes = 0;
    this.bound = undefined;
    this.items = null;
    this.live = undefined;
  }

  bind(stamp: PageStamp | undefined, items: number | undefined, at: number): void {
    this.bound = stamp;
    this.acceptedAt = at;
    if (items !== undefined) this.items = items;
  }

  retain(rows: readonly RetainedCollectionRow[], at: number): void {
    for (const { key, stored, bytes } of rows) {
      this.bytes -= this.rows.get(key)?.bytes ?? 0;
      this.rows.delete(key);
      this.rows.set(key, { row: stored, observedAt: at, bytes });
      this.bytes += bytes;
      this.evict();
    }
  }

  private evict(): void {
    for (const [key, held] of this.rows) {
      if (this.rows.size <= MAX_ROWS && this.bytes <= MAX_BYTES) return;
      this.bytes -= held.bytes;
      this.rows.delete(key);
    }
  }

  lookupRow(key: string, now: number): { row: JsonObject; fresh: boolean } | undefined {
    const found = this.rows.get(key);
    return found && { row: found.row, fresh: this.isFresh(found, now) };
  }

  noteNewest(epoch: number, revision: number): void {
    if (!this.newest || this.newest.epoch !== epoch || revision > this.newest.revision) this.newest = { epoch, revision };
  }

  provesOlderThanNewest(stamp: { epoch: number | null; revision: number | null }): boolean {
    const newest = this.newest;
    return newest !== undefined && stamp.epoch === newest.epoch && stamp.revision !== null && stamp.revision < newest.revision;
  }

  movedSince(epoch: number, revision: number, items: number | null, at: number): boolean {
    const bound = this.bound;
    if (bound === undefined || at <= this.acceptedAt) return false;
    return bound.epoch !== epoch || bound.revision !== revision || (items !== null && this.items !== null && items !== this.items);
  }

  pulse(epoch: number, revision: number, at: number): void {
    if (this.liveAtFor({ epoch, revision }) === undefined || (this.live !== undefined && this.live.at < at)) this.live = { epoch, revision, at };
  }

  liveAtFor(stamp: StampParts | undefined): number | undefined {
    const live = this.live;
    return live && stamp && stamp.epoch === live.epoch && stamp.revision === live.revision ? live.at : undefined;
  }

  private isFresh(found: Retained, now: number): boolean {
    const stamp = storedStamp(found.row);
    const guarded = stamp !== undefined && stamp.revision !== null && stamp.key === this.bound?.key;
    return guarded && liveCurrent(now - found.observedAt, this.liveAtFor(stamp), now);
  }
}
