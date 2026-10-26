/**
 * Composition assets for the chat tests: probe snapshots in exactly the envelope `/v1/snapshots`
 * accepts, authored here so the tests are reproducible on any machine. The paths and matchNames
 * are the real After Effects vocabulary this repository already relies on, not invented strings.
 */
import type { WireObject, WireValue } from "./wire-types.js";

/** One property, group or effect of a layer as the probe lists it. */
export type AssetProperty = {
  path: string;
  matchName: string;
  displayName: string;
  kind: "property" | "group" | "effect";
  valueType: "number" | "string" | "boolean" | "color" | "vector" | "layer" | "enum" | "unknown";
  value: WireValue;
  canSetValue: boolean;
  expression?: string;
  expressionEnabled?: boolean;
  keyframeCount?: number;
  enabled?: boolean;
};

/** One layer of a probe. */
export type AssetLayer = {
  id: string;
  index: number;
  name: string;
  type: "text" | "shape" | "av" | "null" | "camera" | "light" | "adjustment";
  enabled: boolean;
  shy: boolean;
  solo: boolean;
  locked: boolean;
  startTime: number;
  inPoint: number;
  outPoint: number;
  stretch: number;
  parentId: string | null;
  matteLayerId: string | null;
  matteType: "none";
  isSelected: boolean;
  sourceId: string | null;
  propertyPaths: AssetProperty[];
};

/** A composition a scenario starts from, with the probe snapshot that describes it. */
export interface CompositionAsset {
  id: string;
  description: string;
  probe: WireObject;
  empty?: boolean;
}

const TRANSFORM = "ADBE Transform Group";
/** The transform paths exactly as `tools/host-verification` names them. */
export const PATHS = {
  anchor: `${TRANSFORM}/ADBE Anchor Point`,
  position: `${TRANSFORM}/ADBE Position`,
  scale: `${TRANSFORM}/ADBE Scale`,
  rotation: `${TRANSFORM}/ADBE Rotate Z`,
  opacity: `${TRANSFORM}/ADBE Opacity`,
  textDocument: "ADBE Text Properties/ADBE Text Document",
  animators: "ADBE Text Properties/ADBE Text Animators",
  shapeRoot: "ADBE Root Vectors Group",
  shapeGroup: "ADBE Root Vectors Group/ADBE Vector Group",
  shapeContents: "ADBE Root Vectors Group/ADBE Vector Group/ADBE Vectors Group",
  marker: "ADBE Marker",
  blur: "ADBE Effect Parade/ADBE Gaussian Blur 2",
  blurAmount: "ADBE Effect Parade/ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0001",
  glow: "ADBE Effect Parade/ADBE Glo2",
  glowThreshold: "ADBE Effect Parade/ADBE Glo2/ADBE Glo2-0002",
} as const;

function property({ path, matchName, displayName, value, valueType, extra = {} }: { path: string; matchName: string; displayName: string; value: WireValue; valueType: AssetProperty["valueType"]; extra?: Partial<AssetProperty> }): AssetProperty {
  return { path, matchName, displayName, kind: "property", valueType, value, canSetValue: true, ...extra };
}
function group(path: string, matchName: string, displayName: string): AssetProperty {
  return { path, matchName, displayName, kind: "group", valueType: "unknown", value: null, canSetValue: false };
}
function effect(path: string, matchName: string, displayName: string, enabled = true): AssetProperty {
  return { path, matchName, displayName, kind: "effect", valueType: "unknown", value: null, canSetValue: false, enabled };
}
function transform(values: { position: [number, number]; scale?: [number, number]; rotation?: number; opacity?: number; anchored?: boolean }): AssetProperty[] {
  return [
    group(TRANSFORM, "ADBE Transform Group", "Transform"),
    property({ path: PATHS.anchor, matchName: "ADBE Anchor Point", displayName: "Anchor Point", value: [0, 0], valueType: "vector" }),
    property({ path: PATHS.position, matchName: "ADBE Position", displayName: "Position", value: values.position, valueType: "vector" }),
    property({ path: PATHS.scale, matchName: "ADBE Scale", displayName: "Scale", value: values.scale ?? [100, 100], valueType: "vector" }),
    property({ path: PATHS.rotation, matchName: "ADBE Rotate Z", displayName: "Rotation", value: values.rotation ?? 0, valueType: "number" }),
    property({ path: PATHS.opacity, matchName: "ADBE Opacity", displayName: "Opacity", value: values.opacity ?? 100, valueType: "number" }),
  ];
}

