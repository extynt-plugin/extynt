// The one place runners join the lane. The writes live here; the read, capture, census, catalogue, collection and preview
// runners register through the same registry (`registerHostRunners` is the single call the composition makes).
import type { HostRunnerRegistry } from "./lane-types.js";
import { runApply } from "./run-apply.js";
import { runUndo } from "./run-undo.js";

/** Registers the write runners on the lane's registry. */
export function registerHostRunners(registry: HostRunnerRegistry): void {
  registry.register("apply_plan", runApply);
  registry.register("undo_plan", runUndo);
}
