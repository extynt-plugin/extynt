/** Loads the host's eyes-open snapshot probe against a two-layer composition so tests can read how track mattes show up in the snapshot. */

import vm from "node:vm";
import assert from "node:assert/strict";
import { fieldOf, readJson, recordOf, recordsAt } from "./json-narrow.js";
import { type JsonObject } from "@extynt/decode";
import { hostTextFunction, loadHostFiles } from "./host-sources.js";

/** The TrackMatteType enum members of After Effects 26 and their numeric values. */
export const TRACK_MATTE_MEMBERS = { NO_TRACK_MATTE: 5012, ALPHA: 5013, ALPHA_INVERTED: 5014, LUMA: 5015, LUMA_INVERTED: 5016 } as const;

interface SnapshotLeaf {
  readonly matchName: string;
  readonly name: string;
  readonly value: number[];
  readonly numProperties: 0;
  readonly propertyValueType: 1;
  readonly expressionEnabled: false;
  readonly numKeys: 0;
  setValue(): void;
}

interface SnapshotGroup {
  readonly matchName: string;
  readonly name: string;
  readonly numProperties: 1;
  property(index: number): SnapshotLeaf | null;
}

function positionLeaf(): SnapshotLeaf {
  return { matchName: "ADBE Position", name: "Position", value: [960, 540], numProperties: 0, propertyValueType: 1, setValue: () => undefined, expressionEnabled: false, numKeys: 0 };
}

function transformGroup(): SnapshotGroup {
  return { matchName: "ADBE Transform Group", name: "Transform", numProperties: 1, property: (index) => (index === 1 ? positionLeaf() : null) };
}

class SnapshotLayer {
  public trackMatteType: number | null = null;
  public trackMatteLayer: SnapshotLayer | null = null;
  public parent: SnapshotLayer | null = null;
  public source: null = null;
  public selected = false;
  public label = 1;
  public enabled = true;
  public shy = false;
  public solo = false;
  public locked = false;
  public startTime = 0;
  public inPoint = 0;
  public outPoint = 5;
  public stretch = 100;
  public nullLayer = false;
  public adjustmentLayer = false;

  public constructor(public id: string, public name: string, public properties: SnapshotGroup[], public siblings: () => SnapshotLayer[]) {}

  public get index(): number {
    return this.siblings().indexOf(this) + 1;
  }

  public get numProperties(): number {
    return this.properties.length;
  }

  public property(index: number): SnapshotGroup | null {
    return this.properties[index - 1] ?? null;
  }
}

class SnapshotComp {
  public id = "35";
  public name = "Matte Comp";
  public width = 1920;
  public height = 1080;
  public pixelAspect = 1;
  public duration = 10;
  public frameRate = 30;
  public bgColor = [0, 0, 0];
  public workAreaStart = 0;
  public workAreaDuration = 10;
  public time = 0;
  public selectedLayers: SnapshotLayer[] = [];

  public constructor(public items: SnapshotLayer[]) {}

  public get numLayers(): number {
    return this.items.length;
  }

  public layer(index: number): SnapshotLayer | null {
    return this.items[index - 1] ?? null;
  }
}

function snapshotContext(comp: SnapshotComp): vm.Context {
  const holder = { ...TRACK_MATTE_MEMBERS, reflect: { properties: Object.keys(TRACK_MATTE_MEMBERS).map((name) => ({ name })) } };
  return vm.createContext({
    app: { version: "26.2.1x2", buildNumber: "2", buildName: "After Effects 26.2.1x2", effects: [], project: { numItems: 1, item: () => comp, activeItem: comp, file: null } },
    CompItem: SnapshotComp,
    FolderItem: function FolderItem() {},
    PropertyValueType: { NO_VALUE: 0, CUSTOM_VALUE: 99, TwoD_SPATIAL: 7, ThreeD_SPATIAL: 8, TwoD: 5, ThreeD: 6 },
    TrackMatteType: holder,
    $: { os: "Macintosh OS" },
    encodeURIComponent,
  });
}

/** The probe with `read(trackMatteType, matted)` for the fill layer's snapshot entry, `addLayerAbove` to insert a layer, and the objects behind it. */
export function loadSnapshotProbe() {
  const layers: SnapshotLayer[] = [];
  const fill = new SnapshotLayer("48", "Fill", [transformGroup()], () => layers);
  const matte = new SnapshotLayer("50", "Matte", [transformGroup()], () => layers);
  layers.push(matte, fill);
  const comp = new SnapshotComp(layers);
  const context = snapshotContext(comp);
  loadHostFiles(context, "probe.jsx");
  const invoke = hostTextFunction(context, "aeEyesOpenProbe");
  const read = (trackMatteType: number, matted: boolean): JsonObject => {
    fill.trackMatteType = trackMatteType;
    fill.trackMatteLayer = matted ? matte : null;
    const envelope = recordOf(readJson(invoke(JSON.stringify({ schemaVersion: "0.1", requestId: "matte" }))));
    assert.equal(fieldOf(envelope, "ok"), true, JSON.stringify(fieldOf(envelope, "error")));
    const found = recordsAt(envelope, "result", "compositions", 0, "layers").find((entry) => String(fieldOf(entry, "id")) === "48");
    assert.ok(found, "the fill layer must appear in the snapshot");
    return found;
  };
  const addLayerAbove = (name: string): SnapshotLayer => {
    const created = new SnapshotLayer(`inserted-${layers.length}`, name, [transformGroup()], () => layers);
    layers.unshift(created);
    return created;
  };
  return { read, addLayerAbove, comp, fill, matte, layers };
}
