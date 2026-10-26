// Observed facts about an effect's controls, projected read-only from the newest catalogue probe of the current host.
import { controlPosition } from "@extynt/capability-catalogue";
import { map, nullable, number, object, string } from "@extynt/decode";
import type { Infer } from "@extynt/decode";
import type { DatabaseSync } from "node:sqlite";
import { latestProbeSource } from "./catalogue-definitions.js";
import { selectAll, sqlFlag } from "./graph-sql.js";
import type { EffectRef, NoteValue, ObservedControl } from "./effect-notes-types.js";

const MAX_CONTROLS = 400;

const defaultRow = object({ parameter_definition_id: string(), value: number() });
const menuRow = object({ parameter_definition_id: string(), label: string() });
const controlRow = object({
  id: string(), path: string(), match_name: string(), display_name: string(), value_type: string(),
  units: map(nullable(string()), (units) => (units ? units : null)), minimum: nullable(number()), maximum: nullable(number()),
  default_shape: string(), can_vary: nullable(sqlFlag), is_group: sqlFlag, hidden: sqlFlag,
});

const DEFAULTS_SQL = "SELECT parameter_definition_id,value FROM parameter_default_components WHERE provenance_id=? ORDER BY parameter_definition_id,component";
const MENUS_SQL = "SELECT parameter_definition_id,label FROM parameter_definition_menu_items WHERE provenance_id=? ORDER BY parameter_definition_id,ordinal";
const CONTROLS_SQL = `SELECT p.id,p.path,p.match_name,p.display_name,f.value_type,f.units,f.minimum,f.maximum,f.default_shape,f.can_vary,COALESCE(u.is_group,0) AS is_group,COALESCE(u.hidden,0) AS hidden
    FROM parameter_definition_facts f JOIN parameter_definitions p ON p.id=f.parameter_definition_id
    LEFT JOIN parameter_definition_observed_ui u ON u.parameter_definition_id=f.parameter_definition_id AND u.provenance_id=f.provenance_id
    WHERE f.provenance_id=?1 AND (?2 IS NULL OR p.path=?2) ORDER BY p.ordinal,p.id LIMIT ${MAX_CONTROLS}`;

function groupedBy<Row, Item>(rows: ReadonlyArray<Row>, pick: (row: Row) => { id: string; item: Item }): ReadonlyMap<string, Item[]> {
  const byId = new Map<string, Item[]>();
  for (const row of rows) {
    const { id, item } = pick(row);
    byId.set(id, [...(byId.get(id) ?? []), item]);
  }
  return byId;
}

function defaultValue(shape: string, components: readonly number[] | undefined): NoteValue | null {
  if (!components || components.length === 0) return null;
  if (shape === "scalar") return components[0] ?? null;
  return shape === "vector" ? [...components] : null;
}

function defaultPosition(control: Pick<ObservedControl, "valueType" | "defaultValue" | "minimum" | "maximum" | "menu">): number | null {
  return controlPosition({ valueType: control.valueType, value: control.defaultValue, minimum: control.minimum, maximum: control.maximum, menu: control.menu.length > 0 }).position;
}

function observedControl(row: Infer<typeof controlRow>, extras: { components: ReadonlyMap<string, number[]>; items: ReadonlyMap<string, string[]> }): ObservedControl {
  const base = {
    controlPath: row.path, matchName: row.match_name, name: row.display_name, group: row.is_group, hidden: row.hidden, valueType: row.value_type, units: row.units,
    minimum: row.minimum, maximum: row.maximum, defaultValue: defaultValue(row.default_shape, extras.components.get(row.id)), canVaryOverTime: row.can_vary, menu: extras.items.get(row.id) ?? [],
  };
  return { ...base, defaultPosition: defaultPosition(base) };
}

/** Observed facts for an effect, projected read-only from the newest catalogue probe of this host (factory defaults). Never written, never overridable by a note. */
export function observedControls(database: DatabaseSync, effect: EffectRef, controlPath: string | null): { probed: boolean; observedAt: number | null; controls: ObservedControl[] } {
  const latest = latestProbeSource(database, effect.hostKey, effect.matchName);
  if (!latest) return { probed: false, observedAt: null, controls: [] };
  const rows = selectAll(database, CONTROLS_SQL, controlRow, latest.sourceId, controlPath);
  const components = groupedBy(selectAll(database, DEFAULTS_SQL, defaultRow, latest.sourceId), (row) => ({ id: row.parameter_definition_id, item: row.value }));
  const items = groupedBy(selectAll(database, MENUS_SQL, menuRow, latest.sourceId), (row) => ({ id: row.parameter_definition_id, item: row.label }));
  return { probed: true, observedAt: latest.observedAt, controls: rows.map((row) => observedControl(row, { components, items })) };
}
