// Bounded pruning of superseded definition history, run inside the transaction that writes a newer bundle; desired lineage is never pruned.
import type { DatabaseSync } from "node:sqlite";
import { number, object, string } from "@extynt/decode";
import type { DefinitionProvenance, EffectDefinitionBundle } from "@extynt/project-graph";
import { definitionSource } from "./effect-definition-rows.js";
import { execute, selectAll, selectOne } from "./graph-sql.js";

const MAX_BUNDLE_FACTS = 25;
const MAX_BUNDLE_SOURCES = 64;
const MAX_BUNDLE_EFFECTS = 64;
const MAX_INVENTORY_SOURCES = 10000;
const SOURCE_BY_ID_SQL = "SELECT * FROM definition_sources WHERE id=?";
const PREVIOUS_PROVENANCE_SQL = "SELECT provenance_id FROM effect_definitions WHERE id=?";
const DELETE_FACTS_SQL = "DELETE FROM parameter_definition_facts WHERE parameter_definition_id=? AND provenance_id=?";
const DELETE_SOURCE_SQL = "DELETE FROM definition_sources WHERE id=?";
const DESIRED_LINEAGE_SQL = "SELECT 1 AS present FROM desired_control_requests LIMIT 1";

const ROOTS = `NOT EXISTS(SELECT 1 FROM plugin_definitions WHERE provenance_id=s.id)
 AND NOT EXISTS(SELECT 1 FROM effect_definitions WHERE provenance_id=s.id)
 AND NOT EXISTS(SELECT 1 FROM parameter_definitions WHERE provenance_id=s.id)`;

const DELETE_INVENTORY_SOURCE_SQL = `DELETE FROM definition_sources AS s WHERE s.id=? AND ${ROOTS} AND NOT EXISTS(SELECT 1 FROM parameter_definition_facts WHERE provenance_id=s.id)`;

/** The query that finds metadata facts with no default or documentation that a newer observation of the same instance supersedes (all but the newest seven). */
export const DEFINITION_RETENTION_FACT_QUERY = `SELECT f.parameter_definition_id,f.provenance_id FROM definition_sources s INDEXED BY definition_sources_native_age
 CROSS JOIN parameter_definition_facts f WHERE s.kind='native-observation' AND s.observation_context='property-metadata'
 AND s.host_key=? AND s.instance_binding=? AND s.observed_at<? AND f.parameter_definition_id=? AND f.provenance_id=s.id
 AND f.default_state='unknown' AND f.documentation IS NULL AND f.meaning IS NULL AND ${ROOTS}
 ORDER BY s.observed_at DESC,s.id DESC LIMIT ? OFFSET 7`;

/** The query that finds unreferenced metadata sources, without facts, that a newer observation of the same instance supersedes. */
export const DEFINITION_RETENTION_SOURCE_QUERY = `SELECT s.id FROM definition_sources s INDEXED BY definition_sources_native_age
 WHERE s.kind='native-observation' AND s.observation_context='property-metadata' AND s.host_key=? AND s.instance_binding=? AND s.observed_at<?
 AND ${ROOTS} AND NOT EXISTS(SELECT 1 FROM parameter_definition_facts WHERE provenance_id=s.id)
 ORDER BY s.observed_at DESC,s.id DESC LIMIT ?`;

const factKeyRow = object({ parameter_definition_id: string(), provenance_id: string() });
const sourceKeyRow = object({ id: string() });
const previousProvenanceRow = object({ provenance_id: string() });
const presentRow = object({ present: number() });

/** How many superseded facts and sources one write may delete; the counts are spent as rows are deleted. */
export interface DefinitionRetentionBudget { facts: number; sources: number }

/** An effect whose provenance source changed in this write: the source it had and the one it has now. */
export interface SourceReplacement { previous: string; current: string }

/** The budget for an ordinary write: 64 facts and 64 sources. */
export function definitionRetentionBudget(): DefinitionRetentionBudget { return { facts: 64, sources: 64 }; }

/** A validated census contains at most 10,000 effects; each replacement can leave one orphan. */
export function definitionInventoryRetentionBudget(effects: number): DefinitionRetentionBudget {
  return { facts: 0, sources: Math.min(MAX_INVENTORY_SOURCES, effects) };
}

