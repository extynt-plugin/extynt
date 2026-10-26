/**
 * A fake After Effects host for the catalogue tests: it answers effect census and probe pages from scripted
 * effects and properties.
 */
import vm from 'node:vm';
import { decodeJson, jsonValue, object, string } from '../packages/decode/dist/src/index.js';
import type { JsonValue } from '../packages/decode/dist/src/index.js';
import { hostTextFunction, loadHostFiles } from '../apps/panel/dist/tests/host-sources.js';

const PropertyValueType = { NO_VALUE: 0, OneD: 1, TwoD: 2, ThreeD: 3, COLOR: 4, CUSTOM_VALUE: 5 } as const;
const PropertyType = { PROPERTY: 1, INDEXED_GROUP: 2, NAMED_GROUP: 3 } as const;

export type UnitsSpec = string | number | null | { readonly throws: true };

interface LeafSpec {
  readonly m: string;
  readonly n?: string;
  readonly t?: keyof typeof PropertyValueType;
  readonly v?: JsonValue;
  readonly min?: number;
  readonly max?: number;
  readonly items?: readonly string[];
  readonly vary?: boolean;
  readonly hidden?: boolean;
  readonly units?: UnitsSpec;
}

interface GroupSpec {
  readonly m: string;
  readonly n?: string;
  readonly children: readonly ControlSpec[];
}

export type ControlSpec = LeafSpec | GroupSpec;

export interface EffectSpec {
  readonly name?: string;
  readonly controls?: readonly ControlSpec[];
  readonly unaddable?: boolean;
  readonly throws?: boolean;
  readonly throwsText?: string;
  readonly returnsNothing?: boolean;
  readonly stuck?: boolean;
  readonly waitMs?: number;
  readonly createsItems?: number;
}

export type EffectTable = Readonly<Record<string, EffectSpec>>;

export interface HostOptions {
  readonly effects?: EffectTable;
  readonly noProject?: boolean;
  readonly file?: { readonly name: string } | null;
  readonly version?: string;
  readonly addCostMs?: number;
}

export interface InstanceSpec {
  readonly matchName: string;
  readonly name?: string;
  readonly controls?: readonly ControlSpec[];
}

export interface ProbeRequest {
  readonly schemaVersion: string;
  readonly requestId: string;
  readonly matchNames: ReadonlyArray<string | number>;
  readonly budgetMs?: number | string;
  readonly cleanup?: boolean | string;
  readonly hold?: boolean | string;
  readonly breadcrumb?: string | number;
}

export interface InstanceRequest {
  readonly schemaVersion: string;
  readonly requestId: string;
  readonly matchName: string;
  readonly compId: string;
  readonly layerId: string | number;
  readonly effectIndex: number | string;
}

export interface Crumb {
  readonly path: string;
  readonly ticket: string;
  readonly phase: string;
  readonly matchName: string;
}

export interface HostLog {
  readonly adds: string[];
  readonly removes: string[];
  suppress: number;
  unsuppress: number;
  undoBegin: number;
  undoEnd: number;
  projectMutations: number;
  readonly crumbs: Crumb[];
}

interface Clock {
  now: number;
}

interface FakeProperty {
  matchName: string;
  name: string;
  numProperties: number;
  propertyType: number;
  propertyValueType: number;
  value: JsonValue | undefined;
  hasMin: boolean;
  minValue: number | undefined;
  hasMax: boolean;
  maxValue: number | undefined;
  isDropdownEffect: boolean;
  propertyParameters: readonly string[] | undefined;
  canVaryOverTime: boolean;
  canSetExpression: boolean;
  isHidden: boolean;
}

interface FakeGroup {
  matchName: string;
  name: string;
  propertyType: number;
  propertyValueType: number;
  numProperties: number;
  property(index: number): FakeNode | undefined;
  children: FakeNode[];
}

type FakeNode = FakeProperty | FakeGroup;

interface FakeEffect {
  matchName: string;
  name: string;
  numProperties: number;
  property(index: number): FakeNode | undefined;
  remove(): void;
}

