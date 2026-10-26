// The three places a model setting can come from (llm.env, a development .env, the process environment) and which one wins.
import { loadLlmEnvFile, type EnvValues } from "./llm-env-file.js";

/** The settings of each layer; `process` may carry unset names. */
export interface EnvironmentLayers {
  readonly file: EnvValues;
  readonly dotEnv: EnvValues;
  readonly process: Readonly<Record<string, string | undefined>>;
}

/** The files and process environment that make up the layers. */
export interface EnvironmentSources {
  readonly filePath: string;
  readonly dotEnvPath?: string | undefined;
  readonly processEnv?: Readonly<Record<string, string | undefined>> | undefined;
}

/** Where a winning setting came from, as the settings form names it. */
export type EnvSource = "environment" | ".env" | "llm.env";

const LAYER_SOURCES = [["process", "environment"], ["dotEnv", ".env"], ["file", "llm.env"]] as const satisfies ReadonlyArray<readonly [keyof EnvironmentLayers, EnvSource]>;

function isSet(text: string | undefined): text is string {
  return typeof text === "string" && text.trim() !== "";
}

function setValuesOf(layer: Readonly<Record<string, string | undefined>>): EnvValues {
  const values: Record<string, string> = {};
  for (const [name, text] of Object.entries(layer)) if (isSet(text)) values[name] = text;
  return values;
}

/** Reads llm.env, the optional .env and the given process environment into layers. */
export function loadEnvironmentLayers(sources: EnvironmentSources): EnvironmentLayers {
  return { file: loadLlmEnvFile(sources.filePath), dotEnv: sources.dotEnvPath ? loadLlmEnvFile(sources.dotEnvPath) : {}, process: sources.processEnv ?? {} };
}

/** The settings that count: an empty value (AE_LLM_PROVIDER= in a shell) means "not set", never "override with nothing"; the process environment beats .env, which beats llm.env. */
export function effectiveEnvironment(layers: EnvironmentLayers): Readonly<Record<string, string | undefined>> {
  return { ...setValuesOf(layers.file), ...setValuesOf(layers.dotEnv), ...setValuesOf(layers.process) };
}

/** The layer that supplies this setting, or undefined when none does. */
export function sourceOf(layers: EnvironmentLayers, name: string): EnvSource | undefined {
  return LAYER_SOURCES.find(([layer]) => isSet(layers[layer][name]))?.[1];
}
