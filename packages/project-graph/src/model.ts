/** The typed project snapshot model that plans and queries read: JSON-compatible by construction so any snapshot can be hashed. */
import type { JsonValue } from "@extynt/decode";

export type LayerType = "av" | "text" | "shape" | "camera" | "light" | "null" | "adjustment" | "unknown";

/** The running After Effects: `version` is the exact app.version, `buildNumber` its string-safe build number when available, and `buildName` the display label as reported. */
export type HostMetadata = {
  application: "After Effects";
  version: string;
  buildNumber: string | null;
  buildName?: string;
  platform: "macOS" | "Windows" | "unknown";
  architecture: "arm64" | "x86_64" | "unknown";
};

/** The open project; `filePath` is null for an unsaved project. */
export type ProjectMetadata = {
  name: string;
  filePath: string | null;
};

export type ProjectItemType = "composition" | "footage" | "folder" | "unknown";

/** How After Effects interprets one footage file; a field AE would not answer is absent. */
export type FootageInterpretationSnapshot = {
  nativeFrameRate?: number;
  conformFrameRate?: number;
  displayFrameRate?: number;
  alphaMode?: "ignore" | "straight" | "premultiplied";
  premulColor?: [number, number, number];
  hasAlpha?: boolean;
  loop?: number;
  pixelAspect?: number;
  fieldSeparationType?: "off" | "upper-field-first" | "lower-field-first";
  invertAlpha?: boolean;
  highQualityFieldSeparation?: boolean;
  removePulldown?: string;
  isStill?: boolean;
};

/** One footage source of the project, with the interpretation the host reported for it. */
export type SourceSnapshot = {
  id: string;
  name: string;
  type: "footage" | "solid" | "placeholder" | "unknown";
  filePath: string | null;
  missing: boolean;
  width?: number;
  height?: number;
  duration?: number;
  interpretation?: FootageInterpretationSnapshot;
};

/** One item of the project panel and the folder, composition or source it stands for. */
export type ProjectItemSnapshot = {
  id: string;
  name: string;
  type: ProjectItemType;
  parentFolderId: string | null;
  compositionId: string | null;
  sourceId: string | null;
};

/** One keyframe; `interpolation` keeps the host-reported labels as given. */
export type KeyframeSnapshot = {
  time: number;
  value: JsonValue;
  interpolation?: { inType?: string; outType?: string };
};

/** One property of a layer: `path` is the slash-delimited matchName path (ADBE Transform Group/ADBE Position); `enabled` is present when the host exposes an enabled state; `keyframeCount` is the host-reported numKeys when keyframes were not captured; `keyDigest` is the host hash of key times, values and interpolation, so value-only key edits stay visible to the fingerprint; `hidden` means the value is not meaningful; `animatable: false` means the property cannot be keyframed. */
export type PropertySnapshot = {
  path: string;
  matchName: string;
  displayName: string;
  kind: "property" | "group" | "effect";
  valueType: "number" | "string" | "boolean" | "color" | "vector" | "layer" | "enum" | "unknown";
  value: JsonValue | null;
  canSetValue: boolean;
  enabled?: boolean;
  keyframes?: KeyframeSnapshot[];
  keyframeCount?: number;
  keyDigest?: string;
  hidden?: boolean;
  animatable?: false;
  children?: PropertySnapshot[];
  expression?: string | null;
  expressionEnabled?: boolean;
};

/** One effect on a layer: `path` is its matchName path, `enabled` is null when the host did not expose an enabled state, and `properties` are its direct and nested controls with their stable paths. */
export type EffectSnapshot = {
  path: string;
  matchName: string;
  displayName: string;
  enabled: boolean | null;
  properties: PropertySnapshot[];
  expressions: ExpressionSnapshot[];
};

export type ExpressionSnapshot = {
  path: string;
  matchName: string;
  displayName: string;
  expression: string | null;
  enabled: boolean;
  valueType: PropertySnapshot["valueType"];
};

/** One layer: `id` is the string form of the persistent layer.id, `label` the label color index (0-16) that takes part in graph identity, `threeD` the 3D layer switch when reported, and `compositionSourceId` the composition item id of a precomp layer. */
export type LayerSnapshot = {
  id: string;
  index: number;
  name: string;
  type: LayerType;
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
  matteType: "none" | "alpha" | "alpha-inverted" | "luma" | "luma-inverted";
  isSelected: boolean;
  label?: number;
  threeD?: boolean;
  sourceId: string | null;
  properties: PropertySnapshot[];
  compositionSourceId?: string | null;
};

