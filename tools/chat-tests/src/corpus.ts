/** Contracts for real-project benchmark sources and their reviewable, sanitized snapshot derivatives. */
import { readFileSync } from "node:fs";
import { array, boolean, decodeJson, literal, number, object, optional, string } from "@extynt/decode";
import type { Decoder, Infer } from "@extynt/decode";

/** The schema version every corpus file carries. */
export const BENCHMARK_CORPUS_SCHEMA = "0.1" as const;
/** Whether a source project may be committed, stays local, or was generated. */
export type ProjectDistribution = "local-only" | "redistributable" | "generated";

const slug = string({ pattern: /^[a-z0-9][a-z0-9-]{0,63}$/ });
const sha256 = string({ pattern: /^[a-f0-9]{64}$/ });
const strings = array(string());

const pluginRequirementOf = object({
  provider: string(), package: string(), version: optional(string()), matchNames: strings, required: boolean(),
});

const scenarioOf = object({
  id: string(), promptFile: string(), expectedComposition: string(), expectedLayer: optional(string()),
  expectedPropertyPaths: optional(strings), allowedOperationTypes: strings, forbiddenTargets: optional(strings), safeRefusal: optional(boolean()),
});

const projectManifestOf = object({
  schemaVersion: literal(BENCHMARK_CORPUS_SCHEMA),
  id: slug,
  title: string(),
  source: object({ projectFile: string(), distribution: literal("local-only", "redistributable", "generated"), license: optional(string()), sha256 }),
  companionFiles: array(object({ path: string(), sha256, role: literal("footage", "audio", "font-license", "reference-render") })),
  requirements: object({ afterEffects: string(), fonts: strings, plugins: array(pluginRequirementOf) }),
  derived: object({ initialProbe: string(), expectedStructure: string(), sanitized: literal(true) }),
  scenarios: array(scenarioOf, { minLength: 1 }),
  review: object({ containsPersonalData: boolean(), containsClientMaterial: boolean(), approvedForCommit: boolean(), notes: optional(string()) }),
});

const layerOf = object({
  id: optional(string()), name: string(), type: optional(string()), selected: optional(boolean()),
  propertyPaths: optional(strings), effectMatchNames: optional(strings),
});

const compositionOf = object({
  id: optional(string()), name: string(), width: optional(number()), height: optional(number()),
  duration: optional(number()), frameRate: optional(number()), layers: array(layerOf),
});

const expectedStructureOf = object({
  schemaVersion: literal(BENCHMARK_CORPUS_SCHEMA),
  projectId: slug,
  initialFingerprint: sha256,
  activeComposition: string({ nonEmpty: true }),
  compositions: array(compositionOf, { minLength: 1 }),
});

/** One plugin a benchmark project needs. */
export type BenchmarkPluginRequirement = Infer<typeof pluginRequirementOf>;
/** The manifest of one real-project benchmark. */
export type BenchmarkProjectManifest = Infer<typeof projectManifestOf>;
/** The sanitized structure a benchmark project is expected to read back as. */
export type BenchmarkExpectedStructure = Infer<typeof expectedStructureOf>;

function readDecoded<T>(path: string, decoder: Decoder<T>): T {
  const decoded = decodeJson(readFileSync(path, "utf8"), decoder);
  if (!decoded.ok) throw new Error(`${path}: ${decoded.error.message}`);
  return decoded.value;
}

/** Reads and checks a benchmark project manifest, throwing with the file and the first wrong field. */
export function readBenchmarkProjectManifest(path: string): BenchmarkProjectManifest {
  return readDecoded(path, projectManifestOf);
}

/** Reads and checks an expected-structure file, throwing with the file and the first wrong field. */
export function readExpectedStructure(path: string): BenchmarkExpectedStructure {
  return readDecoded(path, expectedStructureOf);
}