function source(database: DatabaseSync, id: string): DefinitionProvenance | undefined {
  return selectOne(database, SOURCE_BY_ID_SQL, definitionSource, id);
}

function nativeMetadata(provenance: DefinitionProvenance | undefined): provenance is DefinitionProvenance {
  return provenance?.kind === "native-observation" && provenance.observationContext === "property-metadata"
    && provenance.hostKey !== null && provenance.instanceBinding !== null && provenance.observedAt !== null;
}

/** The effects of the bundle whose provenance source this write replaces; empty without a budget or outside a transaction. */
export function definitionSourceReplacements(database: DatabaseSync, bundle: EffectDefinitionBundle, budget?: DefinitionRetentionBudget): SourceReplacement[] {
  if (!budget || !database.isTransaction) return [];
  return bundle.effects.slice(0, MAX_BUNDLE_EFFECTS).flatMap((effect) => {
    const previous = selectOne(database, PREVIOUS_PROVENANCE_SQL, previousProvenanceRow, effect.id);
    return previous && previous.provenance_id !== effect.provenanceId ? [{ previous: previous.provenance_id, current: effect.provenanceId }] : [];
  });
}

function pruneFacts(database: DatabaseSync, bundle: EffectDefinitionBundle, budget: DefinitionRetentionBudget): void {
  for (const facts of bundle.facts.slice(0, MAX_BUNDLE_FACTS)) {
    if (!budget.facts) return;
    const current = source(database, facts.provenanceId);
    if (!nativeMetadata(current)) continue;
    const rows = selectAll(database, DEFINITION_RETENTION_FACT_QUERY, factKeyRow, current.hostKey, current.instanceBinding, current.observedAt, facts.parameterDefinitionId, budget.facts);
    for (const row of rows) {
      execute(database, DELETE_FACTS_SQL, row.parameter_definition_id, row.provenance_id);
      budget.facts--;
    }
  }
}

function pruneMetadataSources(database: DatabaseSync, bundle: EffectDefinitionBundle, budget: DefinitionRetentionBudget): void {
  for (const current of bundle.sources.slice(0, MAX_BUNDLE_SOURCES)) {
    if (!budget.sources) return;
    if (!nativeMetadata(current)) continue;
    const rows = selectAll(database, DEFINITION_RETENTION_SOURCE_QUERY, sourceKeyRow, current.hostKey, current.instanceBinding, current.observedAt, budget.sources);
    for (const row of rows) { execute(database, DELETE_SOURCE_SQL, row.id); budget.sources--; }
  }
}

function inventoryObservation(provenance: DefinitionProvenance | undefined): { hostKey: string | null; observedAt: number } | undefined {
  const inventory = provenance?.kind === "native-observation" && provenance.observationContext === "effect-inventory";
  return inventory && provenance.observedAt !== null ? { hostKey: provenance.hostKey, observedAt: provenance.observedAt } : undefined;
}

function newerInventory(previous: DefinitionProvenance | undefined, current: DefinitionProvenance | undefined): boolean {
  const before = inventoryObservation(previous), after = inventoryObservation(current);
  return before !== undefined && after !== undefined && before.hostKey === after.hostKey && before.observedAt < after.observedAt;
}

function pruneInventorySources(database: DatabaseSync, replacements: readonly SourceReplacement[], budget: DefinitionRetentionBudget): void {
  for (const replacement of replacements.slice(0, MAX_BUNDLE_SOURCES)) {
    if (!budget.sources) return;
    if (!newerInventory(source(database, replacement.previous), source(database, replacement.current))) continue;
    budget.sources -= execute(database, DELETE_INVENTORY_SOURCE_SQL, replacement.previous);
  }
}

/** Deletes superseded facts and sources within the budget, unless desired lineage exists; it never infers that desired lineage is disposable, because old observation and provenance ids differ. */
export function retainDefinitionHistory(database: DatabaseSync, bundle: EffectDefinitionBundle, replacements: readonly SourceReplacement[], budget?: DefinitionRetentionBudget): void {
  if (!budget || !database.isTransaction) return;
  if (!selectOne(database, DESIRED_LINEAGE_SQL, presentRow)) {
    pruneFacts(database, bundle, budget);
    pruneMetadataSources(database, bundle, budget);
  }
  pruneInventorySources(database, replacements, budget);
}
