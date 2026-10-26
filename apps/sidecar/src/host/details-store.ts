// Layer details that survive a restart: the text documents, key digests, markers, paths and layer references the jsx details call returned, so a
// pair after a sidecar or After Effects restart asks the host only for layers it has no valid record of. It is a cache and nothing more: a lost,
// corrupt or old file costs one slow read, never a wrong answer.
//
// An entry is keyed by project, composition and layer, and carries the layer's content hash and the witness it was read under. It is reused only
// when the hash is the layer's hash now AND the witness still holds (`details-witness.ts` explains why the hash alone does not vouch for details).
// Keyed per project (its file, else its name) because layer ids are small integers that every project reuses: one slot per layer, no thrashing between
// two open projects, and an identical copy of a project at another path is a different project to the store.
//
// Bounds: at most MAX_ENTRIES layers and MAX_BYTES of serialized details, least recently used out first; one layer whose details exceed
// MAX_ENTRY_BYTES is not stored. Writes are debounced, atomic (temp file then rename) and not synced.
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { array, decodeJson, literal, map, nullable, object, skippingInvalid, string } from "@extynt/decode";
import { DETAIL_KINDS, KEY_DIGEST_FORMAT, propertyDetail } from "../native-snapshot/index.js";
import type { LayerDetails, PropertyDetail } from "../native-snapshot/index.js";
import { witnessHolds, type Witness } from "./details-witness.js";

export const DETAILS_STORE_FILE = "layer-details.json";
/** Bumped whenever the file layout or the meaning of an entry changes; a file of any other format is ignored. */
export const DETAILS_STORE_FORMAT = 2;
export const MAX_ENTRIES = 4096;
export const MAX_BYTES = 8 * 1024 * 1024;
export const MAX_ENTRY_BYTES = 256 * 1024;
const WRITE_DELAY_MS = 750;

const HEADER = { format: DETAILS_STORE_FORMAT, digest: KEY_DIGEST_FORMAT, kinds: DETAIL_KINDS.join(",") } as const;

export interface LayerAsk { projectKey: string; compId: string; layerId: string; hash: string }
export interface RecordedLayer extends LayerAsk { properties: readonly PropertyDetail[] }

interface Entry extends LayerAsk { session: string | null; file: string | null; properties: string }

/**
 * `lookup` returns the stored details of every asked layer whose hash equals its entry's and whose entry's witness holds under `now`; `record`
 * replaces the entries of these layers with details read under `witness`; `flush` writes pending changes now (a shutdown hook and the tests; the
 * debounce does it otherwise); `size` counts the layers held, for the tests and the log.
 */
export interface DetailsStore {
  lookup(asked: readonly LayerAsk[], now: Witness): Promise<LayerDetails[]>;
  record(layers: readonly RecordedLayer[], witness: Witness): void;
  flush(): Promise<void>;
  size(): number;
}

const slotOf = (ask: Pick<LayerAsk, "projectKey" | "compId" | "layerId">): string => `${ask.projectKey}\u0000${ask.compId}\u0000${ask.layerId}`;

const propertyList = array(propertyDetail);
const storedProperties = map(propertyList, (properties) => JSON.stringify(properties));

const storedEntry = map(
  object({ p: string(), c: string(), l: string(), h: string({ nonEmpty: true }), s: nullable(string()), f: nullable(string()), d: storedProperties }),
  (row): Entry => ({ projectKey: row.p, compId: row.c, layerId: row.l, hash: row.h, session: row.s, file: row.f, properties: row.d }),
);

const storeFile = object({ format: literal(HEADER.format), digest: literal(HEADER.digest), kinds: literal(HEADER.kinds), entries: skippingInvalid(storedEntry) });

/** The entries of a stored file, oldest use first; an empty list for anything that is not a current-format file. A malformed entry, or one over `MAX_ENTRY_BYTES`, is dropped without losing its neighbours. */
export function parseStore(text: string): Entry[] {
  const file = decodeJson(text, storeFile);
  return file.ok ? file.value.entries.filter((entry) => entry.properties.length <= MAX_ENTRY_BYTES) : [];
}

const weightOf = (entry: Entry): number => entry.properties.length + entry.projectKey.length + entry.hash.length + 96;

