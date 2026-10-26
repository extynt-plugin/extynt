/** Spawns the shipped sidecar entry point as a child process and waits for the port it reports. */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { decodeJson } from "@extynt/decode";
import { wireObject } from "@extynt/fake-plugin";
import { REPO_ROOT } from "./repo-root.js";
import type { WireObject } from "./wire-types.js";

/** The built sidecar entry point. */
export const SIDECAR_ENTRY = join(REPO_ROOT, "apps/sidecar/dist/src/main.js");

/** Which model a chat test talks to: the scripted mock, or a live provider configured through environment variables. */
export type ChatTestProvider = { kind: "mock" } | { kind: "live"; environment: Record<string, string> };

/** The workflow switches a test can turn on for the sidecar it starts. */
export interface WorkflowOptions {
  workflowMaxCycles?: number;
  workflowCycleCeiling?: number;
  workflowProviderFailureAfterSeal?: boolean;
  workflowNeverCompletes?: boolean;
  workflowFreeRun?: boolean;
  workflowStagedCycles?: boolean;
}

interface SpawnRequest {
  provider: ChatTestProvider;
  workflow: WorkflowOptions;
  home: string;
  token: string;
  timeoutMs: number;
  logLines: WireObject[];
}

interface SpawnedSidecar { child: ChildProcessWithoutNullStreams; port: number }

function workflowEnvironment(options: WorkflowOptions): Record<string, string> {
  const environment: Record<string, string> = { AE_WORKFLOW_FREE_RUN: options.workflowFreeRun ? "1" : "0" };
  if (options.workflowMaxCycles !== undefined) environment.AE_WORKFLOW_MAX_CYCLES = String(options.workflowMaxCycles);
  if (options.workflowCycleCeiling !== undefined) environment.AE_WORKFLOW_CYCLE_CEILING = String(options.workflowCycleCeiling);
  if (options.workflowProviderFailureAfterSeal) environment.AE_MOCK_PROVIDER_FAILURE_AFTER_SEAL = "1";
  if (options.workflowStagedCycles) environment.AE_WORKFLOW_SINGLE_LOOP = "0";
  if (options.workflowNeverCompletes) environment.AE_MOCK_PROVIDER_NEVER_COMPLETE = "1";
  return environment;
}

function childEnvironment(request: SpawnRequest): NodeJS.ProcessEnv {
  const provider = request.provider.kind === "mock" ? { AE_LLM_PROVIDER: "mock" } : request.provider.environment;
  return {
    ...process.env, HOME: request.home, EXTYNT_ENGINE_APPLICATIONS: request.home, AE_BRIDGE_PORT: "0", AE_BRIDGE_TOKEN: request.token,
    ...provider, AE_LLM_ACCEPTS_IMAGES: "false", ...workflowEnvironment(request.workflow),
  };
}

function collectLogLines(chunk: string, logLines: WireObject[]): void {
  for (const line of chunk.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    const decoded = decodeJson(trimmed, wireObject);
    if (decoded.ok) logLines.push(decoded.value);
  }
}

function waitForPort(child: ChildProcessWithoutNullStreams, output: () => string, timeoutMs: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const timer = setInterval(() => {
      const stdout = output();
      const match = /listening at http:\/\/127\.0\.0\.1:(\d+)/.exec(stdout);
      if (match) { clearInterval(timer); resolve(Number(match[1])); return; }
      if (Date.now() > deadline) { clearInterval(timer); reject(new Error(`The sidecar did not start within ${timeoutMs}ms.\n${stdout}`)); }
      if (child.exitCode !== null) { clearInterval(timer); reject(new Error(`The sidecar exited with ${child.exitCode}.\n${stdout}`)); }
    }, 50);
  });
}

/** Spawns the sidecar with its own HOME and resolves once it reports the port it bound. */
export async function spawnSidecar(request: SpawnRequest): Promise<SpawnedSidecar> {
  const child = spawn(process.execPath, [SIDECAR_ENTRY], { cwd: REPO_ROOT, env: childEnvironment(request) });
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    const mirror = process.env.CHAT_TESTS_SIDECAR_LOG;
    if (mirror) appendFileSync(mirror, chunk);
    collectLogLines(chunk, request.logLines);
  });
  const port = await waitForPort(child, () => stdout, request.timeoutMs);
  return { child, port };
}

/** Stops a child politely, then forcibly after two seconds. */
export async function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) { resolve(); return; }
    child.once("exit", () => resolve());
    setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 2_000);
  });
}
