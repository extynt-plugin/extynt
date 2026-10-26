/** The operator's own `.env`, where a live run finds its provider and key. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./repo-root.js";

function readDotEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const values: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const at = line.indexOf("=");
    if (at < 0 || line.trimStart().startsWith("#")) continue;
    values[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^["']|["']$/g, "");
  }
  return values;
}

/**
 * Live runs read the operator's own `.env`, where the provider key already lives. The value
 * goes to the child environment and is never logged.
 */
export function liveEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(readDotEnv(join(REPO_ROOT, ".env")))) {
    if (value && (key.endsWith("_API_KEY") || key.startsWith("AE_LLM_"))) environment[key] = value;
  }
  return environment;
}
