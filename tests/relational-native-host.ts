// The simulated After Effects project the relational native tests read: the shipped collection.jsx and apply jsx run in a vm over a measured fake project.
import vm from 'node:vm';
import { FakeProperty, loadApplyPlan } from '../apps/panel/dist/tests/host-apply-harness.js';
import type { FakeCompItem } from '../apps/panel/dist/tests/host-fake-comp.js';
import type { FakeValue } from '../apps/panel/dist/tests/host-fake-property.js';
import type { LoadedApplyPlan } from '../apps/panel/dist/tests/host-apply-load.js';
import { appOf } from '../apps/panel/dist/tests/host-apply-context.js';
import { installGlobal } from '../apps/panel/dist/tests/host-vm-context.js';
import { loadHostFiles } from '../apps/panel/dist/tests/host-sources.js';
import { fieldOf, readJson } from '../apps/panel/dist/tests/json-narrow.js';

/** What a native property carries beyond the fake property tree: its descriptor facts and the value bounds. */
export interface NativeFields {
  propertyValueType: number;
  propertyType: number;
  canSetExpression: boolean;
  hasMin: boolean;
  hasMax: boolean;
  minValue: number;
  maxValue: number;
  isTimeVarying: boolean;
  unitsText?: string;
  propertyIndex?: number;
}

/** A fake property that answers as a native After Effects property does. */
export type NativeProperty = FakeProperty & NativeFields;

/** How many native value getters, key readers and setters the host served. */
export interface NativeCounters {
  values: number;
  keys: number;
  setters: number;
}

/** The project the collection library reads: its revision moves with every native edit. */
export interface RelationalProject {
  revision: number | undefined;
  activeItem: FakeCompItem | null;
}

/** One installed effect as `app.effects` lists it. */
export interface InstalledEffect {
  readonly matchName: string;
  readonly displayName: string;
  readonly category: string;
  readonly version: string;
  readonly isInstalled: boolean;
}

/** The slice of the fake `app` global this simulation drives. */
export interface RelationalApp {
  readonly project: RelationalProject;
  effects: InstalledEffect[];
}

/** The project stamp the host reports: its epoch and revision, null when it reports none. */
export type NativeStamp = { readonly epoch: number | null; readonly revision: number | null };

/** The address of one bounded collection page. */
export type NativeTarget = {
  readonly kind: string;
  readonly compositionId: string;
  readonly itemIndex: number;
  readonly layerId: string;
  readonly layerIndex: number;
};

/** The loaded fake project with the measured effects, the counters and the calls that run the shipped collection library. */
export interface RelationalHost extends LoadedApplyPlan {
  readonly project: RelationalProject;
  readonly counters: NativeCounters;
  readonly gaussian: NativeProperty;
  readonly synthetic: NativeProperty;
  readonly parade: NativeProperty;
  invoke(source: string): string;
  call(entry: string, args: Readonly<Record<string, FakeValue>>): string;
  stamp(): NativeStamp;
  target(kind: string): NativeTarget;
  edit(value: number): void;
}

interface Measure {
  readonly counters: NativeCounters;
  readonly project: RelationalProject;
}

interface MeasuredControl {
  readonly matchName: string;
  readonly name: string;
  readonly initial: number;
  readonly measure: Measure;
  readonly bounds: readonly [number, number];
}

function descriptor(property: FakeProperty, children: boolean, bounds: readonly [number, number]): NativeProperty {
  const described = Object.assign(property, {
    propertyValueType: children ? 0 : 1,
    propertyType: children ? 3 : 1,
    canSetExpression: !children,
    canVaryOverTime: !children,
    isTimeVarying: property.numKeys > 0,
    hasMin: !children,
    hasMax: !children,
    minValue: bounds[0],
    maxValue: bounds[1],
  });
  const ordinalProperty = described.property.bind(described);
  described.property = key => typeof key === 'string' ? described.children.find(child => child.matchName === key) ?? null : ordinalProperty(key);
  return described;
}

function bumpRevision(project: RelationalProject): void {
  project.revision = (project.revision ?? Number.NaN) + 1;
}

function measuredControl(input: MeasuredControl): NativeProperty {
  const { matchName, name, initial, measure, bounds } = input;
  const property = descriptor(new FakeProperty(matchName, name, [], initial, true), false, bounds);
  let current: FakeValue = initial;
  Object.defineProperty(property, 'value', {
    get() { measure.counters.values++; return current; },
    set(next: FakeValue) { current = next; bumpRevision(measure.project); measure.counters.setters++; },
  });
  const keyValue = property.keyValue.bind(property);
  property.keyValue = index => { measure.counters.keys++; return keyValue(index); };
  return property;
}

function syntheticControl(measure: Measure, index: number): NativeProperty {
  const control = measuredControl({ measure, matchName: `SYN Control ${index + 1}`, name: `Synthetic control ${index + 1}`, initial: index + 1, bounds: [0, 100] });
  if (index === 0) return Object.assign(control, { unitsText: 'native-fixture-units' });
  if (index === 1) return Object.assign(control, { expression: 'value * 2', expressionEnabled: true, isTimeVarying: true });
  if (index === 2) return Object.assign(control, { keyframes: [{ time: 0, value: 3 }, { time: 1, value: 9 }], numKeys: 2, isTimeVarying: true });
  return control;
}

