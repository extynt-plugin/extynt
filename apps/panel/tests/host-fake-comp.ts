/** The fake After Effects layer and composition items: layer ordering, nesting, track mattes and the layer factory a comp exposes. */

import { FakeProperty } from "./host-fake-property.js";
import { FakeShapeRoot } from "./host-fake-groups.js";
import { createdCameraOptions, createdLightOptions, createdLightTransform, createdTextProperties, createdTransform } from "./host-fake-created.js";
import type { FakeFolderItem, FakeFootageItem } from "./host-fake-footage.js";

/** The layer-creating calls of `comp.layers`. */
export interface FakeLayerFactory {
  addText: (text: string) => FakeLayer;
  addShape: () => FakeLayer;
  addNull: () => FakeLayer;
  addCamera: (name: string, point: number[]) => FakeLayer;
  addLight: (name: string, point: number[]) => FakeLayer;
  addSolid: (color: number[], name: string, ...size: readonly [width: number, height: number, pixelAspect: number]) => FakeLayer;
  add: (source: FakeCompItem | FakeFootageItem) => FakeLayer;
  precompose?: (indices: ReadonlyArray<number>, name: string) => FakeCompItem;
}

/** A layer that belongs to at most one composition and reorders, duplicates and removes itself through it. */
export class FakeLayer {
  public locked = false;
  public selected = false;
  public inPoint = 0;
  public outPoint = 10;
  public startTime = 0;
  public stretch = 100;
  public adjustmentLayer = false;
  public audioEnabled = true;
  public audioLevels = new FakeProperty("ADBE Audio Levels", "Audio Levels", [], [0, 0], true);
  public parent: FakeLayer | null = null;
  public blendingMode: string | null = null;
  public threeDLayer = false;
  public shy = false;
  public solo = false;
  public enabled = true;
  public canSetTimeRemapEnabled = true;
  public timeRemapEnabled = false;
  public trackMatte: { layer: FakeLayer; type: string } | null = null;
  public trackMatteType: string | null = null;
  public source: FakeFootageItem | FakeCompItem | null = null;
  public hasVideo = true;
  public sceneEditModes: string[] = [];
  public sceneEditEffect: ((layer: FakeLayer, mode: string) => void) | null = null;
  public motionBlur?: boolean;
  public quality?: string;
  private owner: FakeCompItem | null = null;

  public constructor(public id: string, public properties: FakeProperty[], public name = id) {}

  public get index(): number {
    return this.owner ? this.owner.layerItems.indexOf(this) + 1 : 0;
  }

  public get numProperties(): number {
    return this.properties.length;
  }

  public attach(comp: FakeCompItem): void {
    this.owner = comp;
  }

  public doSceneEditDetection(mode: string): void {
    this.sceneEditModes.push(mode);
    if (!this.sceneEditEffect) throw new Error("scene edit detection failed");
    this.sceneEditEffect(this, mode);
  }

  public duplicate(): FakeLayer {
    return this.attachedOwner().duplicateLayer(this);
  }

  public remove(): void {
    this.attachedOwner().removeLayer(this);
  }

  public moveToBeginning(): void {
    this.owner?.moveLayer(this, 0);
  }

  public moveToEnd(): void {
    this.owner?.moveLayer(this, this.owner.layerItems.length - 1);
  }

  public moveBefore(reference: FakeLayer): void {
    this.attachedOwner().moveRelative(this, reference, false);
  }

  public moveAfter(reference: FakeLayer): void {
    this.attachedOwner().moveRelative(this, reference, true);
  }

  public setTrackMatte(layer: FakeLayer, type: string): void {
    this.trackMatte = { layer, type };
    this.trackMatteType = type;
    layer.enabled = false;
  }

  public removeTrackMatte(): void {
    this.trackMatte = null;
    this.trackMatteType = "no-track-matte";
  }

  public property(index: number | string): FakeProperty | null {
    if (typeof index === "string") return this.properties.find((property) => property.matchName === index) ?? null;
    return this.properties[index - 1] ?? null;
  }

  private attachedOwner(): FakeCompItem {
    if (!this.owner) throw new Error("missing owner");
    return this.owner;
  }
}

