// Chat-sized composition and layer inspection: every response is paged against an explicit byte budget and returns an opaque cursor.
import { LAYER_STYLES, layerStylePath } from "@extynt/action-plan";
import type { LayerStyleName } from "@extynt/action-plan";
import { extractEffects, findCompositionById, openCompositionNotRead } from "@extynt/project-graph";
import type { CompositionSnapshot, LayerSnapshot, ProjectSnapshot, PropertySnapshot } from "@extynt/project-graph";
import { boundedAt, integerAt, jsonOf, objectOf, stringAt } from "./json.js";
import { decodeJson, isJsonArray, jsonObject } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { toolError, toolSuccess } from "./tool-result.js";
import type { ToolBase, ToolFailure, ToolResult } from "./tool-result.js";

/** The smallest byte budget a caller may ask an inspection page to fit. */
export const INSPECT_MIN_BUDGET_BYTES = 4_000;
/** The largest byte budget a caller may ask an inspection page to fit. */
export const INSPECT_MAX_BUDGET_BYTES = 64_000;
const INSPECT_DEFAULT_BUDGET_BYTES = 32_000;
const MAX_ANIMATED_PER_LAYER = 24;
const MAX_STRING_CHARS = 512;
const MAX_ARRAY_ITEMS = 64;
const MAX_EXPRESSION_CHARS = 2048;
const OPAQUE_TYPES = new Set(["unknown", "custom", "none"]);
const IMPLICIT_TYPES = new Set(["number", "vector", "string", "boolean"]);
const OPAQUE_NOTE = "set in the effect's own UI; no readback shows its setting and the name is a label, not the setting";
const INSPECT_NOISE_PREFIXES = ["ADBE Extrsn Options Group", "ADBE Material Options Group", "ADBE Plane Options Group", "ADBE Layer Styles", "ADBE Text Properties/ADBE Text Path Options", "ADBE Text Properties/ADBE Text More Options", "ADBE Audio Group", "ADBE Layer Overrides", "ADBE Source Options Group"];

type Cursor = { scope: string; fingerprint: string; offset: number };
type LayerStylePath = { style: LayerStyleName; path: string };
type PropertySelection = { matched: PropertySnapshot[]; omitted: Record<string, number>; enabledStylePaths: LayerStylePath[] };
type PropertyFilter = { include: string; prefix: string; enabledStylePaths: LayerStylePath[]; omitted: Record<string, number> };
type LayerHeaderInput = { layer: LayerSnapshot; comp: CompositionSnapshot; include: string; prefix: string; all: PropertySnapshot[]; selection: PropertySelection };
type PageRequest = { scope: string; fingerprint: string; offset: number; shown: number; total: number };

const DEFAULT_TRANSFORM = new Map<string, (value: JsonValue) => boolean>([
  ["ADBE Scale", (value) => allEqual(value, 100)],
  ["ADBE Opacity", (value) => value === 100],
  ["ADBE Rotate Z", (value) => value === 0],
  ["ADBE Rotate X", (value) => value === 0],
  ["ADBE Rotate Y", (value) => value === 0],
  ["ADBE Orientation", (value) => allEqual(value, 0)],
]);

function allEqual(value: JsonValue, expected: number): boolean {
  return isJsonArray(value) && value.every((item) => item === expected);
}

function onlyIf(condition: boolean | undefined, value: JsonValue | undefined): JsonValue | undefined {
  return condition ? value : undefined;
}

/** An absent target is a mistake in the call, not an empty result; name the ids that do exist. */
export function compositionNotFound(snapshot: ProjectSnapshot, compositionId: string): ToolFailure {
  const unread = openCompositionNotRead(snapshot, compositionId);
  if (unread) return toolError("COMPOSITION_NOT_FOUND", unread);
  const known = snapshot.compositions.slice(0, 20).map((comp) => `${comp.id} "${comp.name}"`).join(", ");
  const active = snapshot.activeCompositionId ? ` The active composition is ${snapshot.activeCompositionId}.` : "";
  return toolError("COMPOSITION_NOT_FOUND", `No composition ${compositionId || "(none given)"} in this project.${active} Compositions: ${known || "none"}.`);
}

/** The refusal for a layer id the composition does not hold, naming the layers it does. */
export function layerNotFound(compositionId: string, compositionName: string, layers: readonly LayerSnapshot[], layerId: string): ToolFailure {
  const known = layers.slice(0, 24).map((layer) => `${layer.id} "${layer.name}" (${layer.type}, index ${layer.index})`).join(", ");
  const more = layers.length > 24 ? `, … ${layers.length - 24} more` : "";
  return toolError("LAYER_NOT_FOUND", `No layer ${layerId || "(none given)"} in composition ${compositionId} "${compositionName}". Layers: ${known || "none"}${more}.`);
}