function filledShape({ groupName, kind, size, color }: { groupName: string; kind: "rectangle" | "ellipse"; size: [number, number]; color: [number, number, number, number] }): AssetProperty[] {
  const shapeMatchName = kind === "rectangle" ? "ADBE Vector Shape - Rect" : "ADBE Vector Shape - Ellipse";
  const sizeMatchName = kind === "rectangle" ? "ADBE Vector Rect Size" : "ADBE Vector Ellipse Size";
  const shapePath = `${PATHS.shapeContents}/${shapeMatchName}`;
  const fillPath = `${PATHS.shapeContents}/ADBE Vector Graphic - Fill`;
  return [
    group(PATHS.shapeRoot, "ADBE Root Vectors Group", "Contents"),
    group(PATHS.shapeGroup, "ADBE Vector Group", groupName),
    group(PATHS.shapeContents, "ADBE Vectors Group", "Contents"),
    group(shapePath, shapeMatchName, kind === "rectangle" ? "Rectangle Path 1" : "Ellipse Path 1"),
    property({ path: `${shapePath}/${sizeMatchName}`, matchName: sizeMatchName, displayName: "Size", value: size, valueType: "vector" }),
    group(fillPath, "ADBE Vector Graphic - Fill", "Fill 1"),
    property({ path: `${fillPath}/ADBE Vector Fill Color`, matchName: "ADBE Vector Fill Color", displayName: "Color", value: color, valueType: "color" }),
    property({ path: `${fillPath}/ADBE Vector Fill Opacity`, matchName: "ADBE Vector Fill Opacity", displayName: "Opacity", value: 100, valueType: "number" }),
  ];
}

type LayerInit = Pick<AssetLayer, "id" | "index" | "name" | "type" | "propertyPaths"> & Partial<AssetLayer>;

function layerTiming(init: Partial<AssetLayer>): Pick<AssetLayer, "startTime" | "inPoint" | "outPoint" | "stretch"> {
  return { startTime: init.startTime ?? 0, inPoint: init.inPoint ?? 0, outPoint: init.outPoint ?? 12, stretch: init.stretch ?? 100 };
}

function layerLinks(init: Partial<AssetLayer>): Pick<AssetLayer, "parentId" | "matteLayerId" | "matteType" | "isSelected" | "sourceId"> {
  return { parentId: init.parentId ?? null, matteLayerId: init.matteLayerId ?? null, matteType: "none", isSelected: init.isSelected ?? false, sourceId: init.sourceId ?? null };
}

function layer(init: LayerInit): AssetLayer {
  return {
    id: init.id, index: init.index, name: init.name, type: init.type, propertyPaths: init.propertyPaths,
    enabled: init.enabled ?? true, shy: init.shy ?? false, solo: init.solo ?? false, locked: init.locked ?? false,
    ...layerTiming(init),
    ...layerLinks(init),
  };
}

function probeEnvelope(asset: {
  project: string;
  revision: string;
  comp: { id: string; name: string; width: number; height: number; duration: number; frameRate: number; currentTime: number };
  layers: AssetLayer[];
  selectedLayerId?: string;
  sources?: WireObject[];
  items?: WireObject[];
}): WireObject {
  return {
    schemaVersion: "0.1",
    ok: true,
    requestId: `probe-${asset.comp.id}`,
    result: {
      runtime: { application: "After Effects", appVersion: "26.2.1", buildNumber: "2", buildName: "After Effects 26.2.1 (Build 2)", platform: "macOS", architecture: "arm64", compatible: true },
      project: { name: asset.project, filePath: null },
      revision: asset.revision,
      activeCompositionId: asset.comp.id,
      currentTime: asset.comp.currentTime,
      selectedLayerIds: asset.selectedLayerId ? [asset.selectedLayerId] : [],
      sources: asset.sources ?? [],
      items: asset.items ?? [],
      compositions: [{
        id: asset.comp.id, name: asset.comp.name, width: asset.comp.width, height: asset.comp.height, pixelAspect: 1,
        duration: asset.comp.duration, frameRate: asset.comp.frameRate,
        workAreaStart: 0, workAreaDuration: asset.comp.duration, currentTime: asset.comp.currentTime,
        layers: asset.layers.map((entry) => ({ ...entry, isSelected: entry.id === asset.selectedLayerId })),
      }],
    },
    warnings: [],
  };
}

const summerLaunchLayers: AssetLayer[] = [
  layer({
    id: "layer-title", index: 1, name: "TITLE — Summer", type: "text", isSelected: true, outPoint: 6,
    propertyPaths: [
      ...transform({ position: [960, 540] }),
      property({ path: PATHS.textDocument, matchName: "ADBE Text Document", displayName: "Source Text", value: "Summer", valueType: "string" }),
      group(PATHS.animators, "ADBE Text Animators", "Animators"),
      effect(PATHS.glow, "ADBE Glo2", "Glow"),
      property({ path: PATHS.glowThreshold, matchName: "ADBE Glo2-0002", displayName: "Glow Threshold", value: 60, valueType: "number" }),
    ],
  }),
  layer({
    id: "layer-lower-third", index: 2, name: "Lower Third", type: "text",
    propertyPaths: [
      ...transform({ position: [960, 900], opacity: 0 }),
      property({ path: PATHS.textDocument, matchName: "ADBE Text Document", displayName: "Source Text", value: "Aperture Labs", valueType: "string" }),
    ],
  }),
  layer({
    id: "layer-accent", index: 3, name: "Accent Bar", type: "shape",
    propertyPaths: [
      ...transform({ position: [660, 540], scale: [40, 100] }),
      ...filledShape({ groupName: "Accent Bar", kind: "rectangle", size: [600, 12], color: [0.12, 0.8, 0.95, 1] }),
    ],
  }),
  layer({
    id: "layer-plate", index: 4, name: "Plate", type: "av", locked: true, sourceId: "source-plate",
    propertyPaths: [
      ...transform({ position: [960, 540] }),
      effect(PATHS.blur, "ADBE Gaussian Blur 2", "Gaussian Blur"),
      property({ path: PATHS.blurAmount, matchName: "ADBE Gaussian Blur 2-0001", displayName: "Blurriness", value: 12, valueType: "number", extra: { expressionEnabled: true, expression: "time * 4" } }),
    ],
  }),
  layer({
    id: "layer-null", index: 5, name: "Null Control", type: "null",
    propertyPaths: [...transform({ position: [960, 540] })],
  }),
];