interface ScratchEffect extends FakeEffect {
  parent: ScratchParade;
}

interface UserEffect extends FakeEffect {
  addProperty(): void;
}

export interface EffectParade {
  readonly numProperties: number;
  property(index: number): FakeEffect | undefined;
  canAddProperty(matchName: string): boolean;
  addProperty(matchName: string): FakeEffect | null;
}

interface ScratchParade extends EffectParade {
  readonly children: ScratchEffect[];
}

interface FolderRef {
  readonly id: number;
  readonly name: string;
}

export interface CompLayer {
  id: number;
  containingComp?: CompItem;
  source?: ProjectItem;
  Effects?: EffectParade;
  property(name: string): EffectParade | null;
}

type SolidAdder = (color: readonly number[], name: string) => CompLayer;

interface LayerList extends Array<CompLayer> {
  addSolid?: SolidAdder;
}

class ProjectItem {
  id = 0;
  name = '';
  parentFolder: FolderRef = { id: 0, name: '' };
  remove: () => void = () => undefined;
}

class FolderItem extends ProjectItem {}

class FootageItem extends ProjectItem {}

class CompItem extends ProjectItem {
  layers: LayerList = [];
  get numLayers(): number {
    return this.layers.length;
  }
  layer(index: number): CompLayer | undefined {
    return this.layers[index - 1];
  }
}

export type { CompItem, ProjectItem };

interface ItemTable {
  readonly rootFolder: FolderRef;
  readonly items: ProjectItem[];
  attach<T extends ProjectItem>(item: T, name: string, parent?: FolderRef): T;
}

interface FakeProject {
  file: { readonly name: string } | null;
  rootFolder: FolderRef;
  readonly numItems: number;
  item(index: number): ProjectItem | undefined;
  items: { addFolder(name: string): FolderItem; addComp(name: string): CompItem };
}

interface FakeApp {
  project: FakeProject | null;
  version: string;
  buildNumber: number;
  beginSuppressDialogs(): void;
  endSuppressDialogs(): void;
  beginUndoGroup(): void;
  endUndoGroup(): void;
}

interface UserInstances {
  userItem(name?: string): CompItem;
  userLayer(comp: CompItem, id: number, instances: readonly InstanceSpec[]): CompLayer;
}

/** The scripted host the catalogue tests drive: parsed replies to probe and instance calls, plus what the host recorded. */
export interface CatalogueHost extends UserInstances {
  readonly items: readonly ProjectItem[];
  readonly log: HostLog;
  readonly parade: EffectParade;
  call(request: ProbeRequest): JsonValue;
  raw(text: string): JsonValue;
  readInstance(request: InstanceRequest): JsonValue;
  rawInstance(text: string): JsonValue;
}

const crumbBody = object({ ticket: string(), phase: string(), matchName: string() });

function throwsOnRead(units: UnitsSpec): boolean {
  return typeof units === 'object' && units !== null && units.throws;
}

function defineUnits(property: FakeProperty, units: UnitsSpec): void {
  Object.defineProperty(property, 'unitsText', {
    enumerable: true,
    get() {
      if (throwsOnRead(units)) throw new Error('UNITS_UNAVAILABLE');
      return units;
    },
  });
}

function leaf(spec: LeafSpec): FakeProperty {
  const property: FakeProperty = {
    matchName: spec.m, name: spec.n ?? spec.m, numProperties: 0, propertyType: PropertyType.PROPERTY,
    propertyValueType: PropertyValueType[spec.t ?? 'OneD'], value: spec.v,
    hasMin: spec.min !== undefined, minValue: spec.min, hasMax: spec.max !== undefined, maxValue: spec.max,
    isDropdownEffect: !!spec.items, propertyParameters: spec.items,
    canVaryOverTime: spec.vary ?? true, canSetExpression: true, isHidden: !!spec.hidden,
  };
  if (spec.units !== undefined) defineUnits(property, spec.units);
  return property;
}

