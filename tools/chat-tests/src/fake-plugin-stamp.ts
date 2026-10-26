/** The plugin's `watch_state` for the fixture project: the stamp, what is open and what is selected. */
import type { WatchState } from "@extynt/host-native";
import type { ProjectSnapshot } from "@extynt/project-graph";

export function watchOf(snapshot: ProjectSnapshot, stamp: { epoch: number; revision: number }): WatchState {
  const layers = new Map(snapshot.compositions.flatMap((composition) => composition.layers.map((layer) => [layer.id, layer] as const)));
  const active = snapshot.compositions.find((composition) => composition.id === snapshot.activeCompositionId);
  const selection = snapshot.selection.layerIds;
  return {
    epoch: stamp.epoch,
    revision: stamp.revision,
    items: snapshot.items?.length ?? 0,
    projectName: snapshot.project.name,
    projectPath: snapshot.project.filePath,
    activeCompId: snapshot.activeCompositionId,
    activeCompName: active?.name ?? null,
    time: snapshot.currentTime,
    selection: selection.slice(0, 256),
    selectedLayers: selection.slice(0, 64).flatMap((id) => {
      const layer = layers.get(id);
      return layer ? [{ id, index: layer.index, name: layer.name }] : [];
    }),
  };
}