const socialLayers: AssetLayer[] = [
  layer({
    id: "layer-social-headline", index: 1, name: "Headline — Summer", type: "text",
    propertyPaths: [
      ...transform({ position: [540, 430] }),
      property({ path: PATHS.textDocument, matchName: "ADBE Text Document", displayName: "Source Text", value: "Summer starts here", valueType: "string" }),
    ],
  }),
  layer({
    id: "layer-social-supporting", index: 2, name: "Supporting Copy", type: "text",
    propertyPaths: [
      ...transform({ position: [540, 540] }),
      property({ path: PATHS.textDocument, matchName: "ADBE Text Document", displayName: "Source Text", value: "A brighter way forward", valueType: "string" }),
    ],
  }),
  layer({
    id: "layer-social-badge", index: 3, name: "Badge", type: "shape", isSelected: true,
    propertyPaths: [
      ...transform({ position: [540, 760] }),
      ...filledShape({ groupName: "Badge Circle", kind: "ellipse", size: [240, 240], color: [0.95, 0.65, 0.15, 1] }),
    ],
  }),
  layer({
    id: "layer-social-background", index: 4, name: "Background", type: "shape",
    propertyPaths: [
      ...transform({ position: [540, 540] }),
      ...filledShape({ groupName: "Background Rectangle", kind: "rectangle", size: [1080, 1080], color: [0.03, 0.05, 0.12, 1] }),
    ],
  }),
];

/** Every composition the scenarios can start from, by id. */
export const COMPOSITION_ASSETS: Readonly<Record<string, CompositionAsset>> = {
  "summer-launch": {
    id: "summer-launch",
    description: "1080p title spot: text title (selected), lower third, shape accent, blurred plate, null control.",
    probe: probeEnvelope({
      project: "Summer Launch", revision: "ae-revision-42",
      comp: { id: "comp-main", name: "Main", width: 1920, height: 1080, duration: 12, frameRate: 23.976, currentTime: 1.5 },
      layers: summerLaunchLayers, selectedLayerId: "layer-title",
      sources: [{ id: "source-plate", name: "Plate Solid", type: "solid", filePath: null, missing: false, width: 1920, height: 1080, duration: 12 }],
      items: [{ id: "item-plate", name: "Plate Solid", type: "footage", parentFolderId: null, compositionId: null, sourceId: "source-plate" }],
    }),
  },
  "social-square": {
    id: "social-square",
    description: "1080x1080 social cutdown: background, headline, supporting copy, and a selected shape badge.",
    probe: probeEnvelope({
      project: "Summer Launch — Social", revision: "ae-revision-7",
      comp: { id: "comp-social", name: "Social", width: 1080, height: 1080, duration: 6, frameRate: 30, currentTime: 0 },
      layers: socialLayers, selectedLayerId: "layer-social-badge",
    }),
  },
  "empty-ident": {
    id: "empty-ident",
    description: "1920x1080, 10s, empty: no layers and no selection, for a from-scratch build.",
    empty: true,
    probe: probeEnvelope({
      project: "Ident Build", revision: "ae-revision-1",
      comp: { id: "comp-ident", name: "Ident", width: 1920, height: 1080, duration: 10, frameRate: 30, currentTime: 0 },
      layers: [],
    }),
  },
  "empty-portrait-6s": {
    id: "empty-portrait-6s",
    description: "1620x1350, 6s, empty: no layers and no selection, for a portrait from-scratch animation.",
    empty: true,
    probe: probeEnvelope({
      project: "Portrait Build", revision: "ae-revision-1",
      comp: { id: "comp-portrait", name: "Portrait", width: 1620, height: 1350, duration: 6, frameRate: 30, currentTime: 0 },
      layers: [],
    }),
  },
};

/** The asset with this id, or a throw that lists the known ones. */
export function compositionAsset(id: string): CompositionAsset {
  const asset = COMPOSITION_ASSETS[id];
  if (!asset) throw new Error(`Unknown composition asset "${id}". Known: ${Object.keys(COMPOSITION_ASSETS).join(", ")}.`);
  return asset;
}

/**
 * A publish-ready copy of an asset carrying a fresh observation id: the sidecar refuses a
 * request id it has seen superseded, so a real probe stamps a new one per publish.
 */
export function freshProbe(asset: CompositionAsset, observationId: string): WireObject {
  return { ...asset.probe, requestId: observationId };
}
