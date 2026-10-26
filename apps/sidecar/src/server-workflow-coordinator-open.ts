// Opening the workflow coordinator and its durable store at start-up: a journal this build cannot read is set aside for inspection and the sidecar starts with an empty history.
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { basename, join } from "node:path";

import { accepts, instanceOf, refine } from "@extynt/decode";
import { createPersistentWorkflowStore, WorkflowStorageError } from "@extynt/workflow";

import { profileDirectory } from "./profile-store.js";
import type { SidecarOptions } from "./server-types.js";
import { WorkflowCoordinator } from "./workflow-coordinator.js";

type OpenedStore = { store: NonNullable<SidecarOptions["workflowStore"]>; notice?: string };

const isUnreadableJournal = accepts(refine(instanceOf(WorkflowStorageError, "a workflow storage error"), (error): error is WorkflowStorageError => error.code === "CORRUPT_STORAGE" || error.code === "INCOMPATIBLE_VERSION", "a corrupt or incompatible journal error"));

function openPersistentWorkflowStore(filePath: string, now: () => Date): OpenedStore {
  try {
    return { store: createPersistentWorkflowStore({ filePath }) };
  } catch (error) {
    if (!isUnreadableJournal(error) || !existsSync(filePath)) throw error;
    const preserved = `${filePath}.corrupt-${now().toISOString().replace(/[:.]/g, "-")}`;
    renameSync(filePath, preserved);
    const notice = `The workflow journal could not be loaded (${error.code}) and was set aside as ${basename(preserved)}; the sidecar started with an empty workflow history.`;
    process.stderr.write(`[extynt] ${notice}\n`);
    return { store: createPersistentWorkflowStore({ filePath }), notice };
  }
}

/** workflow-v1 is the only engine: every sidecar owns a coordinator and its durable store. */
export function openWorkflowCoordinator(options: SidecarOptions, now: () => Date): WorkflowCoordinator {
  const directory = options.stateDirectory ?? profileDirectory();
  if (!options.workflowStore) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const opened: OpenedStore = options.workflowStore ? { store: options.workflowStore } : openPersistentWorkflowStore(join(directory, "workflow-store.json"), now);
  const coordinator = new WorkflowCoordinator({ now, store: opened.store });
  if (opened.notice) coordinator.addStartupNotice(opened.notice);
  return coordinator;
}
