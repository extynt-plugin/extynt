// The paging fixture: one open composition of 60 layers, so a layer inventory takes three bounded pages (25, 25, 10).
import { hostContext, mirrorProject } from './readset-native-host.ts';
import type { HostWorld, SimulatedProject } from './readset-native-host.ts';

export const LAYER_COUNT = 60;

/** One layer row of the simulated composition. */
export interface PagedLayer {
  readonly id: number;
  readonly index: number;
  readonly name: string;
  readonly locked: boolean;
  readonly selected: boolean;
  readonly numProperties: number;
}

/** The simulated project: one composition, always the open one. */
export interface PagedProject extends SimulatedProject {
  readonly numItems: number;
  readonly activeItem: PagedComposition;
  item(): PagedComposition;
}

/** The scoped read targets of the paging suite. */
export type PagedTarget = { kind: 'index' } | { kind: 'layers'; itemIndex: number; compositionId: string };

/** The paging fixture with its simulated project exposed for assertions. */
export interface PagesWorld extends HostWorld {
  readonly project: PagedProject;
  readonly index: PagedTarget;
  readonly layers: PagedTarget;
}

class PagedComposition {
  readonly id = 7;
  readonly name = 'Hundreds-capable target';
  readonly numLayers = LAYER_COUNT;
  readonly width = 1920;
  readonly height = 1080;
  readonly duration = 10;
  readonly frameRate = 25;
  layer(index: number): PagedLayer { return { id: index + 100, index, name: `Layer ${index}`, locked: false, selected: false, numProperties: 0 }; }
}

export function pagesWorld(): PagesWorld {
  const comp = new PagedComposition();
  const project: PagedProject = { revision: 1, numItems: 1, activeItem: comp, item() { return comp; } };
  const context = hostContext({ app: { project, version: '26.2', buildNumber: 2 }, CompItem: PagedComposition });
  const watch = () => ({ projectName: 'Untitled', projectPath: null, activeCompId: '7', activeCompName: 'Hundreds-capable target', selection: [], selectedLayers: [], revision: 1, items: 1 });
  const fixture = () => mirrorProject({ compId: '7', layerId: '101', layerName: 'Layer 1' });
  return { context, project, watch, fixture, index: { kind: 'index' }, layers: { kind: 'layers', itemIndex: 1, compositionId: '7' }, log: [] };
}
