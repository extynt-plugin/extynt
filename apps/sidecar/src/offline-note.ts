// What a read tool says when After Effects is not connected: its answer comes from the last read, and by how long ago.
import type { SidecarState } from "./server-state.js";

/** The tools that answer from the held snapshot. */
export const CACHE_READ_TOOLS: ReadonlySet<string> = new Set([
  "ae_get_current_context", "ae_get_project_overview", "ae_get_bootstrap_context", "ae_inspect_composition", "ae_inspect_layer", "ae_find_project_objects",
  "ae_get_selection", "ae_list_effects_and_expressions", "ae_trace_dependencies", "ae_list_project_issues", "ae_measure_layer", "ae_get_effect_controls",
]);

/** True while the native plugin link cannot take a call; a stalled link is still connected. */
export function hostNotConnected(state: Pick<SidecarState, "options" | "hostLink">): boolean {
  const link = state.hostLink.status().state;
  return link !== "online" && link !== "stalled";
}

function ageWords(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 90) return `${seconds} s ago`;
  const minutes = Math.round(seconds / 60);
  return minutes < 90 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
}

/** The note for a cached read, or undefined while After Effects is connected. */
export function offlineReadNote(state: Pick<SidecarState, "options" | "hostLink" | "latest" | "now">): string | undefined {
  if (!hostNotConnected(state)) return undefined;
  const readAt = state.latest ? Date.parse(state.latest.receivedAt) : Number.NaN;
  if (!Number.isFinite(readAt)) return "After Effects is not connected and nothing has been read from it yet.";
  return `From the last read at ${new Date(readAt).toISOString()} (${ageWords(state.now().getTime() - readAt)}); After Effects is not connected, so this may be out of date.`;
}
