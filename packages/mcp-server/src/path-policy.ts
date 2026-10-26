// The model chooses file paths and the approval card is the only place a human sees them: writes stay inside the
// user's home directory or the verification placeholder, and no plan may name a system location as its source.
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ActionPlanV2Operation } from "@extynt/action-plan";
import { DENIED_PATH_ROOTS, HARNESS_OUTPUT_PLACEHOLDER, PATH_FIELD_USES } from "./core-constants.js";
import type { JsonValue } from "@extynt/decode";
import { operationJson } from "./operations.js";

type PathProblem = { code: string; message: string };

const MAX_PATH_CHARS = 1024;

function insideRoot(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function realLocation(path: string): string {
  const parent = dirname(path);
  try {
    return realpathSync.native(path);
  } catch {
    return parent === path ? path : join(realLocation(parent), basename(path));
  }
}

function writableRoots(): string[] {
  return [homedir(), realLocation(homedir()), HARNESS_OUTPUT_PLACEHOLDER];
}

function malformed(value: JsonValue | undefined): value is Exclude<JsonValue, string> | undefined {
  return typeof value !== "string" || !isAbsolute(value) || value.length > MAX_PATH_CHARS || value.includes("\0");
}

/** The refusal for a path an operation reads or writes, or undefined when the path is allowed. */
export function pathPolicyProblem(value: JsonValue | undefined, use: "destination" | "source", label: string): PathProblem | undefined {
  if (malformed(value)) return { code: "INVALID_VALUE", message: `The ${label} must be an absolute local path of at most ${MAX_PATH_CHARS} characters.` };
  if (value.startsWith("\\\\") || /^\/\/[^/]/.test(value)) return { code: "INVALID_ARGUMENT", message: `Refusing the ${label} ${value}: network (UNC) paths are not allowed.` };
  const typed = resolve(value);
  const resolved = realLocation(typed);
  const denied = DENIED_PATH_ROOTS.find((root) => insideRoot(root, typed) || insideRoot(root, resolved));
  if (denied) return { code: "INVALID_ARGUMENT", message: `Refusing the ${label} ${value}: it resolves inside ${denied}, a system location.` };
  const outside = use === "destination" && !writableRoots().some((root) => insideRoot(root, resolved));
  return outside ? { code: "INVALID_ARGUMENT", message: `Refusing the ${label} ${value}: writes must stay inside the user's home directory (${homedir()}).` } : undefined;
}

function operationPathProblem(operation: ActionPlanV2Operation): PathProblem | undefined {
  const spec = PATH_FIELD_USES[operation.type];
  const value = spec ? operationJson(operation)[spec.field] : undefined;
  if (!spec || (spec.optional && value === undefined)) return undefined;
  return pathPolicyProblem(value, spec.use, spec.label);
}

/** The first path problem among the operations of a plan, or undefined when every path is allowed. */
export function planPathProblem(operations: readonly ActionPlanV2Operation[]): PathProblem | undefined {
  return operations.map(operationPathProblem).find((problem) => problem !== undefined);
}
