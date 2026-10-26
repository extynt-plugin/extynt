// The learned-alias store: which catalogue entry a model chose for a request phrase, kept in a small versioned file beside the other per-user state so the next request with the same words needs no model.
import { array, decodeJson, literal, object, string } from "@extynt/decode";
import { normaliseText, stemWord, wordsOf } from "@extynt/decide";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FILE = "learned-aliases.json";
const FORMAT_VERSION = 1;

/** The most aliases kept; the least recently used is dropped first. */
export const MAX_ALIASES = 500;

/** What an alias is about: the kind of catalogue entry, the After Effects version it was learned on, the effect a control belongs to (empty otherwise) and the phrase as the user wrote it. */
export interface AliasKey {
  readonly kind: "effect" | "control" | "font" | "property";
  readonly catalogue: string;
  readonly scope: string;
  readonly phrase: string;
}

const storedAlias = object({ kind: literal("effect", "control", "font", "property"), catalogue: string(), scope: string(), phrase: string(), answer: string() });
const stored = object({ version: literal(FORMAT_VERSION), aliases: array(storedAlias) });

/** The phrase as the resolvers read it: accents and case removed, each word without digits cut back to its stem, the order kept; text with no Latin words stays as normalised. */
export function aliasPhrase(phrase: string): string {
  const normalised = normaliseText(phrase).trim();
  const words = wordsOf(normalised).map((word) => (/\d/u.test(word) ? word : stemWord(word)));
  return words.length === 0 ? normalised.replace(/\s+/gu, " ") : words.join(" ");
}

function keyOf(key: AliasKey): string {
  return [key.kind, key.catalogue, key.scope, aliasPhrase(key.phrase)].join("\u0000");
}

/**
 * Learned aliases on this machine: bounded, least-recently-used first out, versioned on disk, never shipped and never sent anywhere. `lookup` answers a phrase
 * (and marks it recently used), `learn` (a no-op while learning is switched off) replaces the answer for a phrase and drops the least recently used beyond the bound, `clear` forgets everything in memory and on disk.
 */
export class LearnedAliases {
  private entries: Map<string, { readonly key: AliasKey; readonly answer: string }> | undefined;

  public constructor(private readonly directory: string, private readonly enabled: () => boolean) {}

  private path(): string {
    return join(this.directory, FILE);
  }

  private loaded(): Map<string, { readonly key: AliasKey; readonly answer: string }> {
    if (this.entries !== undefined) return this.entries;
    this.entries = new Map();
    try {
      const decoded = decodeJson(readFileSync(this.path(), "utf8"), stored);
      for (const { answer, ...key } of decoded.ok ? decoded.value.aliases : []) this.entries.set(keyOf(key), { key, answer });
    } catch {
      this.entries.clear();
    }
    return this.entries;
  }

  private save(): void {
    try {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      const temporary = `${this.path()}.${process.pid}.tmp`;
      const aliases = [...this.loaded().values()].map(({ key, answer }) => ({ ...key, answer }));
      writeFileSync(temporary, `${JSON.stringify({ version: FORMAT_VERSION, aliases })}\n`, { mode: 0o600 });
      renameSync(temporary, this.path());
    } catch {
      return;
    }
  }

  public lookup(key: AliasKey): string | undefined {
    const entries = this.loaded();
    const id = keyOf(key);
    const found = entries.get(id);
    if (found === undefined) return undefined;
    entries.delete(id);
    entries.set(id, found);
    return found.answer;
  }

  public learn(key: AliasKey, answer: string): void {
    if (!this.enabled()) return;
    const entries = this.loaded();
    const id = keyOf(key);
    if (entries.get(id)?.answer === answer) return;
    entries.delete(id);
    entries.set(id, { key, answer });
    for (const oldest of [...entries.keys()].slice(0, Math.max(0, entries.size - MAX_ALIASES))) entries.delete(oldest);
    this.save();
  }

  public clear(): void {
    this.loaded().clear();
    this.save();
  }

  public size(): number {
    return this.loaded().size;
  }
}
