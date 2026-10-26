// The stored form of a requested control change: the row decoder and the component values that belong to it.
import { nullable, number, object, string } from "@extynt/decode";
import type { Infer } from "@extynt/decode";
import type { DatabaseSync } from "node:sqlite";
import { selectAll } from "./graph-sql.js";

/** The columns of a stored change request; a joined query adds its own beside them. */
export const desiredFields = {
  plan_id: string(), control_id: number(), source_observation_id: string(), source_owner: string(),
  source_panel_instance_id: string(), source_session_id: string(), source_epoch: number(), source_revision: number(),
  requested_at: number(), status: string(), shape: string(), ticket: nullable(string()), read_set_digest: nullable(string()),
  verified_observation_id: nullable(string()), receipt_reference: nullable(string()),
  verified_epoch: nullable(number()), verified_revision: nullable(number()), settled_at: nullable(number()),
};

/** A stored change request. */
export const desiredRow = object(desiredFields);

/** A stored change request as decoded from its row. */
export type DesiredRow = Infer<typeof desiredRow>;

const componentRow = object({ value: number() });

/** The numbers of a request's desired value, in component order. */
export function desiredComponents(database: DatabaseSync, planId: string): number[] {
  return selectAll(database, "SELECT value FROM desired_control_components WHERE plan_id=? ORDER BY component", componentRow, planId).map((component) => component.value);
}

/** A request's desired value: the one number of a scalar, otherwise all its components. */
export function desiredValueOf(shape: string, values: readonly number[]): number | number[] | null {
  return shape === "scalar" ? values[0] ?? null : [...values];
}