/** One composition: `backgroundColor` is RGB 0-1; motion blur, frame blending, draft 3D, resolution factor, renderers and markers are absent when the host did not report them; `renderers` lists the names the composition offers, never a fixed list; `markers` are the composition markers, bounded like layer markers. */
export type CompositionSnapshot = {
  itemIndex?: number;
  id: string;
  name: string;
  backgroundColor?: [number, number, number];
  width: number;
  height: number;
  pixelAspect: number;
  duration: number;
  frameRate: number;
  workAreaStart: number;
  workAreaDuration: number;
  motionBlur?: boolean;
  shutterAngle?: number;
  shutterPhase?: number;
  motionBlurSamplesPerFrame?: number;
  motionBlurAdaptiveSampleLimit?: number;
  frameBlending?: boolean;
  draft3d?: boolean;
  resolutionFactor?: [number, number];
  renderer?: string;
  renderers?: string[];
  markers?: { count: number; markers: Array<{ time: number; comment?: string; duration?: number; chapter?: string | null; url?: string | null; cuePointName?: string | null; label?: number }>; truncated?: boolean };
  layers: LayerSnapshot[];
  currentTime?: number | null;
};

export type SelectionContext = {
  compositionId: string | null;
  layerIds: string[];
};

/** Freshness kept apart from graph identity: the adapter `revision` token, when the host `capturedAt` the snapshot, and when the sidecar accepted it (`receivedAt`). */
export type SnapshotFreshness = {
  revision: string;
  capturedAt: string;
  receivedAt?: string | null;
};

export type LocalEffectCreationObservation = {
  effectMatchName: "ADBE Gaussian Blur 2";
  inventory: Array<{ index: number; matchName: string }>;
  absent: true;
  canAdd: true;
  dependencyPolicy: "local-effect-creation";
};
/** The native read of a Gaussian Blur control a literal assignment depends on; `unitsText` is AE's units label when the read reported one, null when the host reported none (phase-3 removal: the units comparison moves onto a typed units field). */
export type LocalBlurObservation = {
  effectMatchName: "ADBE Gaussian Blur 2"; effectIndex: number; inventory: Array<{ index: number; matchName: string }>;
  effectEnabled: boolean; matchNames: string[]; valueType: "number"; canSetValue: true; keyframeCount: 0;
  expressionEnabled: false; expression: ""; value: number; minimum: number; maximum: number;
  dependencyPolicy: "local-literal-assignment";
  unitsText?: string | null; isTimeVarying?: boolean | null; propertyIndices?: number[];
};
/** The whole project as one snapshot. `revision` is the adapter token that changes after a project mutation, `fingerprint` the stable content hash used as a plan precondition, and `selectionFingerprint` the hash of the active composition and selected layers. */
export type ProjectSnapshot = {
  hostStamp?: { epoch: number; revision: number };
  coverage?: { kind: "composition-metadata"; compositionId: string; properties: "unknown"; otherCompositions: "unknown"; otherLayers?: "unknown"; observedLayerIds?: string[]; localEffect?: LocalBlurObservation; localCreation?: LocalEffectCreationObservation; collectionSessionId?: string };
  schemaVersion: "0.1";
  capturedAt: string;
  host: HostMetadata;
  project: ProjectMetadata;
  revision: string;
  fingerprint: string;
  selectionFingerprint: string;
  freshness: SnapshotFreshness;
  activeCompositionId: string | null;
  currentTime: number | null;
  selection: SelectionContext;
  items?: ProjectItemSnapshot[];
  sources?: SourceSnapshot[];
  compositions: CompositionSnapshot[];
  warnings?: string[];
  truncation?: { truncated: boolean; limits: Record<string, number> };
};

export type SnapshotInput = Omit<ProjectSnapshot, "schemaVersion" | "fingerprint" | "selectionFingerprint" | "freshness"> & {
  schemaVersion?: "0.1";
  fingerprint?: string;
  selectionFingerprint?: string;
  freshness?: SnapshotFreshness;
};