/** The composition a call means: the one it names, else the active one; the page of its layers that fits the byte budget, with a cursor for the rest. */
export function inspectComposition(base: ToolBase, snapshot: ProjectSnapshot, args: JsonObject): ToolResult {
  const requested = stringAt(args, "compositionId") || snapshot.activeCompositionId || "";
  const comp = findCompositionById(snapshot, requested);
  if (!comp) return compositionNotFound(snapshot, requested);
  const scope = `comp:${comp.id}`;
  const offset = cursorOffset(args.cursor, scope, snapshot.fingerprint);
  if (typeof offset !== "number") return offset;
  const budget = boundedAt(args, "maxBytes", { fallback: INSPECT_DEFAULT_BUDGET_BYTES, min: INSPECT_MIN_BUDGET_BYTES, max: INSPECT_MAX_BUDGET_BYTES });
  const header = compositionHeader(comp);
  const layers = comp.layers.slice(offset).map((layer) => layerSummary(snapshot, layer));
  const page = pageByBudget(layers, boundedAt(args, "limit", { fallback: 50, min: 1, max: 256 }), budget - bytes(header) - 512);
  const nextCursor = nextCursorOf({ scope, fingerprint: snapshot.fingerprint, offset, shown: page.items.length, total: comp.layers.length });
  return pageResult(base, objectOf({ ...header, layers: page.items, layerOffset: onlyIf(offset > 0, offset), nextCursor: nextCursor ?? undefined }), nextCursor);
}

function compositionHeader(comp: CompositionSnapshot): JsonObject {
  const fullWorkArea = comp.workAreaStart === 0 && Math.abs(comp.workAreaDuration - comp.duration) < 1e-6;
  return objectOf({
    id: comp.id, name: comp.name, width: comp.width, height: comp.height,
    pixelAspect: onlyIf(comp.pixelAspect !== 1, comp.pixelAspect),
    duration: comp.duration, frameRate: comp.frameRate,
    workAreaStart: onlyIf(!fullWorkArea, comp.workAreaStart),
    workAreaDuration: onlyIf(!fullWorkArea, comp.workAreaDuration),
    currentTime: typeof comp.currentTime === "number" ? comp.currentTime : undefined,
    layerCount: comp.layers.length,
  });
}

function nextCursorOf({ scope, fingerprint, offset, shown, total }: PageRequest): string | null {
  const next = offset + shown;
  return next < total ? encodeCursor({ scope, fingerprint, offset: next }) : null;
}

function pageResult(base: ToolBase, data: JsonObject, nextCursor: string | null): ToolResult {
  const success = toolSuccess(base, data);
  return nextCursor ? { ...success, truncated: true } : success;
}

function requestedLayer(snapshot: ProjectSnapshot, args: JsonObject): { comp: CompositionSnapshot; layer: LayerSnapshot } | ToolFailure {
  const requested = stringAt(args, "compositionId") || snapshot.activeCompositionId || "";
  const comp = findCompositionById(snapshot, requested);
  if (!comp) return compositionNotFound(snapshot, requested);
  const layerId = String(args.layerId ?? "");
  const layer = comp.layers.find((candidate) => candidate.id === layerId);
  return layer ? { comp, layer } : layerNotFound(comp.id, comp.name, comp.layers, layerId);
}

/** The layer a call means and the page of its properties that fits the byte budget, grouped by parent path, with a cursor for the rest. */
export function inspectLayer(base: ToolBase, snapshot: ProjectSnapshot, args: JsonObject): ToolResult {
  const found = requestedLayer(snapshot, args);
  if ("error" in found) return found;
  const { comp, layer } = found;
  const include = includeModeOf(stringAt(args, "include"));
  const prefix = stringAt(args, "pathPrefix") ?? "";
  const scope = `layer:${comp.id}:${layer.id}:${include}:${prefix}`;
  const offset = cursorOffset(args.cursor, scope, snapshot.fingerprint);
  if (typeof offset !== "number") return offset;
  const all = flatten(layer.properties);
  const selection = selectProperties(all, include, prefix);
  const header = layerPropertyHeader({ layer, comp, include, prefix, all, selection });
  const budget = boundedAt(args, "maxBytes", { fallback: INSPECT_DEFAULT_BUDGET_BYTES, min: INSPECT_MIN_BUDGET_BYTES, max: INSPECT_MAX_BUDGET_BYTES });
  const sizeOf = (property: PropertySnapshot): number => bytes(propertyCell(property, include)) + property.path.length;
  const page = pageByBudget(selection.matched.slice(offset), boundedAt(args, "limit", { fallback: 100, min: 1, max: 500 }), budget - bytes(header) - 512, sizeOf);
  const nextCursor = nextCursorOf({ scope, fingerprint: snapshot.fingerprint, offset, shown: page.items.length, total: selection.matched.length });
  const properties = groupProperties(page.items, all, include);
  return pageResult(base, objectOf({ ...header, properties, propertyOffset: onlyIf(offset > 0, offset), nextCursor: nextCursor ?? undefined }), nextCursor);
}

