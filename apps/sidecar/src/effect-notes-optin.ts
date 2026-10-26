// "Document this plugin": which plugins the user can choose, and turning documentation on or off per plugin.
import { number, object, string } from "@extynt/decode";
import type { DatabaseSync } from "node:sqlite";
import { execute, selectAll } from "./graph-sql.js";
import { currentHostKey, pluginKeyOf } from "./effect-notes-effect.js";
import type { OptInRequest } from "./effect-notes-input.js";
import type { NotesResult } from "./effect-notes-types.js";

interface PluginChoice { pluginKey: string; effectCount: number; optedIn: boolean }

/** The settings view: the plugins documented, and every plugin of the current host the user can choose. */
export interface OptInView { optedIn: Array<{ pluginKey: string; enabledAt: number }>; plugins: PluginChoice[]; hostKey: string | null }

const installedRow = object({ match_name: string(), category: string() });
const optInRow = object({ plugin_key: string(), enabled_at: number() });

function byKey(left: PluginChoice, right: PluginChoice): number {
  return left.pluginKey < right.pluginKey ? -1 : Number(left.pluginKey > right.pluginKey);
}

function effectCounts(database: DatabaseSync, hostKey: string | null): ReadonlyMap<string, number> {
  const rows = hostKey === null ? [] : selectAll(database, "SELECT match_name,category FROM installed_effects WHERE host_key=? AND (installed IS NULL OR installed=1)", installedRow, hostKey);
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = pluginKeyOf(row.category, row.match_name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** The plugins the user can choose to document: one per AE menu category of the current host (match name when a category is empty), with whether each is opted in. */
export function optInView(database: DatabaseSync): OptInView {
  const hostKey = currentHostKey(database) ?? null;
  const optedIn = selectAll(database, "SELECT plugin_key,enabled_at FROM effect_note_plugin_optin ORDER BY plugin_key", optInRow).map((row) => ({ pluginKey: row.plugin_key, enabledAt: row.enabled_at }));
  const enabled = new Set(optedIn.map((entry) => entry.pluginKey));
  const plugins = [...effectCounts(database, hostKey)].map(([pluginKey, effectCount]) => ({ pluginKey, effectCount, optedIn: enabled.has(pluginKey) })).sort(byKey);
  return { optedIn, plugins, hostKey };
}

/** "Document this plugin" on or off. Off by default for every plugin; turning it off keeps existing notes (forget removes them). */
export function setPluginOptIn(database: DatabaseSync, input: { request: OptInRequest; at: number }): NotesResult<{ pluginKey: string; enabled: boolean }> {
  const { pluginKey, enabled } = input.request;
  if (enabled) execute(database, "INSERT INTO effect_note_plugin_optin VALUES(?,?) ON CONFLICT(plugin_key) DO NOTHING", pluginKey, input.at);
  else execute(database, "DELETE FROM effect_note_plugin_optin WHERE plugin_key=?", pluginKey);
  return { ok: true, pluginKey, enabled, writeAuthorizing: false };
}
