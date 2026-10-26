// Resolves a match name to the installed effect of the current host, the identity every note and usage row hangs from.
import { object, string } from "@extynt/decode";
import type { DatabaseSync } from "node:sqlite";
import { selectOne } from "./graph-sql.js";
import { EffectNotesError, type EffectRef } from "./effect-notes-types.js";

const hostRow = object({ host_key: string() });
const effectRow = object({ display_name: string(), category: string(), version: string() });

/** AE reports no vendor for an effect, so a plugin is its menu category, or the match name when the category is empty. */
export function pluginKeyOf(category: string, matchName: string): string { return category.trim() ? category.trim() : matchName; }

/** The AE version part of a host key (`After Effects:26.2:macOS`): what a note is compared against to flag it stale. */
export function aeBuildOf(hostKey: string): string { return hostKey.split(":")[1] || hostKey; }

/** The host of the newest census this file holds; every census writes all its effects at one instant. */
export function currentHostKey(database: DatabaseSync): string | undefined {
  return selectOne(database, "SELECT host_key FROM installed_effects ORDER BY observed_at DESC,host_key LIMIT 1", hostRow)?.host_key;
}

function unknownEffect(): never { throw new EffectNotesError("EFFECT_NOTES_UNKNOWN_EFFECT", "This effect is not in the installed-effect inventory of the current After Effects host."); }

/** The installed effect of the current host with this match name; throws `EFFECT_NOTES_UNKNOWN_EFFECT` when the host or the effect is unknown. */
export function resolveEffect(database: DatabaseSync, matchName: string): EffectRef {
  const hostKey = currentHostKey(database);
  if (!hostKey) return unknownEffect();
  const row = selectOne(database, "SELECT display_name,category,version FROM installed_effects WHERE host_key=? AND match_name=?", effectRow, hostKey, matchName);
  if (!row) return unknownEffect();
  return { hostKey, matchName, displayName: row.display_name, category: row.category, version: row.version === "" ? null : row.version, pluginKey: pluginKeyOf(row.category, matchName) };
}