function group(spec: GroupSpec): FakeGroup {
  const children = spec.children.map(build);
  return {
    matchName: spec.m, name: spec.n ?? spec.m, propertyType: PropertyType.NAMED_GROUP, propertyValueType: PropertyValueType.NO_VALUE,
    numProperties: children.length, property: index => children[index - 1], children,
  };
}

function build(spec: ControlSpec): FakeNode {
  return 'children' in spec ? group(spec) : leaf(spec);
}

function createItemTable(log: HostLog): ItemTable {
  const rootFolder: FolderRef = { id: 0, name: 'Root' };
  const items: ProjectItem[] = [];
  let nextId = 1;
  const childrenOf = (folder: ProjectItem): ProjectItem[] => items.filter(child => child.parentFolder === folder);
  function attach<T extends ProjectItem>(item: T, name: string, parent?: FolderRef): T {
    item.id = nextId++;
    item.name = name;
    item.parentFolder = parent ?? rootFolder;
    items.push(item);
    log.projectMutations++;
    item.remove = () => {
      for (const child of childrenOf(item)) child.remove();
      items.splice(items.indexOf(item), 1);
      log.projectMutations++;
    };
    if (item instanceof FolderItem) Object.defineProperty(item, 'numItems', { get: () => childrenOf(item).length });
    return item;
  }
  return { rootFolder, items, attach };
}

function checkedSpec(spec: EffectSpec | undefined): EffectSpec | null {
  if (!spec || spec.unaddable) throw new Error('cannot add');
  if (spec.throws) throw new Error(spec.throwsText ?? 'boom');
  return spec.returnsNothing === true ? null : spec;
}

function createEffect(spec: EffectSpec, matchName: string, parade: ScratchParade, log: HostLog): ScratchEffect {
  const tree = (spec.controls ?? []).map(build);
  const effect: ScratchEffect = {
    matchName, name: spec.name ?? matchName, numProperties: tree.length, property: index => tree[index - 1], parent: parade,
    remove: () => {
      if (spec.stuck) throw new Error('stuck');
      parade.children.splice(parade.children.indexOf(effect), 1);
      log.removes.push(matchName);
    },
  };
  return effect;
}

function createParade(world: ItemTable, options: HostOptions, log: HostLog, clock: Clock): ScratchParade {
  const effects = options.effects ?? {};
  const children: ScratchEffect[] = [];
  const parade: ScratchParade = {
    children,
    get numProperties() { return children.length; },
    property: index => children[index - 1],
    canAddProperty: matchName => { const spec = effects[matchName]; return !!spec && !spec.unaddable; },
    addProperty(matchName) {
      const spec = checkedSpec(effects[matchName]);
      if (!spec) return null;
      log.adds.push(matchName);
      clock.now += (options.addCostMs ?? 0) + (spec.waitMs ?? 0);
      for (let n = 0; n < (spec.createsItems ?? 0); n += 1) world.attach(new FootageItem(), `${matchName} helper ${n + 1}`);
      const added = createEffect(spec, matchName, parade, log);
      children.push(added);
      return added;
    },
  };
  return parade;
}

function createProject(world: ItemTable, options: HostOptions, parade: ScratchParade): FakeProject {
  const { attach, items, rootFolder } = world;
  const addSolid = (comp: CompItem): SolidAdder => (_color, solidName) => {
    const solids = items.find(item => item instanceof FolderItem && item.name === 'Solids' && item.parentFolder === rootFolder)
      ?? attach(new FolderItem(), 'Solids');
    const source = attach(new FootageItem(), solidName, solids);
    const layer: CompLayer = { id: 7, containingComp: comp, source, Effects: parade, property: name => (name === 'ADBE Effect Parade' ? parade : null) };
    comp.layers.push(layer);
    return layer;
  };
  const addComp = (name: string): CompItem => {
    const comp = attach(new CompItem(), name);
    comp.layers.addSolid = addSolid(comp);
    return comp;
  };
  return {
    file: options.file ?? null, rootFolder, get numItems() { return items.length; }, item: index => items[index - 1],
    items: { addFolder: name => attach(new FolderItem(), name), addComp },
  };
}

