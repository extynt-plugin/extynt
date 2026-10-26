// The per-user pairing file: a local sidecar and a local MCP launcher agree on the bridge address and bearer token without a human copying either.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { decodeJson, number, object, string } from "@extynt/decode";
import type { Infer } from "@extynt/decode";
import { stateDirectory } from "@extynt/host-native";

const sessionFile = object({ port: number({ int: true }), token: string({ nonEmpty: true }) });

/** The sidecar's loopback port and the bearer token that authorises calls to it. */
export type SessionFile = Infer<typeof sessionFile>;

/** Where this computer keeps the pairing file. */
export function sessionFilePath(): string {
  return join(stateDirectory(), "session.json");
}

/** Writes the pairing file beside its target and renames it into place, so a reader never sees a truncated file; it is created 0600 because the token is a bearer credential. */
export function writeSessionFile(session: SessionFile): void {
  const path = sessionFilePath();
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(session), { mode: 0o600 });
  renameSync(temporary, path);
}

/** The pairing file, or undefined when it is absent, unreadable or malformed so callers fall back to explicit configuration. */
export function readSessionFile(): SessionFile | undefined {
  try {
    const outcome = decodeJson(readFileSync(sessionFilePath(), "utf8"), sessionFile);
    return outcome.ok ? outcome.value : undefined;
  } catch {
    return undefined;
  }
}
