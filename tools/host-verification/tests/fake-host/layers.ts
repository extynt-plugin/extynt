/**
 * The fake host's layer/comp/project accessors.
 *
 * Two host behaviours the probe measures live here: parenting preserves the child's
 * WORLD position, so `local_after = world_before - parent.position + child.anchor`
 * (and parenting to a parent at the origin still moves the child), and a shape group
 * with a path but no paint draws nothing, so sourceRectAtTime reports an empty rect.
 */
import { enumNumber, type ProbeValue } from "./narrow.js";
import { attachTime, FakeProperty, walk } from "./property.js";
import { shapeProperties, solidProperties, textProperties } from "./content.js";

const PAINT_MATCH_NAMES = new Set(["ADBE Vector Graphic - Fill", "ADBE Vector Graphic - Stroke", "ADBE Vector Graphic - G-Fill", "ADBE Vector Graphic - G-Stroke"]);

export interface Rect { top: number; left: number; width: number; height: number }
interface Bounds { top: number; left: number; right: number; bottom: number }

const vectorOf = (property: FakeProperty, path: string): number[] => {
  const child = walk(property, path), value = child ? child.value : null;
  return Array.isArray(value) ? value.map((entry) => (typeof entry === "number" ? entry : 0)) : [];
};

const ellipseBounds = (item: FakeProperty): Bounds | null => {
  if (item.matchName !== "ADBE Vector Shape - Ellipse") return null;
  const size = vectorOf(item, "ADBE Vector Ellipse Size"), centre = vectorOf(item, "ADBE Vector Ellipse Position");
  const halfWidth = (size[0] ?? 0) / 2, halfHeight = (size[1] ?? 0) / 2;
  return { left: (centre[0] ?? 0) - halfWidth, right: (centre[0] ?? 0) + halfWidth, top: (centre[1] ?? 0) - halfHeight, bottom: (centre[1] ?? 0) + halfHeight };
};

const unionBounds = (rects: Bounds[]): Bounds => rects.reduce((acc, rect) => ({
  left: Math.min(acc.left, rect.left), right: Math.max(acc.right, rect.right), top: Math.min(acc.top, rect.top), bottom: Math.max(acc.bottom, rect.bottom),
}));

const groupBounds = (group: FakeProperty): Bounds | null => {
  const contents = walk(group, "ADBE Vectors Group");
  if (!contents) return null;
  if (!contents.children.some((child) => PAINT_MATCH_NAMES.has(child.matchName))) return null;
  const painted = contents.children.map(ellipseBounds).filter((rect): rect is Bounds => rect !== null);
  return painted.length ? unionBounds(painted) : null;
};

export class FakeLayer {
  id: number;
  name: string;
  typeName = "Solid";
  matchName = "ADBE Solid";
  enabled = true;
  hasTrackMatte = false;
  isTrackMatte = false;
  trackMatteType = 5012;
  trackMatteLayer: FakeLayer | null = null;
  source: FakeComp | null = null;
  properties: FakeProperty;
  comp: FakeComp;
  private parentLayer: FakeLayer | null = null;

