// Reads and writes llm.env, the KEY=VALUE settings file that the launchd sidecar and the panel's settings form share.
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { REASONING_EFFORTS } from "@extynt/llm";
import { API_FORMATS, MODEL_SERVICES } from "./llm-model-services.js";

/** The settings a file or an environment layer holds: variable name to text. */
export type EnvValues = Readonly<Record<string, string>>;

const ASSIGNMENT = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/;
const NO_SETTINGS: EnvValues = Object.freeze({});

function parseEnvText(text: string): EnvValues {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const [, name, raw] = ASSIGNMENT.exec(line) ?? [];
    if (name !== undefined && raw !== undefined) values[name] = raw.replace(/^(["'])(.*)\1$/, "$2");
  }
  return values;
}

/** The settings in a KEY=VALUE file (`#` comments, optional quotes); a missing or unreadable file means no settings. */
export function loadLlmEnvFile(path: string): EnvValues {
  try {
    return parseEnvText(readFileSync(path, "utf8"));
  } catch {
    return NO_SETTINGS;
  }
}

const LLM_ENV_HEADER = `# extynt model settings. Edited by the panel (Diagnostics > Model) or by hand.
# AE_WORKFLOW_MAX_CYCLES (optional): 1-16 model cycles per authoring window; defaults to 16.
# A settled window can continue the same job; completion and the total cycle backstop remain reducer-owned.
# AE_LLM_PROVIDER: ${MODEL_SERVICES.map((service) => service.id).join(" | ")}
# AE_LLM_FORMAT (optional override): ${Object.keys(API_FORMATS).join(" | ")}
# AE_LLM_BASE_URL, AE_LLM_MODEL, AE_LLM_API_KEY; the same with AE_LLM_FALLBACK_ for the fallback model.
# AE_LLM_CONTEXT_WINDOW (optional): the model's total token window, when the service default is wrong or unknown.
# AE_LLM_REASONING_EFFORT (optional): ${REASONING_EFFORTS.join(" | ")}. Unset sends no effort and the provider decides; raise it for deeper planning, lower it for faster steps. A level the model does not offer is sent as the nearest one it does (the next higher first).
# AE_LLM_ACCEPTS_IMAGES (optional): true | false, when you know better than the model's own report; unset asks the model.
# AE_LLM_ALLOW_TRAINING_RISK (optional): 1 records that you accept a provider that may train on your prompts; the panel sets it, and changing the provider clears it.
# AE_LLM_STREAM (optional): 1 (default) streams the reply so the panel can show reasoning while a step runs; 0 disables it.
`;

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Writes the file atomically with owner-only permissions, variables in code-unit order so the bytes are the same on every machine; values are never logged. */
export function writeLlmEnvFile(path: string, values: EnvValues): void {
  mkdirSync(dirname(path), { recursive: true });
  const lines = Object.entries(values).sort(([left], [right]) => compareText(left, right)).map(([name, text]) => `${name}=${text}`);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${LLM_ENV_HEADER}${lines.join("\n")}\n`, { mode: 0o600 });
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}