function createApp(options: HostOptions, project: FakeProject, log: HostLog): FakeApp {
  return {
    project: options.noProject ? null : project, version: options.version ?? '26.2', buildNumber: 2,
    beginSuppressDialogs() { log.suppress++; }, endSuppressDialogs() { log.unsuppress++; },
    beginUndoGroup() { log.undoBegin++; }, endUndoGroup() { log.undoEnd++; },
  };
}

function readCrumb(path: string, text: string): Crumb {
  const body = decodeJson(text, crumbBody);
  if (!body.ok) throw new Error(`breadcrumb is not a crumb: ${body.error.message}`);
  return { path, ...body.value };
}

function createFileClass(log: HostLog) {
  return class File {
    path: string;
    buffer = '';
    constructor(path: string) { this.path = path; }
    open(mode: string): boolean { return mode === 'w'; }
    write(text: string): void { this.buffer += text; }
    close(): boolean {
      log.crumbs.push(readCrumb(this.path, this.buffer));
      return true;
    }
  };
}

function createContext(app: FakeApp, log: HostLog, clock: Clock): vm.Context {
  class FakeDate { getTime(): number { return clock.now; } }
  const context = vm.createContext({
    app, File: createFileClass(log), CompItem, FolderItem, FootageItem, PropertyType, PropertyValueType, Date: FakeDate, $: { os: 'Macintosh' },
  });
  loadHostFiles(context, 'host-shared.jsx');
  loadHostFiles(context, 'catalogue.jsx');
  return context;
}

function userEffect(spec: InstanceSpec, log: HostLog): UserEffect {
  const tree = (spec.controls ?? []).map(build);
  return {
    matchName: spec.matchName, name: spec.name ?? spec.matchName, numProperties: tree.length, property: index => tree[index - 1],
    remove() { log.removes.push(spec.matchName); log.projectMutations++; },
    addProperty() { log.adds.push(spec.matchName); log.projectMutations++; },
  };
}

function userParade(effects: readonly UserEffect[], log: HostLog): EffectParade {
  return {
    get numProperties() { return effects.length; },
    property: index => effects[index - 1],
    addProperty(name) { log.adds.push(name); log.projectMutations++; return null; },
    canAddProperty: () => true,
  };
}

function createUserInstances(world: ItemTable, log: HostLog): UserInstances {
  const userItem = (name = 'My comp'): CompItem => world.attach(new CompItem(), name);
  const userLayer = (comp: CompItem, id: number, instances: readonly InstanceSpec[]): CompLayer => {
    const parade = userParade(instances.map(spec => userEffect(spec, log)), log);
    const layer: CompLayer = { id, property: name => (name === 'ADBE Effect Parade' ? parade : null) };
    comp.layers.push(layer);
    return layer;
  };
  return { userItem, userLayer };
}

function parseReply(text: string): JsonValue {
  const reply = decodeJson(text, jsonValue);
  if (!reply.ok) throw new Error(`host reply is not JSON: ${reply.error.message}`);
  return reply.value;
}

/** A fake After Effects that models exactly what catalogue.jsx touches: items, folders, one solid layer, and the effect parade. */
export function catalogueHost(options: HostOptions = {}): CatalogueHost {
  const log: HostLog = { adds: [], removes: [], suppress: 0, unsuppress: 0, undoBegin: 0, undoEnd: 0, projectMutations: 0, crumbs: [] };
  const clock: Clock = { now: 1000 };
  const world = createItemTable(log);
  const parade = createParade(world, options, log, clock);
  const app = createApp(options, createProject(world, options, parade), log);
  const context = createContext(app, log, clock);
  const probePage = hostTextFunction(context, 'aeCatalogueProbePage');
  const readInstance = hostTextFunction(context, 'aeCatalogueReadInstance');
  return {
    items: world.items, log, parade, ...createUserInstances(world, log),
    call: request => parseReply(probePage(JSON.stringify(request))),
    raw: text => parseReply(probePage(text)),
    readInstance: request => parseReply(readInstance(JSON.stringify(request))),
    rawInstance: text => parseReply(readInstance(text)),
  };
}
