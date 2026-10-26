// The Gaussian Blur creation fixture: composition 300 of 300 with one layer whose effect stack the options shape,
// and a host library that can lose or fail parts of the creation.
import assert from 'node:assert/strict';
import { hostContext, mirrorProject } from './readset-native-host.ts';
import type { HostWorld, SimulatedProject } from './readset-native-host.ts';

/**
 * `count` is the effects already on the layer, `canAdd` whether the stack accepts another. The rest each break one step of the creation:
 * `throwAfterAdd` loses addProperty's return, `duplicateAdd` adds a second effect, `throwControl` and `coerce` name the control whose setter
 * throws or stores another value (`float32` stores every value as a 32-bit float), `editAfterControl` edits the stack after that control,
 * `editOnBegin` edits the project when the undo group opens.
 */
export interface CreationOptions {
  readonly count?: number;
  readonly canAdd?: boolean;
  readonly throwAfterAdd?: boolean;
  readonly duplicateAdd?: boolean;
  readonly throwControl?: number;
  readonly coerce?: number;
  readonly float32?: boolean;
  readonly editAfterControl?: number;
  readonly editOnBegin?: boolean;
}

/** How often the host library added an effect, set a control and opened and closed the undo group. */
export interface CreationCalls {
  add: number;
  set: number;
  begin: number;
  end: number;
}

/** An entry of the effect stack. */
export interface StackEffect {
  readonly matchName: string;
}

/** One control of the simulated Gaussian Blur. */
export interface CreationControl {
  readonly matchName: string;
  readonly propertyValueType: number;
  readonly numKeys: number;
  readonly expressionEnabled: boolean;
  readonly expression: string;
  readonly hasMin: boolean;
  readonly hasMax: boolean;
  readonly minValue: number;
  readonly maxValue: number;
  readonly value: number;
  setValue(value: number): void;
}

/** The built-in compositing group beside the controls. */
export interface BuiltInGroup {
  readonly matchName: string;
  readonly numProperties: number;
}

/** The simulated Gaussian Blur effect, valid only in the generation it was fetched in. */
export interface CreationEffect extends StackEffect {
  readonly numProperties: number;
  enabled: boolean;
  property(key: number | string): CreationControl | BuiltInGroup;
}

/** What `addProperty` returns: a handle that throws on any access, as a reference After Effects invalidated. */
export interface InvalidatedHandle {
  readonly [member: string]: never;
}

/** The effect stack of the simulated layer. */
export interface CreationParade {
  readonly matchName: string;
  readonly numProperties: number;
  property(index: number): CreationEffect | StackEffect;
  canAddProperty(): boolean;
  addProperty(): InvalidatedHandle;
}

/** The one simulated layer. */
export interface CreationLayer {
  readonly id: number;
  readonly index: number;
  readonly name: string;
  readonly locked: boolean;
  readonly selected: boolean;
  property(name: string): CreationParade;
}

/** The simulated project: 300 compositions, the last of them open. */
export interface CreationProject extends SimulatedProject {
  readonly numItems: number;
  readonly activeItem: CreationComposition | undefined;
  item(index: number): CreationComposition | undefined;
}

/** The host scope of the creation fixture. */
export interface CreationScope {
  readonly CompItem: typeof CreationComposition;
  readonly app: {
    readonly project: CreationProject;
    readonly version: string;
    readonly buildNumber: number;
    readonly beginUndoGroup: () => void;
    readonly endUndoGroup: () => void;
  };
}

/** The scoped read target the sidecar demands for the effect creation. */
export type CreationTarget = { kind: 'effect-create'; itemIndex: number; compositionId: string; layerIndex: number; layerId: string };

interface CreationState {
  readonly options: CreationOptions;
  readonly calls: CreationCalls;
  readonly values: number[];
  readonly effects: StackEffect[];
  readonly project: SimulatedProject;
  generation: number;
  enabled: boolean;
}

/** The creation fixture with its simulated parts exposed for assertions. */
export interface CreationWorld extends HostWorld {
  readonly context: CreationScope;
  readonly project: CreationProject;
  readonly layer: CreationLayer;
  readonly calls: CreationCalls;
  readonly values: number[];
  readonly effects: StackEffect[];
  readonly target: CreationTarget;
}

class CreationComposition {
  readonly id: number;
  readonly name: string;
  readonly width = 1920;
  readonly height = 1080;
  readonly duration = 10;
  readonly frameRate = 25;
  readonly numLayers = 1;
  readonly targetLayer: CreationLayer;
  constructor(id: number, layer: CreationLayer) { this.id = id; this.name = `C${id}`; this.targetLayer = layer; }
  layer(): CreationLayer { return this.targetLayer; }
}