function repeatedControl(measure: Measure, name: string, initial: number): NativeProperty {
  return measuredControl({ measure, matchName: 'SYN Repeated', name, initial, bounds: [0, 100] });
}

function syntheticEffect(measure: Measure): NativeProperty {
  const controls = Array.from({ length: 30 }, (_, index) => syntheticControl(measure, index));
  controls.push(repeatedControl(measure, 'Repeated first', 11), repeatedControl(measure, 'Repeated second', 22));
  return descriptor(new FakeProperty('SYN Multi Control', 'Synthetic multi control', controls, null, false), true, [0, 0]);
}

function nativeIndices(properties: readonly FakeProperty[]): void {
  properties.forEach((property, index) => {
    Object.assign(property, { propertyIndex: index + 1 });
    nativeIndices(property.children);
  });
}

function gaussianEffect(measure: Measure): NativeProperty {
  const control = (suffix: number, name: string, initial: number, bounds: readonly [number, number]): NativeProperty =>
    measuredControl({ measure, matchName: `ADBE Gaussian Blur 2-000${suffix}`, name, initial, bounds });
  const controls = [control(1, 'Blurriness', 4, [0, 1000]), control(2, 'Blur Dimensions', 1, [1, 3]), control(3, 'Repeat Edge Pixels', 0, [0, 1])];
  return descriptor(new FakeProperty('ADBE Gaussian Blur 2', 'Gaussian Blur', controls, null, false), true, [0, 0]);
}

function installEffects(loaded: LoadedApplyPlan): RelationalApp {
  installGlobal(loaded.context, 'PropertyValueType', { NO_VALUE: 0, OneD: 1, TwoD: 5, ThreeD: 6, TwoD_SPATIAL: 7, ThreeD_SPATIAL: 8, CUSTOM_VALUE: 99 });
  installGlobal(loaded.context, 'PropertyType', { PROPERTY: 1, INDEXED_GROUP: 2, NAMED_GROUP: 3 });
  const app = appOf(loaded.context);
  const stampFields: { revision: number | undefined; activeItem: FakeCompItem | null } = { revision: undefined, activeItem: null };
  const effects: InstalledEffect[] = [
    { matchName: 'ADBE Gaussian Blur 2', displayName: 'Gaussian Blur', category: 'Blur & Sharpen', version: 'fixture-1', isInstalled: true },
    { matchName: 'SYN Multi Control', displayName: 'Synthetic multi control', category: 'Synthetic fixture', version: 'fixture-1', isInstalled: true },
  ];
  return Object.assign(app, { project: Object.assign(app.project, stampFields), effects });
}

function paradeOf(loaded: LoadedApplyPlan, effects: readonly NativeProperty[]): NativeProperty {
  const found = loaded.title.property('ADBE Effect Parade');
  if (found === null) throw new Error('the title layer has no effect parade');
  const parade = descriptor(found, true, [0, 0]);
  parade.children = [...effects];
  return parade;
}

function numberOrNull(found: ReturnType<typeof fieldOf>): number | null {
  return typeof found === 'number' ? found : null;
}

function hostCalls(loaded: LoadedApplyPlan): Pick<RelationalHost, 'invoke' | 'call' | 'stamp' | 'target'> {
  const invoke = (source: string): string => String(vm.runInContext(source, loaded.context));
  return {
    invoke,
    call: (entry, args) => invoke(`${entry}(${JSON.stringify(JSON.stringify(args))})`),
    stamp: () => {
      const pulse = readJson(invoke('aeCollectionPulse()'));
      return { epoch: numberOrNull(fieldOf(pulse, 'project')), revision: numberOrNull(fieldOf(pulse, 'revision')) };
    },
    target: kind => ({ kind, compositionId: loaded.comp.id, itemIndex: 1, layerId: loaded.title.id, layerIndex: 1 }),
  };
}

/** A project with a Gaussian Blur effect and a 32-control synthetic effect on its title layer; `counters` count native getters and setters. */
export function relationalHost(): RelationalHost {
  const loaded = loadApplyPlan();
  const { project } = installEffects(loaded);
  project.revision = 1;
  project.activeItem = loaded.comp;
  Object.assign(loaded.comp, { time: 0 });
  loaded.title.selected = true;
  const measure: Measure = { counters: { values: 0, keys: 0, setters: 0 }, project };
  const gaussian = gaussianEffect(measure);
  const synthetic = syntheticEffect(measure);
  const parade = paradeOf(loaded, [gaussian, synthetic]);
  nativeIndices(loaded.title.properties);
  loadHostFiles(loaded.context, 'collection.jsx');
  const edit = (value: number): void => {
    const blurriness = gaussian.children[0];
    if (blurriness) blurriness.value = value;
  };
  return { ...loaded, project, counters: measure.counters, gaussian, synthetic, parade, edit, ...hostCalls(loaded) };
}
