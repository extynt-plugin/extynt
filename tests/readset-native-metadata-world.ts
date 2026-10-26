// The layer-rename fixture of the metadata read-set suite: composition 300 of 300 holds one layer "Before", open in After Effects.
import assert from 'node:assert/strict';
import { hostContext, mirrorProject } from './readset-native-host.ts';
import type { HostWorld, SimulatedProject } from './readset-native-host.ts';

/** `coerce` makes the name setter store an upper-cased name, so the readback cannot match what was asked. */
export interface MetadataOptions {
  readonly coerce?: boolean;
}

/** How often the host library touched each part of the simulated project. */
export interface MetadataCalls {
  items: number;
  layers: number;
  begin: number;
  end: number;
}

/** The one simulated layer. */
export interface MetadataLayer {
  readonly id: number;
  readonly index: number;
  locked: boolean;
  readonly selected: boolean;
  name: string;
  readonly numProperties: number;
}

/** The simulated project: 300 compositions, the last of them open. */
export interface MetadataProject extends SimulatedProject {
  readonly numItems: number;
  readonly activeItem: MetadataComposition | undefined;
  item(index: number): MetadataComposition | undefined;
}

/** The host scope of the metadata fixture. */
export interface MetadataScope {
  readonly CompItem: typeof MetadataComposition;
  readonly app: {
    readonly project: MetadataProject;
    readonly version: string;
    readonly buildNumber: number;
    beginUndoGroup: () => void;
    readonly endUndoGroup: () => void;
  };
}

/** The scoped read target for a layer inventory. */
export type MetadataTarget = { kind: 'layers'; itemIndex: number; compositionId: string };

/** The rename fixture with its simulated parts exposed for assertions. */
export interface MetadataWorld extends HostWorld {
  readonly context: MetadataScope;
  readonly project: MetadataProject;
  readonly layer: MetadataLayer;
  readonly calls: MetadataCalls;
  readonly target: MetadataTarget;
}

class MetadataComposition {
  readonly id: number;
  readonly name: string;
  readonly numLayers = 1;
  readonly width = 1920;
  readonly height = 1080;
  readonly duration = 10;
  readonly frameRate = 25;
  readonly onlyLayer: MetadataLayer;
  readonly calls: MetadataCalls;
  constructor(id: number, onlyLayer: MetadataLayer, calls: MetadataCalls) { this.id = id; this.name = `Comp ${id}`; this.onlyLayer = onlyLayer; this.calls = calls; }
  layer(index: number): MetadataLayer { this.calls.layers++; assert.equal(index, 1); return this.onlyLayer; }
}

function createLayer(options: MetadataOptions, project: SimulatedProject): MetadataLayer {
  let name = 'Before';
  return {
    id: 900, locked: false, selected: false, index: 1,
    get name() { return name; },
    set name(value: string) { name = options.coerce ? value.toUpperCase() : value; project.revision++; },
    get numProperties(): number { throw new Error('NO_DEEP_READS'); },
  };
}

export function metadataWorld(options: MetadataOptions = {}): MetadataWorld {
  const calls: MetadataCalls = { items: 0, layers: 0, begin: 0, end: 0 };
  const comps: MetadataComposition[] = [];
  const project: MetadataProject = {
    revision: 4, numItems: 300, get activeItem() { return comps[299]; }, item(index) { calls.items++; return comps[index - 1]; },
  };
  const layer = createLayer(options, project);
  for (let id = 1; id <= 300; id++) comps.push(new MetadataComposition(id, layer, calls));
  const app = { project, version: '26.2.1', buildNumber: 2, beginUndoGroup() { calls.begin++; }, endUndoGroup() { calls.end++; } };
  const context = hostContext({ CompItem: MetadataComposition, app });
  const watch = () => ({ projectName: 'Untitled', projectPath: null, activeCompId: '300', activeCompName: 'Comp 300', selection: [], selectedLayers: [], revision: 4, items: 300 });
  const fixture = () => mirrorProject({ compId: '300', layerId: '900', layerName: 'Before' });
  return { context, project, layer, calls, watch, fixture, target: { kind: 'layers', itemIndex: 300, compositionId: '300' }, log: [] };
}
