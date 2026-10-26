// Reads stored change requests back: one plan's request, or a bounded page of the requests made against a project's controls.
import type { JsonObject } from "@extynt/decode";
import type { DatabaseSync } from "node:sqlite";
import { readValid, selectOne, selectValid } from "./graph-sql.js";
import { desiredComponents, desiredRow, desiredValueOf } from "./graph-desired-row.js";
import type { DesiredRow } from "./graph-desired-row.js";
import type { DesiredParameterPlan, GraphContext } from "./graph-control-types.js";

const PAGE_LIMIT = 25;
const DESIRED_PAGE = `SELECT d.* FROM desired_control_requests d JOIN control_instances c ON c.id=d.control_id JOIN effect_instances e ON e.id=c.effect_instance_id
  WHERE e.project_id=? AND d.plan_id>? AND (?=0 OR d.control_id=?) ORDER BY d.plan_id LIMIT ?`;

interface DesiredQuery { cursor: string; limit: number | undefined; controlInstanceId: number }

/** What the store knows of a plan's change request. */
export function readDesiredParameterPlan(database: DatabaseSync, planId: string): DesiredParameterPlan {
  const row = selectOne(database, "SELECT * FROM desired_control_requests WHERE plan_id=?", desiredRow, planId);
  if (!row) return { state: "absent" };
  const values = desiredComponents(database, planId);
  return {
    state: "present",
    request: {
      planId, controlInstanceId: row.control_id, sourceObservationId: row.source_observation_id, panelInstanceId: row.source_panel_instance_id,
      collectionSessionId: row.source_session_id, stamp: { epoch: row.source_epoch, revision: row.source_revision }, status: row.status,
      desiredValue: desiredValueOf(row.shape, values), ticket: row.ticket, readSetDigest: row.read_set_digest,
    },
  };
}

function requestRow(database: DatabaseSync, row: DesiredRow): JsonObject {
  const values = desiredComponents(database, row.plan_id);
  return {
    planId: row.plan_id, controlInstanceId: row.control_id, sourceObservationId: row.source_observation_id, sourcePanelInstanceId: row.source_panel_instance_id,
    sourceCollectionSessionId: row.source_session_id, beforeStamp: { epoch: row.source_epoch, revision: row.source_revision }, requestedAt: row.requested_at,
    status: row.status, desiredValue: desiredValueOf(row.shape, values), verifiedObservationId: row.verified_observation_id,
    receiptReference: row.receipt_reference, afterStamp: row.verified_epoch === null ? null : { epoch: row.verified_epoch, revision: row.verified_revision },
    settledAt: row.settled_at, observedMutation: row.status === "verified", writeAuthorizing: false,
  };
}

/** A bounded page of the project's change requests; `nextCursor` continues the page. */
export function queryDesiredParameters(database: DatabaseSync, input: DesiredQuery, context: GraphContext): JsonObject {
  const limit = Math.max(1, Math.min(PAGE_LIMIT, input.limit ?? PAGE_LIMIT)), control = input.controlInstanceId;
  const selected = selectValid(database, DESIRED_PAGE, desiredRow, context.project, input.cursor, control, control, limit + 1);
  return { rows: readValid(database, selected.slice(0, limit), (row) => requestRow(database, row)), nextCursor: selected.length > limit ? selected[limit - 1]?.plan_id ?? null : null, writeAuthorizing: false };
}
