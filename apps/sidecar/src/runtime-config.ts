// Workflow runtime settings read from the layered llm.env, so the packaged service (which has no login shell) uses the same precedence as model settings.
import { effectiveEnvironment, loadEnvironmentLayers, type EnvironmentLayers } from "./llm-env-layers.js";

interface WorkflowRuntimeSettings { workflowMaxCycles?: number; retiredEngineSetting?: string }

const MAX_CYCLES = 16;

function workflowMaxCycles(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const cycles = Number(text);
  if (!Number.isInteger(cycles) || cycles < 1 || cycles > MAX_CYCLES) throw new Error(`AE_WORKFLOW_MAX_CYCLES must be an integer from 1 through ${MAX_CYCLES}.`);
  return cycles;
}

/** Resolves the workflow settings from environment layers, or from the files and process environment that make them. */
export function resolveWorkflowRuntimeSettings(options: { layers: EnvironmentLayers } | { filePath: string; dotEnvPath?: string; processEnv?: Record<string, string | undefined> }): WorkflowRuntimeSettings {
  const env = effectiveEnvironment("layers" in options ? options.layers : loadEnvironmentLayers(options));
  const cycles = workflowMaxCycles(env.AE_WORKFLOW_MAX_CYCLES);
  const retired = env.AE_WORKFLOW_ENGINE?.trim();
  return { ...(cycles !== undefined ? { workflowMaxCycles: cycles } : {}), ...(retired && retired !== "workflow-v1" ? { retiredEngineSetting: retired } : {}) };
}