function layerFactory(comp: FakeCompItem): FakeLayerFactory {
  let nextId = 1;
  const add = (name: string, properties: FakeProperty[] = []): FakeLayer => {
    const layer = new FakeLayer(`created-${nextId++}`, properties, name);
    layer.attach(comp);
    comp.layerItems.push(layer);
    return layer;
  };
  const requireCenter = (kind: string, point: number[]): void => {
    const isCenter = point.length === 2 && point[0] === comp.width / 2 && point[1] === comp.height / 2;
    if (!isCenter) throw new Error(`${kind} expects a 2D center point`);
  };
  return {
    addText: (text) => add("Text", [createdTextProperties(text)]),
    addShape: () => add("Shape", [new FakeShapeRoot()]),
    addNull: () => add("Null"),
    addCamera: (name, point) => {
      requireCenter("camera", point);
      return Object.assign(add(name, [createdCameraOptions(), createdTransform(point)]), { matchName: "ADBE Camera Layer" });
    },
    addLight: (name, point) => {
      requireCenter("light", point);
      return add(name, [createdLightOptions(), createdLightTransform(point)]);
    },
    addSolid: (_color, name) => add(name),
    add: (source) => add(source.name),
  };
}

/** A composition with ordered layers, composition settings and the layer factory After Effects exposes as `layers`. */
export class FakeCompItem {
  public width = 1920;
  public height = 1080;
  public pixelAspect = 1;
  public removed = false;
  public usedIn: FakeCompItem[] = [];
  public duration = 10;
  public frameRate = 30;
  public bgColor: number[] = [0, 0, 0];
  public workAreaStart = 0;
  public workAreaDuration = 10;
  public motionBlur = false;
  public shutterAngle = 180;
  public shutterPhase = -90;
  public motionBlurSamplesPerFrame = 16;
  public motionBlurAdaptiveSampleLimit = 128;
  public renderer = "Classic 3D";
  public readonly renderers = ["Classic 3D", "Advanced 3D"];
  public readonly markerProperty = new FakeProperty("ADBE Marker", "Marker", [], null, false);
  public parentFolder: FakeFolderItem | null = null;
  public readonly layers: FakeLayerFactory;
  public guides?: Array<[number, number]>;
  public addGuide?: (orientation: number, position: number) => number;
  public removeGuide?: (index: number) => void;
  public motionGraphicsTemplateName?: string;
  public exportAsMotionGraphicsTemplate?: (overwrite: boolean, path: string) => boolean;
  public getMotionGraphicsTemplateControllerName?: (index: number) => string;

  public constructor(public id: string, public layerItems: FakeLayer[], public name = id) {
    for (const layer of layerItems) layer.attach(this);
    this.layers = layerFactory(this);
  }

  public get numLayers(): number {
    return this.layerItems.length;
  }

  public get selectedLayers(): FakeLayer[] {
    return this.layerItems.filter((layer) => layer.selected);
  }

  public remove(): void {
    this.removed = true;
  }

  public layer(index: number): FakeLayer | null {
    return this.layerItems[index - 1] ?? null;
  }

  public duplicateLayer(source: FakeLayer): FakeLayer {
    const duplicate = new FakeLayer(`duplicate-${source.id}-${this.layerItems.length + 1}`, source.properties, `${source.name} 2`);
    duplicate.attach(this);
    this.layerItems.splice(this.layerItems.indexOf(source), 0, duplicate);
    return duplicate;
  }

  public removeLayer(layer: FakeLayer): void {
    this.layerItems.splice(this.indexOfLayer(layer), 1);
  }

  public moveLayer(layer: FakeLayer, destination: number): void {
    this.layerItems.splice(this.indexOfLayer(layer), 1);
    this.layerItems.splice(Math.max(0, Math.min(destination, this.layerItems.length)), 0, layer);
  }

  public moveRelative(layer: FakeLayer, reference: FakeLayer, after: boolean): void {
    this.layerItems.splice(this.indexOfLayer(layer), 1);
    const referenceIndex = this.layerItems.indexOf(reference);
    if (referenceIndex < 0) throw new Error("missing reference");
    this.layerItems.splice(referenceIndex + (after ? 1 : 0), 0, layer);
  }

  private indexOfLayer(layer: FakeLayer): number {
    const index = this.layerItems.indexOf(layer);
    if (index < 0) throw new Error("missing layer");
    return index;
  }
}
