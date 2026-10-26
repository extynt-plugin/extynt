// The entry point of the sidecar process: reads the boot environment, builds the options and starts the server.
import { ReadOnlySidecar } from "./server.js";
import { randomBytes } from "node:crypto";
import { writeSessionFile } from "@extynt/mcp-server/session";
import { isAbsolute, join } from "node:path";
import { platform } from "node:os";
import { createModelSettingsStore } from "./llm-config.js";
import { decisionModelsOf } from "./decision-settings.js";
import { createDecisionSettings } from "./decision-settings-service.js";
import { loadEnvironmentLayers } from "./llm-env-layers.js";
import { profileDirectory } from "./profile-store.js";
import { resolveWorkflowRuntimeSettings } from "./runtime-config.js";
import { svgConverterSwitch } from "./svg-converter-switch.js";
import { pruneStaleSidecarLogs } from "./server-agent-logs.js";

interface BootEnv {
  requestedPort: number;
  token: string;
  diagnosticsEnabled: boolean;
  uiDirectory: string | undefined;
  maxAgentSteps: number | undefined;
}

function readRequestedPort(env: NodeJS.ProcessEnv): number {
  const requestedPort = env.AE_BRIDGE_PORT ? Number(env.AE_BRIDGE_PORT) : 3210;
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
    throw new Error("AE_BRIDGE_PORT must be an integer from 0 to 65535.");
  }
  return requestedPort;
}

function readUiDirectory(env: NodeJS.ProcessEnv): string | undefined {
  const uiDirectory = env.EXTYNT_UI_DIRECTORY || undefined;
  if (uiDirectory !== undefined && !isAbsolute(uiDirectory)) throw new Error("EXTYNT_UI_DIRECTORY must be an absolute path.");
  return uiDirectory;
}

function readMaxAgentSteps(env: NodeJS.ProcessEnv): number | undefined {
  const maxAgentSteps = env.AE_AGENT_MAX_STEPS ? Number(env.AE_AGENT_MAX_STEPS) : undefined;
  if (maxAgentSteps !== undefined && (!Number.isInteger(maxAgentSteps) || maxAgentSteps < 1)) {
    throw new Error("AE_AGENT_MAX_STEPS must be a positive integer.");
  }
  return maxAgentSteps;
}

function readBootEnv(env: NodeJS.ProcessEnv): BootEnv {
  return {
    requestedPort: readRequestedPort(env),
    token: env.AE_BRIDGE_TOKEN || randomBytes(24).toString("base64url"),
    diagnosticsEnabled: env.AE_DIAGNOSTICS === "1",
    uiDirectory: readUiDirectory(env),
    maxAgentSteps: readMaxAgentSteps(env),
  };
}

function llmEnvDisplayPath(): string {
  if (platform() === "darwin") return "~/Library/Application Support/extynt/llm.env";
  if (platform() === "win32") return "%LOCALAPPDATA%\\extynt\\llm.env";
  return "~/.config/extynt/llm.env";
}

function bootModelSettings(settingsFile: string, dotEnvFile: string) {
  const initialLayers = loadEnvironmentLayers({ filePath: settingsFile, dotEnvPath: dotEnvFile, processEnv: process.env });
  const { workflowMaxCycles, retiredEngineSetting } = resolveWorkflowRuntimeSettings({ layers: initialLayers });
  const modelSettings = createModelSettingsStore({ filePath: settingsFile, dotEnvPath: dotEnvFile, processEnv: process.env, initialLayers, discoverCapabilities: true, displayPath: llmEnvDisplayPath() });
  const initialModels = modelSettings.providers();
  process.stdout.write(`Chat model: ${initialModels.primary ? initialModels.primary.displayMetadata.displayName : "none (set one in the panel: Diagnostics > Model)"}${initialModels.fallback ? `, fallback ${initialModels.fallback.displayMetadata.displayName}` : ""}\n`);
  process.stdout.write(`Workflow engine: workflow-v1${workflowMaxCycles === undefined ? "" : ` (max ${workflowMaxCycles} cycles)`}\n`);
  if (retiredEngineSetting) process.stdout.write(`Workflow engine: ignoring AE_WORKFLOW_ENGINE=${retiredEngineSetting}; workflow-v1 is the only engine.\n`);
  const svgSwitch = svgConverterSwitch(process.env);
  if (svgSwitch.line) process.stdout.write(`${svgSwitch.line}\n`);
  for (const error of initialModels.errors) process.stdout.write(`Model settings: ${error}\n`);
  return { modelSettings, workflowMaxCycles, svgSwitch };
}

function buildSidecarOptions(boot: BootEnv, modelSettings: ReturnType<typeof createModelSettingsStore>, workflowMaxCycles: number | undefined, svgSwitch: ReturnType<typeof svgConverterSwitch>) {
  const sources = { filePath: join(profileDirectory(), "llm.env"), dotEnvPath: join(process.cwd(), ".env"), processEnv: process.env };
  const decisionModels = decisionModelsOf(sources);
  const cycleCeiling = Number(process.env.AE_WORKFLOW_CYCLE_CEILING);
  return {
    port: boot.requestedPort,
    token: boot.token,
    diagnostics: { enabled: boot.diagnosticsEnabled, developmentOnly: true },
    modelSettings,
    decisionModels,
    decisionSettings: createDecisionSettings({ sources, displayPath: llmEnvDisplayPath() }),
    catalogueProbe: process.env.EXTYNT_CATALOGUE_PROBE !== "0",
    svgForceConverter: svgSwitch.force,
    ...(boot.uiDirectory !== undefined ? { uiDirectory: boot.uiDirectory } : {}),
    ...(workflowMaxCycles !== undefined ? { workflowMaxCycles } : {}),
    ...(process.env.AE_WORKFLOW_SINGLE_LOOP === "0" ? { workflowSingleLoop: false } : {}),
    ...(cycleCeiling >= 1 ? { workflowCycleCeiling: cycleCeiling } : {}),
    workflowFreeRun: process.env.AE_WORKFLOW_FREE_RUN !== "0",
    workflowDesignApproval: process.env.AE_WORKFLOW_DESIGN_APPROVAL !== "0",
    ...(boot.maxAgentSteps !== undefined ? { maxAgentSteps: boot.maxAgentSteps } : {}),
  };
}

async function main(): Promise<void> {
  const boot = readBootEnv(process.env);
  pruneStaleSidecarLogs(profileDirectory());
  const settingsFile = join(profileDirectory(), "llm.env");
  const dotEnvFile = join(process.cwd(), ".env");
  const { modelSettings, workflowMaxCycles, svgSwitch } = bootModelSettings(settingsFile, dotEnvFile);
  const sidecar = new ReadOnlySidecar(buildSidecarOptions(boot, modelSettings, workflowMaxCycles, svgSwitch));
  const address = await sidecar.start();
  writeSessionFile({ port: address.port, token: boot.token });
  process.stdout.write(`extynt sidecar listening at http://${address.host}:${address.port}\n`);
  process.stdout.write(`Session file: (per-user pairing file written for co-located callers)\n`);
  process.stdout.write(`Latest snapshot: use a paired local panel or MCP client; credentials are never written to logs.\n`);

  const shutdown = async (): Promise<void> => {
    await sidecar.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => { void shutdown(); });
  process.once("SIGTERM", () => { void shutdown(); });
}

async function runMain(): Promise<void> {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`extynt sidecar failed to start: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  }
}

void runMain();
