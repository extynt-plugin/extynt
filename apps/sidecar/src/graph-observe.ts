// Records one accepted native page in the graph: the project, the scope, its rows and coverage, and the effects and controls the page shows.
import { number, object } from "@extynt/decode";
import type { DatabaseSync } from "node:sqlite";
import { execute, selectOne } from "./graph-sql.js";
import { graphScope, isDetailKind } from "./graph-record.js";
import type { GraphDetailKind, ScopeKey } from "./graph-record.js";
import { writeGraphRows } from "./graph-write.js";
import { blurControls, descriptorControls, valueControls } from "./graph-control-observation.js";
import { writeControlObservation, writeEffectInstance } from "./graph-control-write.js";
import type { ControlWrite } from "./graph-control-write.js";
import { writeScopeCoverage } from "./graph-coverage.js";
import type { ControlEvidence } from "./graph-control-types.js";
import { linkObservedDefinitions } from "./graph-observation-links.js";
import { definitionRetentionBudget } from "./definition-retention.js";
import { pageHostKey, pageProject } from "./native-page.js";
import type { ObservedPage } from "./native-page.js";
import type { CollectionTarget } from "./collection-request.js";

const scopeRow = object({ id: number() });
const FIND_SCOPE = "SELECT id FROM scopes WHERE project_id=? AND kind=? AND composition_id=? AND layer_id=? AND property_path=?";

interface GraphObservationWrite { database: DatabaseSync; target: CollectionTarget; page: ObservedPage; evidence: ControlEvidence }

/** The id of a scope within a project, or undefined when nothing was stored under it. */
export function findScope(database: DatabaseSync, project: string, scope: ScopeKey): number | undefined {
  return selectOne(database, FIND_SCOPE, scopeRow, project, ...scope)?.id;
}

/** Saves the project a page describes, keeping the name of one already stored. */
export function saveGraphProject(database: DatabaseSync, page: ObservedPage, session: string): void {
  const project = pageProject(page.raw, session);
  execute(database, "INSERT INTO projects VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name", project.id, project.path, project.name, project.version, project.platform);
}

function writeDetailPage(input: GraphObservationWrite, kind: GraphDetailKind, write: ControlWrite): void {
  const { database, target, page, evidence } = input, rows = page.rows, hostKey = write.hostKey;
  const scope = graphScope(target), project = evidence.context.project;
  execute(database, "INSERT OR IGNORE INTO scopes(project_id,kind,composition_id,layer_id,property_path) VALUES(?,?,?,?,?)", project, ...scope);
  const scopeId = findScope(database, project, scope);
  if (scopeId === undefined) throw Error("GRAPH_ROW_INVALID");
  writeGraphRows({ database, scope: scopeId, kind, rows, ...evidence.context, at: evidence.at });
  writeScopeCoverage({ database, scope: scopeId, page: page.raw, evidence });
  if (kind === "properties") {
    const observations = descriptorControls(target, rows);
    observations.effects.forEach((effect) => writeEffectInstance(write, effect));
    observations.controls.forEach((observation) => writeControlObservation(write, observation));
    linkObservedDefinitions({ database, scope: scopeId, rows, controls: observations.controls, hostKey });
  }
  if (kind === "values") valueControls(target, page).forEach((observation) => writeControlObservation(write, observation));
}

/** Writes a page's rows, coverage and controls; a blur page writes its one control only. */
export function writeGraphObservation(input: GraphObservationWrite): void {
  const { database, target, page, evidence } = input, kind = target.kind;
  const write: ControlWrite = { database, hostKey: pageHostKey(page.raw), evidence, retention: definitionRetentionBudget() };
  if (kind === "blur") blurControls(page.raw).forEach((observation) => writeControlObservation(write, observation));
  else if (isDetailKind(kind)) writeDetailPage(input, kind, write);
}
