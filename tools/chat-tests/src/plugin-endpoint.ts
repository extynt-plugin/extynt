/** Real-plugin mode: the sidecar finds a running plugin (for example After Effects over a forwarded port) through a copy of its native.json. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readPluginEndpoint } from "@extynt/host-native";

/**
 * Validates `source` and writes a copy into `stateDirectory` without its pid: the plugin runs on another machine, so a pid that is
 * not alive here must not make discovery reject the file as stale. The token is copied, never returned or logged.
 */
export function installPluginEndpoint(source: string, stateDirectory: string): string {
  const found = readPluginEndpoint(source, () => true);
  if (!found.ok) throw new Error(`--plugin-endpoint ${source}: ${found.message}`);
  const { port, token, aeVersion, pluginVersion } = found.endpoint;
  const target = join(stateDirectory, "native.json");
  mkdirSync(stateDirectory, { recursive: true });
  writeFileSync(target, JSON.stringify({ port, token, ...(aeVersion ? { aeVersion } : {}), ...(pluginVersion ? { pluginVersion } : {}) }), { mode: 0o600 });
  return target;
}
