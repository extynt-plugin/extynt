// The Gaussian Blur fixture of the blur read-set suite: composition 300 of 300, one layer carrying one effect whose Blurriness is a static 4.
import assert from 'node:assert/strict';
import { hostContext } from './readset-native-host.ts';
import type { HostWorld, SimulatedProject, Stamp } from './readset-native-host.ts';

/** `duplicate`, `effects` and `keys` break the single-static-effect precondition; `coerce` makes the setter store a different value than it was given. */
export interface BlurOptions {
  readonly duplicate?: boolean;
  readonly keys?: number;
  readonly expression?: string;
  readonly coerce?: boolean;
  readonly effects?: number;
}

/** How often the host library touched each part of the simulated project. */
export interface BlurCalls {
  items: number;
  effects: number;
  setters: number;
  begin: number;
  end: number;
}

/** The Blurriness property of the simulated effect. */
export interface BlurLeaf {
  readonly name: string;
  readonly matchName: string;
  readonly propertyValueType: number;
  readonly propertyType: number;
  readonly numKeys: number;
  readonly numProperties: number;
  readonly expressionEnabled: boolean;
  expression: string | undefined;
  readonly hasMin: boolean;
  readonly minValue: number;
  readonly hasMax: boolean;
  readonly maxValue: number;
  readonly value: number;
  setValue(value: number): void;
}

/** The simulated Gaussian Blur effect. */
export interface BlurEffect {
  readonly matchName: string;
  readonly name: string;
  readonly enabled: boolean;
  property(name: string): BlurLeaf;
}

/** An effect in the stack that the blur read set does not care about, or a stand-in a test swaps in. */
export interface PlainEffect {
  readonly matchName: string;
  readonly enabled?: boolean;
}

/** The effect stack of the simulated layer. */
export interface BlurParade {
  readonly matchName: string;
  numProperties: number;
  property(index: number): BlurEffect | PlainEffect;
}

/** The one simulated layer. */
export interface BlurLayer {
  readonly id: number;
  readonly index: number;
  readonly name: string;
  locked: boolean;
  readonly selected: boolean;
  readonly numProperties: number;
  property(name: string): BlurParade;
}

/** The simulated project: 300 compositions. */
export interface BlurProject extends SimulatedProject {
  readonly numItems: number;
  item(index: number): BlurComposition | undefined;
}

/** The host scope of the blur fixture. */
export interface BlurScope {
  readonly CompItem: typeof BlurComposition;
  readonly app: {
    readonly project: BlurProject;
    readonly version: string;
    readonly buildNumber: number;
    beginUndoGroup: () => void;
    readonly endUndoGroup: () => void;
  };
}

/** The scoped read target the sidecar demands for the blur control. */
export type BlurTarget = { kind: 'blur'; itemIndex: number; compositionId: string; layerIndex: number; layerId: string; expectedStamp: Stamp };

/** The one operation the blur suites plan: set Blurriness of the existing Gaussian Blur to a number. */
export type SetEffectControl = {
  type: 'set_effect_control';
  target: { compositionId: string; layerId: string; effectPath: string; propertyPath: string };
  effectMatchName: string;
  value: number;
};

export const BLUR_EFFECT = 'ADBE Effect Parade/ADBE Gaussian Blur 2';

export const blurOps = (value: number): SetEffectControl[] => [{
  type: 'set_effect_control', target: { compositionId: '300', layerId: '900', effectPath: BLUR_EFFECT, propertyPath: `${BLUR_EFFECT}/ADBE Gaussian Blur 2-0001` },
  effectMatchName: 'ADBE Gaussian Blur 2', value,
}];

/** The blur fixture with its simulated parts exposed for assertions. */
export interface BlurWorld extends HostWorld {
  readonly context: BlurScope;
  readonly project: BlurProject;
  readonly calls: BlurCalls;
  readonly leaf: BlurLeaf;
  readonly parade: BlurParade;
  readonly layer: BlurLayer;
  readonly target: (stamp: Stamp) => BlurTarget;
}

class BlurComposition {
  readonly id: number;
  readonly name: string;
  readonly width = 1920;
  readonly height = 1080;
  readonly duration = 10;
  readonly frameRate = 25;
  readonly numLayers = 1;
  readonly onlyLayer: BlurLayer;
  constructor(id: number, onlyLayer: BlurLayer) { this.id = id; this.name = `Comp ${id}`; this.onlyLayer = onlyLayer; }
  layer(index: number): BlurLayer { assert.equal(index, 1); return this.onlyLayer; }
}

function createLeaf(options: BlurOptions, calls: BlurCalls, project: SimulatedProject): BlurLeaf {
  const expression = options.expression ?? '';
  let stored = 4;
  return {
    name: 'Blurriness', matchName: 'ADBE Gaussian Blur 2-0001', propertyValueType: 1, propertyType: 1, numKeys: options.keys ?? 0, numProperties: 0,
    expressionEnabled: !!expression, expression, hasMin: true, minValue: 0, hasMax: true, maxValue: 500,
    get value() { return stored; },
    setValue(value: number) { calls.setters++; stored = options.coerce ? value + 1 : value; project.revision++; },
  };
}

function createParade(options: BlurOptions, calls: BlurCalls, leaf: BlurLeaf): BlurParade {
  const effect: BlurEffect = {
    matchName: 'ADBE Gaussian Blur 2', name: 'Gaussian Blur', enabled: true,
    property(name: string) { assert.equal(name, 'ADBE Gaussian Blur 2-0001'); return leaf; },
  };
  return {
    matchName: 'ADBE Effect Parade', numProperties: options.effects ?? 1,
    property(index: number) { calls.effects++; return (index === 1 || options.duplicate) ? effect : { matchName: 'Other', enabled: true }; },
  };
}

function createLayer(parade: BlurParade): BlurLayer {
  return {
    id: 900, index: 1, name: 'Before', locked: false, selected: false,
    property(name: string) { assert.equal(name, 'ADBE Effect Parade'); return parade; },
    get numProperties(): number { throw new Error('NO_LAYER_PROPERTY_SCAN'); },
  };
}

export function blurWorld(options: BlurOptions = {}): BlurWorld {
  const calls: BlurCalls = { items: 0, effects: 0, setters: 0, begin: 0, end: 0 };
  const comps: BlurComposition[] = [];
  const project: BlurProject = { revision: 4, numItems: 300, item(index) { calls.items++; return comps[index - 1]; } };
  const leaf = createLeaf(options, calls, project), parade = createParade(options, calls, leaf), layer = createLayer(parade);
  for (let id = 1; id <= 300; id++) comps.push(new BlurComposition(id, layer));
  const app = { project, version: '26.2.1', buildNumber: 2, beginUndoGroup() { calls.begin++; }, endUndoGroup() { calls.end++; } };
  const context = hostContext({ CompItem: BlurComposition, app });
  const watch = () => ({ projectName: 'Untitled', projectPath: null, activeCompId: null, activeCompName: null, selection: [], selectedLayers: [], revision: 4, items: 300 });
  const target = (expectedStamp: Stamp): BlurTarget => ({ kind: 'blur', itemIndex: 300, compositionId: '300', layerIndex: 1, layerId: '900', expectedStamp });
  return { context, project, calls, leaf, parade, layer, watch, target, log: [] };
}