function includeModeOf(value: string | undefined): string {
  return value === "all" || value === "editable" ? value : "core";
}

function underPrefix(path: string, candidate: string): boolean {
  return path === candidate || path.startsWith(candidate.endsWith("/") ? candidate : `${candidate}/`);
}

function isLayerStyleName(value: string): value is LayerStyleName {
  return Object.hasOwn(LAYER_STYLES, value);
}

function selectProperties(all: PropertySnapshot[], include: string, prefix: string): PropertySelection {
  const omitted: Record<string, number> = {};
  const enabledStylePaths = enabledLayerStyles(all);
  const filter: PropertyFilter = { include, prefix, enabledStylePaths, omitted };
  const matched = all.filter((property) => keepsProperty(property, filter));
  return { matched, omitted, enabledStylePaths };
}

function enabledLayerStyles(all: PropertySnapshot[]): LayerStylePath[] {
  return Object.keys(LAYER_STYLES).filter(isLayerStyleName).map((style) => ({ style, path: layerStylePath(style) })).filter(({ path }) => all.some((property) => property.path === path && property.enabled === true));
}

function keepsProperty(property: PropertySnapshot, filter: PropertyFilter): boolean {
  if (isEnabledStylePath(property, filter) && filter.include === "core") return isEditable(property);
  if (filter.prefix) return keepsPrefixedProperty(property, filter);
  return keepsUnprefixedProperty(property, filter);
}

function isEnabledStylePath(property: PropertySnapshot, filter: PropertyFilter): boolean {
  return !filter.prefix && filter.enabledStylePaths.some(({ path }) => underPrefix(property.path, path));
}

function keepsPrefixedProperty(property: PropertySnapshot, filter: PropertyFilter): boolean {
  if (!underPrefix(property.path, filter.prefix)) return false;
  if (filter.include === "all") return property.kind === "property" || property.path === filter.prefix;
  return isEditable(property);
}

function keepsUnprefixedProperty(property: PropertySnapshot, filter: PropertyFilter): boolean {
  if (filter.include === "all") return property.kind === "property" || property.path === filter.prefix;
  if (!isEditable(property)) return false;
  if (filter.include === "editable") return true;
  return !foldNoise(property, filter);
}

function foldNoise(property: PropertySnapshot, filter: PropertyFilter): boolean {
  const noise = INSPECT_NOISE_PREFIXES.find((candidate) => underPrefix(property.path, candidate));
  if (!noise || keyframeCount(property) !== 0 || property.expressionEnabled === true) return false;
  filter.omitted[noise] = (filter.omitted[noise] ?? 0) + 1;
  return true;
}

function layerPropertyHeader({ layer, comp, include, prefix, all, selection }: LayerHeaderInput): JsonObject {
  return objectOf({
    ...layerIdentity(layer), compositionId: comp.id, include,
    pathPrefix: prefix || undefined,
    totalProperties: all.length, matchedProperties: selection.matched.length,
    omitted: onlyIf(Object.keys(selection.omitted).length > 0, selection.omitted),
    layerStyles: onlyIf(selection.enabledStylePaths.length > 0, selection.enabledStylePaths.map(({ style, path }) => `${style} (${path})`)),
  });
}

function layerIdentity(layer: LayerSnapshot): JsonObject {
  return objectOf({
    id: layer.id, index: layer.index, name: layer.name, type: layer.type,
    enabled: onlyIf(!layer.enabled, false), locked: onlyIf(layer.locked, true), selected: onlyIf(layer.isSelected, true),
    startTime: onlyIf(layer.startTime !== 0, layer.startTime), inPoint: layer.inPoint, outPoint: layer.outPoint, parentId: layer.parentId || undefined,
  });
}

