/**
 * Runs the real sidecar in-process with a recording provider, so a turn can be read back
 * afterwards: the reasoning text exists only inside `step()`, which a spawned child cannot hand
 * over. HOME moves to a temporary directory with the host profile copied in, and the built sidecar
 * modules are imported by path.  HOME and the engine search both point at that directory, so this sidecar can never start a real
 * headless engine.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { supportsTools } from "@extynt/llm";
import { defaultProfileDirectory, isolatedProfileDirectory, seedIsolatedProfile } from "./host-profile.js";
import { importSidecarModules, requireBuiltSidecarModules, type ModelSettingsStore, type SidecarServer } from "./sidecar-modules.js";
import { postChat, sidecarClient, type ChatRequest, type SidecarHandle } from "./sidecar-client.js";
import type { ChatResponse } from "./chat-wire.js";
import type { ChatTestProvider } from "./sidecar-spawn.js";
import { createTrace, tracingProvider, type TracedProvider, type Trace } from "./trace.js";
import { orNull, type TurnEndBody, type TurnStartBody } from "./trace-records.js";

/** A sidecar handle whose provider traffic is recorded. */
export interface TracedSidecarHandle extends SidecarHandle { trace: Trace }

function tracedProviderFor(trace: Trace, settings: ModelSettingsStore): TracedProvider {
  const built = settings.providers();
  const primary = built.primary;
  if (!primary) throw new Error(`No chat provider could be built: ${built.errors.join("; ") || "nothing is configured"}.`);
  if (!supportsTools(primary)) throw new Error(`${primary.displayMetadata.displayName} cannot call tools, so it cannot run a scenario.`);
  return tracingProvider(primary, trace);
}

function turnStart(body: ChatRequest): TurnStartBody {
  return { kind: "turn.start", message: body.message, requestId: body.requestId, ...(body.history?.length ? { history: body.history } : {}) };
}

function turnEnd(response: ChatResponse): TurnEndBody {
  const { body } = response;
  return {
    kind: "turn.end", status: response.status, outcome: orNull(body.outcome), steps: orNull(body.steps), stopReason: orNull(body.stopReason),
    usage: orNull(body.usage), provider: orNull(body.provider), model: orNull(body.model),
    plans: (body.plans ?? []).map((plan) => ({ planId: plan.planId, title: plan.title })),
    notes: orNull(body.notes), failure: orNull(body.failure), answer: body.answer ?? "",
  };
}

interface RunningSidecar {
  port: number;
  token: string;
  seeded: string[];
  profileSource: string;
  trace: Trace;
  server: SidecarServer;
  home: string;
  restoreHome: () => void;
}

function tracedHandle(running: RunningSidecar): TracedSidecarHandle {
  const { port, token, trace, server, home, restoreHome } = running;
  return {
    ...sidecarClient(port, token),
    port, token, trace, isolatedHome: home, seeded: running.seeded, profileSource: running.profileSource, logLines: [],
    async chat(body) {
      trace.record(turnStart(body));
      const response = await postChat(port, token, { ...body });
      trace.record(turnEnd(response));
      return response;
    },
    async stop() {
      try { await server.stop(); } finally { restoreHome(); rmSync(home, { recursive: true, force: true }); }
    },
  };
}

async function launch(provider: ChatTestProvider, trace: Trace, home: string, profileSource: string): Promise<RunningSidecar> {
  const seeded = seedIsolatedProfile(home, profileSource);
  const modules = await importSidecarModules();
  const stateDirectory = isolatedProfileDirectory(home);
  const settings = modules.createModelSettingsStore({
    filePath: join(home, "llm.env"),
    dotEnvPath: join(home, ".env"),
    processEnv: { ...process.env, ...(provider.kind === "mock" ? { AE_LLM_PROVIDER: "mock" } : provider.environment), AE_LLM_ACCEPTS_IMAGES: "false" },
  });
  const token = randomBytes(18).toString("base64url");
  const server = modules.createSidecar({
    port: 0, token, chatProvider: tracedProviderFor(trace, settings), quietAgentLog: true, diagnostics: { enabled: false },
    catalogueProbe: true, stateDirectory, discoveryPath: join(stateDirectory, "native.json"),
  });
  const address = await server.start();
  return { port: address.port, token, seeded, profileSource, trace, server, home, restoreHome: () => undefined };
}

function isolateEnvironment(home: string): () => void {
  const names = ["HOME", "EXTYNT_ENGINE_APPLICATIONS"] as const;
  const previous = names.map((name) => process.env[name]);
  for (const name of names) process.env[name] = home;
  return () => names.forEach((name, index) => {
    const value = previous[index];
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  });
}

/** Starts the sidecar in this process with its provider wrapped by `trace`. */
export async function startTracedSidecar(
  provider: ChatTestProvider,
  options: { trace?: Trace | undefined; profileDirectory?: string | undefined } = {},
): Promise<TracedSidecarHandle> {
  requireBuiltSidecarModules();
  const trace = options.trace ?? createTrace();
  const home = mkdtempSync(join(tmpdir(), "extynt-chat-trace-"));
  const restoreEnvironment = isolateEnvironment(home);
  try {
    const running = await launch(provider, trace, home, options.profileDirectory ?? defaultProfileDirectory());
    return tracedHandle({ ...running, restoreHome: restoreEnvironment });
  } catch (error) {
    restoreEnvironment();
    rmSync(home, { recursive: true, force: true });
    throw error;
  }
}
