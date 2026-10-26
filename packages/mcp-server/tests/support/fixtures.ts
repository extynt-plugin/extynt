// Shared fixtures for the suite: repo file readers, the verified host, a tool context with an empty plan store, and decoded views of authoring payloads.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { StoredPlan, callTool } from "../../src/index.js";
import { representativeSnapshot } from "@extynt/project-graph";
import { array, boolean, decodeOrThrow, jsonValue, number, object, optional, string } from "@extynt/decode";
import type { Infer } from "@extynt/decode";

function workspaceRoot(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(directory, "pnpm-workspace.yaml"))) {
    const parent = resolve(directory, "..");
    if (parent === directory) throw new Error(`workspace root not found from ${import.meta.url}`);
    directory = parent;
  }
  return directory;
}

/** Read a workspace file by its repo-relative path, so the suite does not depend on the runner's cwd. */
export function repoFile(path: string): string { return readFileSync(join(workspaceRoot(), path), "utf8"); }

/** Every ExtendScript part of the probe and apply adapters (the collection and catalogue adapters excluded), concatenated. */
export function hostSource(): string {
  const names = readdirSync(join(workspaceRoot(), "apps/panel/host")).filter((name) => name.endsWith(".jsx") && !/^(collection|catalogue)/.test(name)).sort();
  return names.map((name) => repoFile(`apps/panel/host/${name}`)).join("\n");
}

/** The exact host build the committed verification ledger covers; approval refuses plan types with no evidence on it. */
export const VERIFIED_HOST = { hostKey: "26.2.1x2 (2) macOS/unknown" };
/** A write destination must live under the user's home, the same per-user location a real render or export uses. */
export const RENDER_OUTPUT = join(homedir(), "extynt-render-fixtures", "main.mov");
export const MOGRT_OUTPUT = join(homedir(), "extynt-render-fixtures", "t.mogrt");

/** The reported rollup of a job, as `ae_list_plans` and the authoring tools return it. */
export const jobShape = object({
  id: string(), title: string(), batches: number(), applied: number(), failed: number(), notApplied: number(), inFlight: number(), undone: number(),
  toUndo: array(string()), toApply: array(string()), undoOrderBasis: string(), remainingUndoGroups: number(), line: string(),
});

/** The rollup of a job as tests read it. */
export type JobShape = Infer<typeof jobShape>;

const verdictShape = object({
  index: number(), status: string(), detail: string(), code: optional(string()), fix: optional(string()),
  changes: optional(array(object({ field: string(), from: optional(jsonValue), to: jsonValue }))),
});

/** The `ae_plan_*` payload fields this suite reads. */
export const authorShape = object({
  planId: string(), verdicts: optional(array(verdictShape)), authored: optional(number()), sealed: optional(boolean()), next: optional(string()),
  notes: optional(array(string())), problems: optional(array(object({ index: number(), code: string() }))), batch: optional(number()),
  accepted: optional(number()), rejected: optional(number()), modified: optional(number()), jobId: optional(string()), job: optional(jobShape),
});

/** The authoring payload as tests read it. */
export type AuthorData = Infer<typeof authorShape>;

/** A tool context with an empty plan store. */
export const authoring = (): { snapshot: typeof representativeSnapshot; plans: Map<string, StoredPlan> } => ({ snapshot: representativeSnapshot, plans: new Map<string, StoredPlan>() });

/** Payload of a result whose `ok` the caller already asserted, decoded as the authoring view; a payload of another shape fails the test. */
export const dataOf = (result: Extract<ReturnType<typeof callTool>, { ok: true }>): AuthorData => decodeOrThrow(authorShape, result.data);
