/**
 * The file behind the native bridge lease: one JSON journal replaced by atomic rename, under an exclusive lock file for every
 * update. A held lock is another update in progress and a lock older than one synchronous update was left by a crash, so it
 * ages out. The journal is replaced by rename, so reading it while another update holds the lock is consistent, and a held
 * lock never makes storage unreadable: writers see BUSY. Storage that cannot be read, or is unsafe or invalid, fails
 * closed until the process restarts; a failed write leaves the prior journal in force and may be retried. A mutation lease is
 * fsynced with its directory because it must survive a crash or power loss; a read lease is written atomically but never
 * fsynced, which on macOS is F_FULLFSYNC (about 4 ms each, four per leased call), and an empty file left by an operating-system
 * crash reads as no journal. Windows cannot fsync a directory (EPERM); NTFS journals the rename itself.
 */
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { accepts, decode, decodeJson, instanceOf, object, refine, string } from "@extynt/decode";
import { dirname, join } from "node:path";
import { freshJournal, journalShape, type Durability, type Journal } from "./native-bridge-journal.js";
import { opensToOthers } from "./owner-only-mode.js";

const STALE_LOCK_MS = 10000;
const ANCESTOR_RECHECK_MS = 2000;
const MAX_JOURNAL_BYTES = 16384;
const FAILING_CODES = ["NATIVE_BRIDGE_STORAGE_UNSAFE", "NATIVE_BRIDGE_STORAGE_INVALID"];

const errorCode = object({ code: string() });

const isMissing = accepts(refine(instanceOf(Error, "an Error"), (error): error is Error => {
  const code = decode(errorCode, error);
  return code.ok && code.value.code === "ENOENT";
}, "a missing-file error"));

function existing(path: string): ReturnType<typeof lstatSync> | undefined {
  try { return lstatSync(path); } catch (error) { if (isMissing(error)) return undefined; throw error; }
}

function safeAncestors(path: string): void {
  for (let current = path, parent = dirname(current); ; current = parent, parent = dirname(current)) {
    const stat = existing(current);
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw Error("NATIVE_BRIDGE_STORAGE_UNSAFE");
    if (parent === current) return;
  }
}

function signatureOf(stat: ReturnType<typeof lstatSync> | undefined): string {
  return stat ? `${stat.ino}:${stat.size}:${stat.mtimeMs}` : "absent";
}

function syncDirectory(path: string): void {
  if (process.platform === "win32") return;
  const descriptor = openSync(path, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

/** The journal of the native bridge lease and the file it lives in: reload, durable replace, and the lock around an update. */
export class NativeBridgeStorage {
  journal: Journal = freshJournal();
  failure: string | undefined;
  private verified: { signature: string; at: number } | undefined;
  private readonly file: string;
  private readonly lock: string;

  constructor(directory: string) {
    this.file = join(directory, "native-bridge-lease.json");
    this.lock = this.file + ".lock";
    this.check();
  }

  check(): void {
    if (this.failure) return;
    try { this.refresh(); } catch { this.failure = "NATIVE_BRIDGE_STORAGE_UNREADABLE"; }
  }

  refresh(): void {
    if (existsSync(this.lock)) this.clearStaleLock();
    const signature = signatureOf(existing(this.file));
    if (this.verified && this.verified.signature === signature && Date.now() - this.verified.at < ANCESTOR_RECHECK_MS) return;
    safeAncestors(dirname(this.file));
    this.reloadJournal();
    this.verified = { signature: signatureOf(existing(this.file)), at: Date.now() };
  }

  mutate<T>(operation: () => T): T {
    if (this.failure) throw Error(this.failure);
    this.requireDirectory();
    const descriptor = this.acquireLock();
    try {
      this.reloadJournal();
      return operation();
    } catch (error) {
      if (error instanceof Error) this.noteFailure(error);
      throw error;
    } finally { closeSync(descriptor); unlinkSync(this.lock); }
  }

  persist(next: Journal, durability: Durability): void {
    this.verified = undefined;
    const temporary = this.file + ".tmp-" + randomUUID();
    let descriptor: number | undefined;
    try {
      descriptor = openSync(temporary, "wx", 0o600);
      writeFileSync(descriptor, JSON.stringify(next) + "\n");
      if (durability !== "none") fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporary, this.file);
      if (durability === "full") syncDirectory(dirname(this.file));
      this.journal = next;
    } finally { if (descriptor !== undefined) closeSync(descriptor); if (existsSync(temporary)) unlinkSync(temporary); }
  }

  private requireDirectory(): void {
    const directory = dirname(this.file);
    safeAncestors(directory);
    if (!existing(directory)) throw Error("NATIVE_BRIDGE_STORAGE_DIRECTORY_MISSING");
    if (lstatSync(directory).isSymbolicLink()) { this.failure = "NATIVE_BRIDGE_STORAGE_UNSAFE"; throw Error(this.failure); }
  }

  private clearStaleLock(): boolean {
    try {
      const stat = lstatSync(this.lock);
      if (!stat.isFile() || Date.now() - stat.mtimeMs < STALE_LOCK_MS) return false;
      unlinkSync(this.lock);
      return true;
    } catch (error) { return isMissing(error); }
  }

  private reloadJournal(): void {
    const stat = existing(this.file);
    if (!stat) return;
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_JOURNAL_BYTES || opensToOthers(Number(stat.mode))) throw Error("NATIVE_BRIDGE_STORAGE_UNSAFE");
    if (stat.size === 0) return;
    const decoded = decodeJson(readFileSync(this.file, "utf8"), journalShape);
    if (!decoded.ok) throw Error("NATIVE_BRIDGE_STORAGE_INVALID");
    this.journal = decoded.value;
  }

  private acquireLock(): number {
    try { return openSync(this.lock, "wx", 0o600); } catch {
      if (!this.clearStaleLock()) throw Error("NATIVE_BRIDGE_BUSY");
      try { return openSync(this.lock, "wx", 0o600); } catch { throw Error("NATIVE_BRIDGE_BUSY"); }
    }
  }

  private noteFailure(error: Error): void {
    if (error instanceof Error && FAILING_CODES.includes(error.message)) this.failure = error.message;
    else if (error instanceof SyntaxError) this.failure = "NATIVE_BRIDGE_STORAGE_INVALID";
  }
}