function transformSummary(flat: PropertySnapshot[]): JsonObject {
  return Object.fromEntries(flat.filter((property) => isTransformLeaf(property) && !isDefaultTransformLeaf(property)).map((property) => [property.displayName || property.matchName, clip(property.value)] as const));
}

function isTransformLeaf(property: PropertySnapshot): boolean {
  return property.kind === "property" && property.hidden !== true && property.path.startsWith("ADBE Transform Group/") && property.path.split("/").length === 2;
}

function isDefaultTransformLeaf(property: PropertySnapshot): boolean {
  if (keyframeCount(property) !== 0 || property.expressionEnabled === true) return false;
  return DEFAULT_TRANSFORM.get(property.matchName)?.(property.value) ?? false;
}

function layerSummary(snapshot: ProjectSnapshot, layer: LayerSnapshot): JsonObject {
  const flat = flatten(layer.properties);
  return objectOf({
    ...layerSummaryIdentity(layer),
    ...layerSummaryTiming(layer),
    ...layerSummaryHierarchy(layer),
    ...layerSummarySource(snapshot, layer),
    ...layerSummaryContent(layer, flat),
    propertyCount: flat.length,
    propertiesTruncatedByHost: onlyIf(truncatedByHost(snapshot, layer), true),
  });
}

function layerSummaryIdentity(layer: LayerSnapshot): JsonObject {
  return objectOf({
    id: layer.id, index: layer.index, name: layer.name, type: layer.type,
    enabled: onlyIf(!layer.enabled, false), locked: onlyIf(layer.locked, true), solo: onlyIf(layer.solo, true), shy: onlyIf(layer.shy, true), selected: onlyIf(layer.isSelected, true),
  });
}

function layerSummaryTiming(layer: LayerSnapshot): JsonObject {
  return objectOf({ startTime: onlyIf(layer.startTime !== 0, layer.startTime), inPoint: layer.inPoint, outPoint: layer.outPoint, stretch: onlyIf(layer.stretch !== 100, layer.stretch) });
}

function layerSummaryHierarchy(layer: LayerSnapshot): JsonObject {
  const matted = layer.matteType !== "none";
  return objectOf({ parentId: layer.parentId || undefined, matteType: onlyIf(matted, layer.matteType), matteLayerId: onlyIf(matted, layer.matteLayerId) });
}

function layerSummarySource(snapshot: ProjectSnapshot, layer: LayerSnapshot): JsonObject {
  const interpretation = layer.sourceId ? snapshot.sources?.find((source) => source.id === layer.sourceId)?.interpretation : undefined;
  return objectOf({
    sourceId: layer.sourceId || undefined, compositionSourceId: layer.compositionSourceId || undefined,
    sourceInterpretation: interpretation ? jsonOf(interpretation) : undefined,
  });
}

function layerSummaryContent(layer: LayerSnapshot, flat: PropertySnapshot[]): JsonObject {
  const transform = transformSummary(flat);
  const effects = extractEffects(layer).map((effect) => objectOf({ matchName: effect.matchName, displayName: effect.displayName, enabled: onlyIf(effect.enabled === false, false) }));
  const animated = animatedProperties(flat);
  return objectOf({
    transform: onlyIf(Object.keys(transform).length > 0, transform), effects: onlyIf(effects.length > 0, effects),
    animated: onlyIf(animated.length > 0, animated.slice(0, MAX_ANIMATED_PER_LAYER)), animatedTotal: onlyIf(animated.length > MAX_ANIMATED_PER_LAYER, animated.length),
  });
}

function animatedProperties(flat: PropertySnapshot[]): JsonObject[] {
  return flat.filter((property) => property.kind === "property" && (property.expressionEnabled === true || keyframeCount(property) > 0)).map((property) => objectOf({
    path: property.path, keyframes: onlyIf(keyframeCount(property) > 0, keyframeCount(property)), expression: onlyIf(property.expressionEnabled, true),
  }));
}

function truncatedByHost(snapshot: ProjectSnapshot, layer: LayerSnapshot): boolean {
  return (snapshot.warnings ?? []).some((warning) => warning === `property-count-limit:${layer.name}` || warning === `property-depth-limit:${layer.name}`);
}

function propertyCell(property: PropertySnapshot, include: string): JsonValue {
  const extra = propertyExtras(property, include);
  return Object.keys(extra).length ? { value: clip(property.value), ...extra } : clip(property.value);
}