function storedValue(options: CreationOptions, index: number, value: number): number {
  if (options.coerce === index) return value + 1;
  return options.float32 ? Math.fround(value) : value;
}

function createProperty(state: CreationState, index: number, generation: number): CreationControl {
  const { options, calls, values } = state;
  return {
    matchName: `ADBE Gaussian Blur 2-000${index}`, propertyValueType: 1, numKeys: 0, expressionEnabled: false, expression: '', hasMin: true, hasMax: true,
    minValue: index === 2 ? 1 : 0, maxValue: index === 1 ? 500 : index === 2 ? 3 : 1,
    get value() { assert.equal(generation, state.generation, 'STALE_PROPERTY_REFERENCE'); return values[index - 1] ?? 0; },
    setValue(value: number) {
      assert.equal(generation, state.generation, 'STALE_PROPERTY_REFERENCE');
      calls.set++;
      if (options.throwControl === index) throw Error('SETTER_FAILED');
      values[index - 1] = storedValue(options, index, value);
      state.project.revision++;
      if (options.editAfterControl === index) state.effects.push({ matchName: 'Raced' });
    },
  };
}

function createEffect(state: CreationState, generation: number): CreationEffect {
  return {
    matchName: 'ADBE Gaussian Blur 2', numProperties: 4,
    get enabled() { assert.equal(generation, state.generation); return state.enabled; },
    set enabled(value: boolean) { assert.equal(generation, state.generation); state.enabled = value; state.project.revision++; },
    property(key: number | string) {
      assert.equal(generation, state.generation);
      if (key === 4) return { matchName: 'ADBE Effect Built In Params', numProperties: 1 };
      return createProperty(state, typeof key === 'number' ? key : Number(key.slice(-1)), generation);
    },
  };
}

function addEffect(state: CreationState, generation: number): InvalidatedHandle {
  const { options, calls, effects } = state;
  assert.equal(generation, state.generation);
  calls.add++;
  effects.push({ matchName: 'ADBE Gaussian Blur 2' });
  state.generation++;
  state.project.revision++;
  if (options.duplicateAdd) effects.push({ matchName: 'ADBE Gaussian Blur 2' });
  if (options.throwAfterAdd) throw Error('ADD_RETURN_LOST');
  return new Proxy<InvalidatedHandle>({}, { get() { throw Error('INVALIDATED_ADD_RETURN'); } });
}

function createParade(state: CreationState, generation: number): CreationParade {
  const { effects, options } = state;
  return {
    matchName: 'ADBE Effect Parade',
    get numProperties() { assert.equal(generation, state.generation); return effects.length; },
    property(index: number) {
      assert.equal(generation, state.generation);
      const stacked = effects[index - 1];
      if (stacked === undefined) throw new Error(`no effect ${index}`);
      return stacked.matchName === 'ADBE Gaussian Blur 2' ? createEffect(state, generation) : stacked;
    },
    canAddProperty() { return options.canAdd !== false; },
    addProperty() { return addEffect(state, generation); },
  };
}

function createLayer(state: CreationState): CreationLayer {
  return {
    id: 900, index: 1, name: 'Target', locked: false, selected: false,
    property(name: string) { assert.equal(name, 'ADBE Effect Parade'); return createParade(state, state.generation); },
  };
}

export function creationWorld(options: CreationOptions = {}): CreationWorld {
  const calls: CreationCalls = { add: 0, set: 0, begin: 0, end: 0 };
  const comps: CreationComposition[] = [];
  const project: CreationProject = { revision: 4, numItems: 300, get activeItem() { return comps[299]; }, item(index) { return comps[index - 1]; } };
  const effects: StackEffect[] = Array.from({ length: options.count ?? 1 }, () => ({ matchName: 'Other' }));
  const values = [0, 1, 1];
  const state: CreationState = { options, calls, values, effects, project, generation: 0, enabled: true };
  const layer = createLayer(state);
  for (let id = 1; id <= 300; id++) comps.push(new CreationComposition(id, layer));
  const app = { project, version: '26.2.1', buildNumber: 2, beginUndoGroup() { calls.begin++; if (options.editOnBegin) project.revision++; }, endUndoGroup() { calls.end++; } };
  const context = hostContext({ CompItem: CreationComposition, app });
  const watch = () => ({ projectName: 'Untitled', projectPath: null, activeCompId: '300', activeCompName: 'C300', selection: [], selectedLayers: [], revision: 4, items: 300 });
  const fixture = () => mirrorProject({ compId: '300', layerId: '900', layerName: 'Target' });
  const target: CreationTarget = { kind: 'effect-create', itemIndex: 300, compositionId: '300', layerIndex: 1, layerId: '900' };
  return { context, project, layer, calls, values, effects, watch, fixture, target, log: [] };
}