  constructor(id: number, name: string, comp: FakeComp, properties: FakeProperty) {
    this.id = id; this.name = name; this.comp = comp; this.properties = properties;
    attachTime(properties, () => comp.time);
  }
  get index(): number { return this.comp.layers.list.indexOf(this) + 1; }
  get parent(): FakeLayer | null { return this.parentLayer; }
  set parent(next: FakeLayer | null) {
    if (next === this.parentLayer) return;
    const world = this.worldPosition(), anchor = this.transformVector("ADBE Transform Group/ADBE Anchor Point");
    this.parentLayer = next;
    const target = next ? next.worldPosition() : [0, 0, 0];
    this.writePosition(world.map((entry, index) => entry - (target[index] ?? 0) + (anchor[index] ?? 0)));
  }
  worldPosition(): number[] {
    const local = this.transformVector("ADBE Transform Group/ADBE Position");
    if (!this.parentLayer) return local;
    const anchor = this.transformVector("ADBE Transform Group/ADBE Anchor Point"), base = this.parentLayer.worldPosition();
    return local.map((entry, index) => entry - (anchor[index] ?? 0) + (base[index] ?? 0));
  }
  sourceRectAtTime(_time: number, _extents?: boolean): Rect {
    return this.paintedShapeBounds() ?? { top: 0, left: 0, width: 0, height: 0 };
  }
  private transformVector(path: string): number[] {
    const property = walk(this.properties, path), value = property ? property.value : null;
    return Array.isArray(value) ? value.map((entry) => (typeof entry === "number" ? entry : 0)) : [0, 0, 0];
  }
  private writePosition(value: number[]): void {
    const position = walk(this.properties, "ADBE Transform Group/ADBE Position");
    if (position) position.setValue(value);
  }
  private paintedShapeBounds(): Rect | null {
    const root = walk(this.properties, "ADBE Root Vectors Group");
    if (!root) return null;
    const bounds = root.children.filter((group) => group.matchName === "ADBE Vector Group").map(groupBounds).filter((rect): rect is Bounds => rect !== null);
    if (!bounds.length) return null;
    const union = unionBounds(bounds);
    return { top: union.top, left: union.left, width: union.right - union.left, height: union.bottom - union.top };
  }
  get width(): number { return this.source ? this.source.width : 0; }
  get height(): number { return this.source ? this.source.height : 0; }
  get numProperties(): number { return this.properties.numProperties; }
  property(indexOrName: number | string): FakeProperty | null { return this.properties.property(indexOrName); }
  setTrackMatte(layer: FakeLayer, type: ProbeValue): void {
    if (!(layer instanceof FakeLayer)) throw new Error("After Effects error: setTrackMatte needs a layer");
    this.trackMatteLayer = layer;
    this.trackMatteType = enumNumber(type) ?? NaN;
    this.hasTrackMatte = true;
    layer.isTrackMatte = true;
  }
  removeTrackMatte(): void { this.trackMatteLayer = null; this.trackMatteType = 5012; this.hasTrackMatte = false; }
  remove(): void { this.comp.removeLayer(this); }
}

export interface CompSpec { id: number; name: string; width: number; height: number; duration: number; frameRate: number }

interface LayerCreators {
  addSolid: (...args: [color: number[], name: string, width: number, height: number, aspect: number, duration: number]) => FakeLayer;
  addText: (text: string) => FakeLayer;
  addShape: () => FakeLayer;
  add: (item: FakeComp) => FakeLayer;
}
interface CompLayers extends LayerCreators { list: FakeLayer[] }

export class FakeComp {
  id: number;
  name: string;
  width: number;
  height: number;
  duration: number;
  frameRate: number;
  time = 0;
  pixelAspect = 1;
  workAreaStart = 0;
  workAreaDuration: number;
  motionBlur = false;
  shutterAngle = 180;
  shutterPhase = -90;
  motionBlurSamplesPerFrame = 16;
  motionBlurAdaptiveSampleLimit = 128;
  renderer = "Classic 3D";
  renderers = ["Classic 3D", "Advanced 3D"];
  motionGraphicsTemplateName = "";
  motionGraphicsTemplateControllerCount = 0;
  layers: CompLayers;
  parentFolder: FakeFolder | null = null;
  project: FakeProject;
  private backgroundColor: number[] = [0, 0, 0];

