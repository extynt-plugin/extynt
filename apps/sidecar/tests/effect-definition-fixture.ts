// Synthetic definition-store fixtures: one native-observed effect with one parameter, plus helpers that open a throwaway graph file.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import type { DefinitionProvenance, EffectDefinitionBundle, ParameterDefinitionFacts } from "@extynt/project-graph";
import { openGraphFile } from "../src/graph-file.js";
import { effectDefinitionId, parameterDefinitionId, writeEffectDefinitions } from "../src/effect-definition-store.js";
import type { DatabaseSync } from "node:sqlite";

export const HOST = "After Effects:1:Linux";
export const EFFECT = effectDefinitionId(HOST, "Synthetic Effect", null);
export const PARAMETER = parameterDefinitionId(EFFECT, "Synthetic Amount");
export const nativeSource = (): DefinitionProvenance => ({ id: "native-1", kind: "native-observation", sourceUrl: null, title: "Synthetic instance property metadata", hostKey: HOST, observedAt: 10, observationContext: "property-metadata", instanceBinding: "synthetic-instance:1/control:1" });
export const documentedSource = (): DefinitionProvenance => ({ id: "docs-1", kind: "authored-documentation", sourceUrl: "https://example.test/synthetic-control", title: "Synthetic authored documentation fixture", hostKey: null, observedAt: null, observationContext: null, instanceBinding: null });
export const unknownFacts = (provenanceId = "native-1"): ParameterDefinitionFacts => ({ parameterDefinitionId: PARAMETER, provenanceId, valueType: "OneD", units: null, minimum: 0, maximum: 100, defaultValue: { state: "unknown" }, description: null, meaning: null, canVaryOverTime: true, canSetExpression: true });
export function definitionBundle(): EffectDefinitionBundle {
  return {
    sources: [nativeSource(), documentedSource()], plugins: [],
    effects: [{ id: EFFECT, hostKey: HOST, matchName: "Synthetic Effect", displayName: "Synthetic effect", category: null, version: null, pluginId: null, provenanceId: "native-1" }],
    parameters: [{ id: PARAMETER, effectDefinitionId: EFFECT, matchName: "Synthetic Amount", path: "Synthetic Amount", displayName: "Synthetic amount", parentParameterId: null, ordinal: 1, provenanceId: "native-1" }],
    facts: [unknownFacts(), { ...unknownFacts("docs-1"), units: "synthetic-unit", defaultValue: { state: "known", value: 12 }, description: "Synthetic fixture control description", meaning: "Synthetic fixture semantic meaning" }],
  };
}
export function transaction(database: DatabaseSync, write: () => void): void {
  database.exec("BEGIN IMMEDIATE");
  try { write(); database.exec("COMMIT"); }
  catch (error) { database.exec("ROLLBACK"); throw error; }
}
export function definitionFixture(t: TestContext): { database: DatabaseSync; path: string } {
  const directory = mkdtempSync(join(tmpdir(), "extynt-definitions-")), path = join(directory, "fixture.extynt"), database = openGraphFile(path);
  t.after(() => { database.close(); rmSync(directory, { recursive: true, force: true }); });
  transaction(database, () => writeEffectDefinitions(database, definitionBundle()));
  return { database, path };
}

function onlyFirst<T>(items: T[], what: string): T {
  const first = items.at(0);
  if (first === undefined) throw new Error(`fixture has no ${what}`);
  return first;
}
export const firstEffect = (bundle: EffectDefinitionBundle): EffectDefinitionBundle["effects"][number] => onlyFirst(bundle.effects, "effect");
export const firstParameter = (bundle: EffectDefinitionBundle): EffectDefinitionBundle["parameters"][number] => onlyFirst(bundle.parameters, "parameter");
export const firstPlugin = (bundle: EffectDefinitionBundle): EffectDefinitionBundle["plugins"][number] => onlyFirst(bundle.plugins, "plugin");
