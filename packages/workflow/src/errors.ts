// The two error classes of the workflow package: rejected transitions and unusable storage.

import type { WorkflowErrorCode } from "./events.js";

export type WorkflowStorageErrorCode = "CORRUPT_STORAGE" | "INCOMPATIBLE_VERSION" | "STORAGE_IO" | "STORE_CLOSED";

/** A rejected event, carrying the reducer's reason code. */
export class WorkflowTransitionError extends Error {
  public constructor(public readonly code: WorkflowErrorCode, message: string) {
    super(message);
    this.name = "WorkflowTransitionError";
  }
}

/** A storage failure: corrupt or incompatible file, I/O error or closed store. */
export class WorkflowStorageError extends Error {
  public constructor(public readonly code: WorkflowStorageErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkflowStorageError";
  }
}
