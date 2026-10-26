// Shared helpers for tests that run against a store file on disk.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPersistentWorkflowStore, WorkflowStorageError } from "../src/index.js";
import { parsedObject } from "./fixtures.js";

function temporaryStore(): { readonly directory: string; readonly filePath: string } {
  const directory = mkdtempSync(join(tmpdir(), "extynt-workflow-durable-"));
  return { directory, filePath: join(directory, "workflow.json") };
}

export function withStore(run: (filePath: string) => void): void {
  const location = temporaryStore();
  try { run(location.filePath); } finally { rmSync(location.directory, { recursive: true, force: true }); }
}

export function assertStorageCode(action: () => void, code: WorkflowStorageError["code"]): void {
  assert.throws(action, (error) => error instanceof WorkflowStorageError && error.code === code);
}

export function recoveryDisposition(filePath: string): string {
  const restarted = createPersistentWorkflowStore({ filePath });
  try { return restarted.recovery().batches[0]?.disposition ?? "missing"; } finally { restarted.close(); }
}

export function storedGeneration(filePath: string): number | undefined {
  const generation = parsedObject(readFileSync(filePath, "utf8")).generation;
  return typeof generation === "number" ? generation : undefined;
}