function serialize(entries: Iterable<Entry>): string {
  const rows = [...entries].map((entry) => `{"p":${JSON.stringify(entry.projectKey)},"c":${JSON.stringify(entry.compId)},"l":${JSON.stringify(entry.layerId)},"h":${JSON.stringify(entry.hash)},"s":${JSON.stringify(entry.session)},"f":${JSON.stringify(entry.file)},"d":${entry.properties}}`);
  return `{"format":${HEADER.format},"digest":${JSON.stringify(HEADER.digest)},"kinds":${JSON.stringify(HEADER.kinds)},"entries":[${rows.join(",")}]}`;
}

interface DetailsStoreOptions {
  directory: string | undefined;
  writeDelayMs?: number;
}

class LruEntries {
  private readonly map = new Map<string, Entry>();
  private bytes = 0;

  get size(): number { return this.map.size; }
  values(): Iterable<Entry> { return this.map.values(); }
  peek(slot: string): Entry | undefined { return this.map.get(slot); }

  touch(slot: string): void {
    const entry = this.map.get(slot);
    if (entry) { this.map.delete(slot); this.map.set(slot, entry); }
  }

  put(entry: Entry): void {
    const slot = slotOf(entry), old = this.map.get(slot);
    if (old) { this.bytes -= weightOf(old); this.map.delete(slot); }
    this.map.set(slot, entry);
    this.bytes += weightOf(entry);
    this.trim();
  }

  drop(slot: string): void {
    const old = this.map.get(slot);
    if (old) { this.bytes -= weightOf(old); this.map.delete(slot); }
  }

  private trim(): void {
    while (this.map.size > MAX_ENTRIES || this.bytes > MAX_BYTES) {
      const oldest = this.map.keys().next();
      if (oldest.done) return;
      this.drop(oldest.value);
    }
  }
}

class FileDetailsStore implements DetailsStore {
  private readonly entries = new LruEntries();
  private loaded: Promise<void> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private writing: Promise<void> = Promise.resolve();
  private dirty = false;

  constructor(private readonly options: DetailsStoreOptions) {}

  private load(): Promise<void> {
    this.loaded ??= this.read();
    return this.loaded;
  }

  private async read(): Promise<void> {
    const { directory } = this.options;
    if (directory === undefined) return;
    let text = "";
    try { text = await readFile(join(directory, DETAILS_STORE_FILE), "utf8"); } catch { return; }
    for (const entry of parseStore(text)) if (!this.entries.peek(slotOf(entry))) this.entries.put(entry);
  }

  async lookup(asked: readonly LayerAsk[], now: Witness): Promise<LayerDetails[]> {
    await this.load();
    const found: LayerDetails[] = [];
    for (const ask of asked) {
      const slot = slotOf(ask), entry = this.entries.peek(slot);
      if (!entry || entry.hash !== ask.hash || !witnessHolds({ session: entry.session, file: entry.file }, now)) continue;
      this.entries.touch(slot);
      const properties = decodeJson(entry.properties, propertyList);
      if (properties.ok) found.push({ compId: ask.compId, layerId: ask.layerId, properties: properties.value });
    }
    return found;
  }

  record(layers: readonly RecordedLayer[], witness: Witness): void {
    if (this.options.directory === undefined || (witness.session === null && witness.file === null)) return;
    for (const layer of layers) {
      const properties = JSON.stringify(layer.properties);
      if (properties.length > MAX_ENTRY_BYTES) { this.entries.drop(slotOf(layer)); continue; }
      this.entries.put({ projectKey: layer.projectKey, compId: layer.compId, layerId: layer.layerId, hash: layer.hash, session: witness.session, file: witness.file, properties });
    }
    this.dirty = true;
    this.schedule();
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, this.options.writeDelayMs ?? WRITE_DELAY_MS);
    this.timer.unref();
  }

  flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    this.writing = this.writing.then(() => this.persist());
    return this.writing;
  }

  private async persist(): Promise<void> {
    const { directory } = this.options;
    if (directory === undefined || !this.dirty) return;
    await this.load();
    this.dirty = false;
    const target = join(directory, DETAILS_STORE_FILE), temp = `${target}.${process.pid}.tmp`;
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(temp, serialize(this.entries.values()), { mode: 0o600 });
      await rename(temp, target);
    } catch { await rm(temp, { force: true }).catch(() => undefined); }
  }

  size(): number { return this.entries.size; }
}

export function createDetailsStore(options: DetailsStoreOptions): DetailsStore {
  return new FileDetailsStore(options);
}
