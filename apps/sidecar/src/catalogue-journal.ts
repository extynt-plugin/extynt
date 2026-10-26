// The probe journal on disk: attempts written before each page is handed out, failures and instance reads per host, and the host's breadcrumb.
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { boolean, decodeJson, fallback, literal, map, number, object, optional, record, refine, skippingInvalidRecord, string } from "@extynt/decode";
import type { Decoder } from "@extynt/decode";
import { integerFrom } from "./native-field-decoders.js";

/** What a crashed or hung probe page leaves behind: attempts are written before a page is handed out and cleared only when it completes.
 * `failed` holds the refusal code, its time and After Effects' own words (bounded); `instanceReads` the effects whose controls were read once from a real project instance, keyed like `failed`; `interactive` the effects whose add waited on a plugin window, which automatic runs leave to the user's own "Collect" press. */
export interface HostJournal {
  attempts: Record<string, number>; failed: Record<string, { code: string; at: number; detail?: string }>;
  instanceReads: Record<string, number>; interactive: Record<string, number>;
}

/** Written by the host page itself (catalogue.jsx) just before it adds or removes each effect. */
export const BREADCRUMB_FILE = "catalogue-probe-current.json";

/** Which effect the host was adding or removing when it last wrote its breadcrumb. */
export interface ProbeBreadcrumb { ticket: string; phase: "apply" | "remove" | "done"; matchName: string }

interface JournalFile { schemaVersion: 1; cleanup: boolean; hosts: Record<string, HostJournal> }

const FILE = "catalogue-probe-journal.json";
const MAX_ATTEMPTS = 1000;
const MAX_DETAIL = 300;

const breadcrumb: Decoder<ProbeBreadcrumb> = object({ ticket: string(), phase: literal("apply", "remove", "done"), matchName: string({ maxLength: 512 }) });

const attemptCount = refine(integerFrom(1), (count): count is number => count < MAX_ATTEMPTS, `fewer than ${MAX_ATTEMPTS} attempts`);
const failureEntry = map(
  object({ code: string({ pattern: /^[a-z0-9-]{1,64}$/ }), at: number(), detail: optional(fallback(string({ nonEmpty: true }), undefined)) }),
  ({ code, at, detail }) => (detail === undefined ? { code, at } : { code, at, detail: detail.slice(0, MAX_DETAIL) }),
);
const timestamps = fallback(skippingInvalidRecord(number()), {});

const hostJournal: Decoder<HostJournal> = map(
  object({ attempts: skippingInvalidRecord(attemptCount), failed: skippingInvalidRecord(failureEntry), interactive: optional(timestamps), instanceReads: optional(timestamps) }),
  ({ attempts, failed, interactive, instanceReads }) => ({ attempts, failed, interactive: interactive ?? {}, instanceReads: instanceReads ?? {} }),
);

const journalFile: Decoder<JournalFile> = object({
  schemaVersion: literal(1), cleanup: boolean(),
  hosts: map(record(string(), hostJournal), (hosts) => ({ ...hosts })),
});

function readText(path: string): string | undefined {
  try { return readFileSync(path, "utf8"); } catch { return undefined; }
}

function setAside(path: string): void {
  try { renameSync(path, `${path}.unreadable`); } catch { return; }
}

/** Reads and deletes the host's breadcrumb. Anything unreadable is no evidence and is simply dropped. */
export function takeBreadcrumb(directory: string): ProbeBreadcrumb | undefined {
  const path = join(directory, BREADCRUMB_FILE), text = readText(path);
  if (text === undefined) return undefined;
  rmSync(path, { force: true });
  const crumb = decodeJson(text, breadcrumb);
  return crumb.ok ? crumb.value : undefined;
}

/** Owner-only, atomic: a crash mid-write leaves either the old journal or the new one, never a torn file. */
export class CatalogueJournal {
  private readonly path: string;
  private data: JournalFile = { schemaVersion: 1, cleanup: false, hosts: {} };

  constructor(private readonly directory: string) {
    this.path = join(directory, FILE);
    this.load();
  }

  private load(): void {
    const text = readText(this.path);
    if (text === undefined) return;
    const parsed = decodeJson(text, journalFile);
    if (parsed.ok) this.data = parsed.value;
    else setAside(this.path);
  }

  host(hostKey: string): HostJournal {
    return this.data.hosts[hostKey] ??= { attempts: {}, failed: {}, interactive: {}, instanceReads: {} };
  }

  get cleanup(): boolean { return this.data.cleanup; }

  set cleanup(value: boolean) { this.data.cleanup = value; }

  save(): void {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.tmp`;
    let fd: number | undefined;
    try {
      fd = openSync(temporary, "w", 0o600);
      writeFileSync(fd, `${JSON.stringify(this.data)}\n`);
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      renameSync(temporary, this.path);
    } finally {
      if (fd !== undefined) closeSync(fd);
      rmSync(temporary, { force: true });
    }
  }
}
