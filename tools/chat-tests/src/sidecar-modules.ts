/**
 * Loads the built sidecar's server and model-settings modules by file path, for the harness that runs the sidecar in this
 * process.  A tool may not depend on an app, so each module is imported at run time and checked as it is used: its exports
 * must be functions, and every answer is decoded into the shape the harness declares.  `SidecarModules` is the two
 * exports the harness calls; `SidecarLaunchOptions` and `ModelSettingsOptions` are the options it gives them.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { absentAs, array, importFunctions, nullValue, number, object, string, type Foreign } from "@extynt/decode";
import type { ChatProvider } from "@extynt/llm";
import { foreignProvider } from "./foreign-provider.js";
import { REPO_ROOT } from "./repo-root.js";

const SERVER_MODULE = join(REPO_ROOT, "apps/sidecar/dist/src/server.js");
const LLM_CONFIG_MODULE = join(REPO_ROOT, "apps/sidecar/dist/src/llm-config.js");

/** The part of the sidecar's model settings the harness reads: the provider it would chat with. */
export interface ModelSettingsStore {
  providers(): { readonly primary?: ChatProvider; readonly errors: readonly string[] };
}

/** A sidecar server that can be started and stopped. */
export interface SidecarServer {
  start(): Promise<{ readonly port: number }>;
  stop(): Promise<void>;
}

interface ModelSettingsOptions { filePath: string; dotEnvPath: string; processEnv: NodeJS.ProcessEnv }

interface SidecarLaunchOptions {
  port: number; token: string; chatProvider: ChatProvider; quietAgentLog: boolean; diagnostics: { enabled: boolean };
  catalogueProbe: boolean; stateDirectory: string; discoveryPath: string;
}

interface SidecarModules {
  createSidecar: (options: SidecarLaunchOptions) => SidecarServer;
  createModelSettingsStore: (options: ModelSettingsOptions) => ModelSettingsStore;
}

const startedDecoder = object({ port: number() });
const nothingDecoder = absentAs(nullValue, undefined);
const providerSetDecoder = object({ errors: array(string()) });

/** Throws unless the sidecar has been built. */
export function requireBuiltSidecarModules(): void {
  for (const module of [SERVER_MODULE, LLM_CONFIG_MODULE]) {
    if (!existsSync(module)) throw new Error(`The sidecar is not built: ${module} is missing. Run \`pnpm build\` first.`);
  }
}

function serverOf(instance: Foreign): SidecarServer {
  return {
    start: () => instance.invoke("start", []).intoAwaited(startedDecoder),
    stop: () => instance.invoke("stop", []).intoAwaited(nothingDecoder).then(() => undefined),
  };
}

function storeOf(instance: Foreign): ModelSettingsStore {
  return {
    providers() {
      const set = instance.invoke("providers", []);
      const { errors } = set.into(providerSetDecoder);
      const primary = set.read("primary");
      return primary.isUndefined() ? { errors } : { primary: foreignProvider(primary), errors };
    },
  };
}

/** Imports the built modules by path and returns the two exports the harness calls, each checked to be a function and each answer decoded. */
export async function importSidecarModules(): Promise<SidecarModules> {
  const server = await importFunctions(pathToFileURL(SERVER_MODULE).href, ["ReadOnlySidecar"]);
  const settings = await importFunctions(pathToFileURL(LLM_CONFIG_MODULE).href, ["createModelSettingsStore"]);
  return {
    createSidecar: (options) => serverOf(server.read("ReadOnlySidecar").construct([options])),
    createModelSettingsStore: (options) => storeOf(settings.invoke("createModelSettingsStore", [options])),
  };
}
