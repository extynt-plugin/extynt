/**
 * Launches the real sidecar by spawning the shipped entry point, so a chat test exercises
 * argument parsing, model settings resolution, the HTTP routes and the agent loop as they ship.
 * The child gets its own HOME: nothing here can touch the operator's real profile.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultProfileDirectory, isolatedProfileDirectory, seedIsolatedProfile } from "./host-profile.js";
import { installPluginEndpoint } from "./plugin-endpoint.js";
import { postChat, sidecarClient, type SidecarHandle } from "./sidecar-client.js";
import { SIDECAR_ENTRY, spawnSidecar, stopChild, type ChatTestProvider, type WorkflowOptions } from "./sidecar-spawn.js";

/** What a test can ask of the sidecar it starts. */
export interface SidecarStartOptions extends WorkflowOptions {
  timeoutMs?: number;
  profileDirectory?: string | undefined;
  isolatedHome?: string;
  preserveHome?: boolean;
  pluginEndpoint?: string;
}

const isolatedHomes = new Set<string>();
process.on("exit", () => {
  for (const home of isolatedHomes) {
    try { rmSync(home, { recursive: true, force: true }); } catch { }
  }
});

/** Starts a sidecar child process with an isolated HOME and the given provider. */
export async function startSidecar(provider: ChatTestProvider, options: SidecarStartOptions = {}): Promise<SidecarHandle> {
  if (!existsSync(SIDECAR_ENTRY)) throw new Error(`The sidecar is not built: ${SIDECAR_ENTRY} is missing. Run \`pnpm build\` first.`);
  const home = options.isolatedHome ?? mkdtempSync(join(tmpdir(), "extynt-chat-test-"));
  isolatedHomes.add(home);
  const profileSource = options.profileDirectory ?? defaultProfileDirectory();
  const seeded = options.isolatedHome ? [] : seedIsolatedProfile(home, profileSource);
  if (options.pluginEndpoint) installPluginEndpoint(options.pluginEndpoint, isolatedProfileDirectory(home));
  const token = randomBytes(18).toString("base64url");
  const logLines: SidecarHandle["logLines"] = [];
  const { child, port } = await spawnSidecar({ provider, workflow: options, home, token, timeoutMs: options.timeoutMs ?? 15_000, logLines });
  return {
    ...sidecarClient(port, token),
    port, token, isolatedHome: home, seeded, profileSource, logLines,
    chat: (body) => postChat(port, token, { autoApply: true, ...body }),
    async stop() {
      await stopChild(child);
      if (options.preserveHome) return;
      rmSync(home, { recursive: true, force: true });
      isolatedHomes.delete(home);
    },
  };
}
