// The persistent store: the in-memory event store backed by an atomically replaced, checksummed log file with archiving of terminal jobs.

import { appendFileSync, closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { planArchive } from "./archive.js";
import { WorkflowStorageError } from "./errors.js";
import type { WorkflowEvent } from "./events.js";
import type { WorkflowId } from "./identity.js";
import { classifyWorkflowRecovery } from "./restart-recovery.js";
import { createStorageEnvelope, parseStorageEnvelope } from "./storage-format.js";
import { createWorkflowEventStore } from "./store.js";
import type { PersistentWorkflowStore, PersistentWorkflowStoreOptions, WorkflowStore } from "./store-types.js";

type EventStore = WorkflowStore & { readonly resumeSupported: true };
interface Ledger {
  readonly filePath: string;
  generation: number;
  persisted: readonly WorkflowEvent[];
  closed: boolean;
}

const CAPACITY_COMPACTION_BYTES = 128 * 1024;
let temporarySequence = 0;

function storageIo(message: string, cause: Error | undefined): WorkflowStorageError {
  return new WorkflowStorageError("STORAGE_IO", message, cause ? { cause } : undefined);
}

function syncDirectory(filePath: string): void {
  if (process.platform === "win32") return;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(dirname(filePath), "r");
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function discard(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    return;
  }
}

function atomicReplace(filePath: string, contents: string): void {
  temporarySequence += 1;
  const temporaryPath = `${filePath}.${process.pid}.${temporarySequence}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(descriptor, contents, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporaryPath, filePath);
    syncDirectory(filePath);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    discard(temporaryPath);
    throw storageIo("Workflow storage could not be atomically replaced.", error instanceof Error ? error : undefined);
  }
}

function serializeEnvelope(events: readonly WorkflowEvent[], generation: number): string {
  return `${JSON.stringify(createStorageEnvelope(events, generation))}\n`;
}

function load(filePath: string): { readonly events: readonly WorkflowEvent[]; readonly generation: number } {
  if (!existsSync(filePath)) {
    atomicReplace(filePath, serializeEnvelope([], 0));
    return { events: [], generation: 0 };
  }
  let serialized: string;
  try {
    serialized = readFileSync(filePath, "utf8");
  } catch (error) {
    throw storageIo("Workflow storage could not be read.", error instanceof Error ? error : undefined);
  }
  const envelope = parseStorageEnvelope(serialized);
  return { events: envelope.events, generation: envelope.generation };
}

function buildStore(ledger: Ledger, events: readonly WorkflowEvent[]): EventStore {
  return createWorkflowEventStore(events, true, (nextEvents) => {
    assertOpen(ledger);
    atomicReplace(ledger.filePath, serializeEnvelope(nextEvents, ledger.generation + 1));
    ledger.persisted = [...nextEvents];
    ledger.generation += 1;
  });
}

function assertOpen(ledger: Ledger): void {
  if (ledger.closed) throw new WorkflowStorageError("STORE_CLOSED", "Workflow storage is closed.");
}

function replayStore(ledger: Ledger, events: readonly WorkflowEvent[]): EventStore {
  try {
    return buildStore(ledger, events);
  } catch (error) {
    if (error instanceof WorkflowStorageError) throw error;
    throw new WorkflowStorageError("CORRUPT_STORAGE", "Workflow storage event history cannot be replayed.", error instanceof Error ? { cause: error } : undefined);
  }
}

function archiveJobs(ledger: Ledger, jobIds: ReadonlySet<WorkflowId>): EventStore {
  const archived = ledger.persisted.filter((event) => jobIds.has(event.jobId));
  const retained = ledger.persisted.filter((event) => !jobIds.has(event.jobId));
  appendFileSync(`${ledger.filePath}.archive.jsonl`, `${JSON.stringify({ archivedAt: new Date().toISOString(), jobs: [...jobIds], events: archived })}\n`, { encoding: "utf8", mode: 0o600 });
  atomicReplace(ledger.filePath, serializeEnvelope(retained, ledger.generation + 1));
  ledger.persisted = retained;
  ledger.generation += 1;
  return buildStore(ledger, retained);
}

function needsCompaction(ledger: Ledger, events: readonly WorkflowEvent[]): boolean {
  if (events.some((event) => event.type === "job.opened")) return true;
  const persistedBytes = Buffer.byteLength(JSON.stringify(ledger.persisted), "utf8");
  return persistedBytes + Buffer.byteLength(JSON.stringify(events), "utf8") > CAPACITY_COMPACTION_BYTES;
}

/** Opens or creates the log file at the path and replays it into a store whose every append is persisted atomically before it is visible. */
export function createPersistentWorkflowStore(options: PersistentWorkflowStoreOptions): PersistentWorkflowStore {
  if (options.filePath.trim().length === 0) throw new WorkflowStorageError("STORAGE_IO", "Workflow storage path must not be empty.");
  const loaded = load(options.filePath);
  const ledger: Ledger = { filePath: options.filePath, generation: loaded.generation, persisted: [...loaded.events], closed: false };
  let store = replayStore(ledger, loaded.events);
  const open = <Result>(action: () => Result): Result => {
    assertOpen(ledger);
    return action();
  };
  const prepared = <Result>(events: readonly WorkflowEvent[], action: () => Result): Result => open(() => {
    if (needsCompaction(ledger, events)) {
      const ids = planArchive(store.getState(), ledger.persisted);
      if (ids.size > 0) store = archiveJobs(ledger, ids);
    }
    return action();
  });
  return {
    resumeSupported: true,
    filePath: options.filePath,
    getState: () => open(() => store.getState()),
    project: () => open(() => store.project()),
    append: (event) => prepared([event], () => store.append(event)),
    appendBatch: (events) => prepared(events, () => store.appendBatch(events)),
    listEvents: (jobId) => open(() => store.listEvents(jobId)),
    loadJob: (jobId) => open(() => store.loadJob(jobId)),
    serialize: () => open(() => store.serialize()),
    recovery: () => open(() => classifyWorkflowRecovery(store.getState())),
    close: () => { ledger.closed = true; },
  };
}
