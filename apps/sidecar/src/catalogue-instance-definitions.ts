// Records the control structure read from a real effect in the user's project, for effects that cannot be applied to the catalogue's test layer.
import type { DatabaseSync } from "node:sqlite";
import type { DefinitionProvenance } from "@extynt/project-graph";
import { effectControlDefinitions } from "./catalogue-controls.js";
import type { CatalogueInstanceRead } from "./catalogue-page.js";
import { INSTANCE_SOURCES, definedEffectId, observationSourceId, writeObservation } from "./catalogue-sources.js";

/** The title records what the observation covers ("full tree" as in catalogueProbeTitle: reads before it were cut at 96 rows, so they are read again). */
export function catalogueInstanceTitle(build: string | null, version: string | null): string {
  return `Native effect controls read from a project instance (AE build ${build ?? "unknown"}; effect version ${version ?? "unversioned"}; defaults unknown; full tree)`;
}

/** The `matchName\0title` key under which a read effect counts as collected. */
export function catalogueInstanceKey(matchName: string, build: string | null, version: string | null): string {
  return `${matchName}\0${catalogueInstanceTitle(build, version)}`;
}

/** One effect read from the project: which host and run read it, when, and the control tree that came back. */
export interface CatalogueInstanceWrite { hostKey: string; runId: string; observedAt: number; hostBuild: string | null; version: string | null; read: CatalogueInstanceRead }

/** One read effect: its provenance and control tree, every default unknown. Throws on any invalid row; the caller's transaction rolls it back. */
export function writeCatalogueInstance(database: DatabaseSync, input: CatalogueInstanceWrite): void {
  const { hostKey, runId, observedAt, hostBuild, version, read } = input;
  const effectId = definedEffectId(database, input, read.matchName);
  const sourceId = observationSourceId(INSTANCE_SOURCES, input, read.matchName);
  const source: DefinitionProvenance = {
    id: sourceId, kind: "native-observation", sourceUrl: null, title: catalogueInstanceTitle(hostBuild, version), hostKey, observedAt,
    observationContext: INSTANCE_SOURCES.context, instanceBinding: `${INSTANCE_SOURCES.prefix}${runId}:${read.matchName}`,
  };
  writeObservation(database, source, effectControlDefinitions(effectId, sourceId, read.controls, false));
}