function propertyExtras(property: PropertySnapshot, include: string): JsonObject {
  return objectOf({
    name: onlyIf(!selfDescribing(property), property.displayName),
    type: onlyIf(!IMPLICIT_TYPES.has(property.valueType), property.valueType),
    keyframes: onlyIf(keyframeCount(property) > 0, keyframeCount(property)),
    readOnly: onlyIf(include === "all" && !property.canSetValue, true),
    hidden: onlyIf(property.hidden, true),
    static: onlyIf(property.animatable === false, true),
    opaque: onlyIf(opaqueControl(property), OPAQUE_NOTE),
    expression: expressionText(property),
  });
}

function opaqueControl(property: PropertySnapshot): boolean {
  return OPAQUE_TYPES.has(property.valueType) && property.path.startsWith("ADBE Effect Parade/");
}

function expressionText(property: PropertySnapshot): string | undefined {
  if (property.expressionEnabled !== true || typeof property.expression !== "string") return undefined;
  const expression = property.expression;
  return expression.length > MAX_EXPRESSION_CHARS ? `${expression.slice(0, MAX_EXPRESSION_CHARS)}…` : expression;
}

function selfDescribing(property: PropertySnapshot): boolean {
  const name = normalized(property.displayName);
  return !name || normalized(property.matchName).includes(name);
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function groupProperties(rows: PropertySnapshot[], all: PropertySnapshot[], include: string): JsonObject {
  const owners = new Map(all.map((property) => [property.path, property]));
  const groups = new Map<string, Map<string, JsonValue>>();
  for (const property of rows) {
    const cut = property.path.lastIndexOf("/");
    const group = property.path.slice(0, Math.max(cut, 0));
    const members = groups.get(group) ?? groupOf(owners.get(group));
    members.set(property.path.slice(cut + 1), propertyCell(property, include));
    groups.set(group, members);
  }
  return Object.fromEntries([...groups].map(([group, members]) => [group, Object.fromEntries(members)] as const));
}

function groupOf(owner: PropertySnapshot | undefined): Map<string, JsonValue> {
  const members = new Map<string, JsonValue>();
  const off = owner?.enabled === false;
  if (owner && (!selfDescribing(owner) || off)) members.set("@", `${owner.displayName}${off ? " (off)" : ""}`);
  return members;
}

function isEditable(property: PropertySnapshot): boolean {
  return property.kind === "property" && property.hidden !== true && (property.canSetValue || property.expressionEnabled === true || keyframeCount(property) > 0);
}

function keyframeCount(property: PropertySnapshot): number {
  return property.keyframeCount ?? property.keyframes?.length ?? 0;
}

function flatten(properties: readonly PropertySnapshot[]): PropertySnapshot[] {
  return properties.flatMap((property) => [property, ...flatten(property.children ?? [])]);
}

function clip(value: JsonValue): JsonValue {
  if (typeof value === "string" && value.length > MAX_STRING_CHARS) return `${value.slice(0, MAX_STRING_CHARS)}…`;
  if (isJsonArray(value) && value.length > MAX_ARRAY_ITEMS) return [...value.slice(0, MAX_ARRAY_ITEMS), "…"];
  return value;
}

/** The leading items that fit the limit and the byte budget; the first item is always kept so a page is never empty. */
export function pageByBudget<T>(items: readonly T[], limit: number, budget: number, sizeOf: (item: T) => number = bytes): { items: T[] } {
  const page: T[] = [];
  let used = 2;
  for (const item of items) {
    if (page.length >= limit) break;
    const size = sizeOf(item) + 1;
    if (page.length > 0 && used + size > budget) break;
    page.push(item);
    used += size;
  }
  return { items: page };
}

function cursorOffset(raw: JsonValue | undefined, scope: string, fingerprint: string): number | ToolFailure {
  if (raw === undefined || raw === null || raw === "") return 0;
  const cursor = decodeCursor(String(raw));
  if (!cursor || cursor.scope !== scope) return toolError("INVALID_CURSOR", "Cursor does not belong to this inspection request.");
  if (cursor.fingerprint !== fingerprint) return toolError("STALE_CURSOR", "The project snapshot changed; restart inspection without a cursor.");
  return cursor.offset;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(raw: string): Cursor | null {
  const decoded = decodeJson(Buffer.from(raw, "base64url").toString("utf8"), jsonObject);
  const value = decoded.ok ? decoded.value : undefined;
  const scope = stringAt(value, "scope");
  const fingerprint = stringAt(value, "fingerprint");
  const offset = integerAt(value, "offset");
  if (scope === undefined || fingerprint === undefined || offset === undefined || offset < 0) return null;
  return { scope, fingerprint, offset };
}

function bytes<T>(value: T): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}