  constructor(project: FakeProject, spec: CompSpec) {
    this.project = project;
    this.id = spec.id;
    this.name = spec.name;
    this.width = spec.width;
    this.height = spec.height;
    this.duration = spec.duration;
    this.workAreaDuration = spec.duration;
    this.frameRate = spec.frameRate;
    const create = (layerName: string, properties: FakeProperty): FakeLayer => {
      const layer = new FakeLayer(this.project.nextLayerId(), layerName, this, properties);
      this.layers.list.unshift(layer);
      return layer;
    };
    this.layers = {
      list: [],
      addSolid: (...args) => create(args[1], solidProperties()),
      addText: (text: string) => { const layer = create(text, textProperties(text)); layer.typeName = "Text"; layer.matchName = "ADBE Text Layer"; return layer; },
      addShape: () => { const layer = create("Shape Layer", shapeProperties()); layer.typeName = "Shape"; layer.matchName = "ADBE Shape Layer"; return layer; },
      add: (item: FakeComp) => { const layer = create(item.name, solidProperties()); layer.typeName = "Composition"; layer.matchName = "ADBE AV Layer"; layer.source = item; return layer; },
    };
  }
  get numLayers(): number { return this.layers.list.length; }
  get bgColor(): number[] { return this.backgroundColor.slice(0); }
  set bgColor(next: number[]) { this.backgroundColor = (Array.isArray(next) ? next : []).slice(0, 3).map((channel) => (typeof channel === "number" ? Math.round(channel * 255) / 255 : 0)); }
  layer(index: number): FakeLayer | null { return this.layers.list[index - 1] ?? null; }
  removeLayer(layer: FakeLayer): void { const index = this.layers.list.indexOf(layer); if (index >= 0) this.layers.list.splice(index, 1); }
  remove(): void { this.project.removeItem(this); }
}

export class FakeFolder { id: number; name: string; constructor(id: number, name: string) { this.id = id; this.name = name; } }

interface FakeQueueEntry { comp: FakeComp; status: string; file: string }

interface FakeQueueItem { comp: FakeComp; status: string; outputModule: () => { file: { fsName: string; exists: boolean; length: number } } }

/** One render queue entry: what the probe reads back is the composition it holds and its status. */
export class FakeRenderQueue {
  entries: FakeQueueEntry[] = [];
  items: { add: (comp: FakeComp) => FakeQueueItem };
  constructor() {
    this.items = { add: (comp: FakeComp) => { const entry: FakeQueueEntry = { comp, status: "QUEUED", file: "" }; this.entries.push(entry); return this.wrap(entry); } };
  }
  get numItems(): number { return this.entries.length; }
  item(index: number): FakeQueueItem | null { const entry = this.entries[index - 1]; return entry ? this.wrap(entry) : null; }
  remove(index: number): void { this.entries.splice(index - 1, 1); }
  private wrap(entry: FakeQueueEntry): FakeQueueItem {
    return { comp: entry.comp, status: entry.status, outputModule: () => ({ file: { fsName: entry.file, exists: false, length: 0 } }) };
  }
}

interface ProjectItems {
  all: Array<FakeComp | FakeFolder>;
  addComp: (...args: [name: string, width: number, height: number, aspect: number, duration: number, frameRate: number]) => FakeComp;
  addFolder: (name: string) => FakeFolder;
}

export class FakeProject {
  items: ProjectItems;
  activeItem: FakeComp | null = null;
  dirty = false;
  file: { fsName: string; name: string } | null = null;
  bitsPerChannel = 8;
  expressionEngine = "javascript-1.0";
  linearBlending = false;
  linearizeWorkingSpace = false;
  workingSpace = "sRGB IEC61966-2.1";
  renderQueue = new FakeRenderQueue();
  revision = undefined;
  changeCounter = undefined;
  private nextId = 1;
  private nextLayer = 1;

  constructor() {
    const addComp = (...args: [name: string, width: number, height: number, aspect: number, duration: number, frameRate: number]): FakeComp => {
      const comp = new FakeComp(this, { id: this.nextId++, name: args[0], width: args[1], height: args[2], duration: args[4], frameRate: args[5] });
      this.items.all.push(comp);
      return comp;
    };
    this.items = {
      all: [],
      addComp,
      addFolder: (name: string) => { const folder = new FakeFolder(this.nextId++, name); this.items.all.push(folder); return folder; },
    };
  }
  get numItems(): number { return this.items.all.length; }
  item(index: number): FakeComp | FakeFolder | null { return this.items.all[index - 1] ?? null; }
  nextLayerId(): number { return 1000 + (this.nextLayer += 1); }
  removeItem(item: FakeComp | FakeFolder): void { const index = this.items.all.indexOf(item); if (index >= 0) this.items.all.splice(index, 1); }
}
