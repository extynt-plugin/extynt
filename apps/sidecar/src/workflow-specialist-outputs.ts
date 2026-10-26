// Specialist replies that are not the design brief: the planner's checklist, the reviewer's verdict, the expression writer's rows and the layout they are written against.

import { array, decode, decodeModelJson, type Decoder, type JsonValue, jsonValue, literal, map, number, object, optional, string, union } from "@extynt/decode";
import type { CompositionSnapshot, LayerSnapshot, PropertySnapshot } from "@extynt/project-graph";
import { parseChecklistItems, type ChecklistItem } from "./server-workflow-checklist.js";

/** The planner's system prompt: it turns a whole brief into a compact checklist of build and review items. */
export const PLANNER_RULES = "You plan a long After Effects job before anyone builds it. You get the user's whole brief. Return only one JSON object: {\"items\":[{\"id\":\"bar-07\",\"title\":\"...\",\"spec\":\"...\",\"kind\":\"build\"|\"review\",\"covers\":[\"...\"]}]}. One build item for every section, shot or deliverable the brief names, in the brief's order; ids are short slugs (letters, digits, - _ .); title is at most 40 characters. spec is one contiguous passage of the brief copied word for word (never reworded or summarised), at most 400 characters, and the specs together must include every sentence of the brief; you MUST NOT invent a value the brief does not give. Keep the whole plan compact. At the end of each section add one review item (kind review, covers = that section's build item ids, a title like \"Review: intro\"), about 3 to 6 reviews in all and never more than one per 5 build items. Cover the whole brief; at most 120 items.";
/** The reviewer's system prompt: it judges rendered frames against the specs of the items just built. */
export const REVIEWER_RULES = "You review frames of an After Effects composition against the specs of the items just built. You get 2 to 4 rendered frames, each labelled with its time, the specs of the covered items by id, and a summary of the latest receipts. Return only one JSON object: {\"verdict\":\"pass\"|\"fix\",\"fixes\":[{\"itemId\":\"...\",\"problem\":\"what the frames show\",\"expected\":\"what the spec says\"}]}. Say fix only when a frame clearly contradicts a value in a spec (a wrong colour, text, position, size, or something missing or overlapping); you MUST judge only what the frames can show, and pass when you cannot tell. itemId is one of the covered item ids. At most 6 fixes.";
/** The expression specialist's system prompt: it writes expressions against the composition's real layout. */
export const EXPRESSION_RULES = "You write After Effects expressions. You get the instruction and the real layout of the composition: its name, duration, frame rate, its layers (index, name, type, parent) and its comp and layer markers (time, comment). Return only one JSON object: {\"expressions\":[{\"layer\":\"exact layer name\",\"property\":\"e.g. Transform > Opacity or an effect control\",\"expression\":\"the expression text\",\"note\":\"one short line on what it does\"}]}. You MUST use only layer names and marker indexes that exist in the given layout; refer to a layer with thisComp.layer(\"exact name\"). Prefer marker lookups by comment (marker.key(\"comment\") on the marker you mean) over numeric marker indexes (marker.key(7) fails when that marker does not exist). Keep each expression self-contained and valid for After Effects' JavaScript engine.";

const PLANNER_MAX_ITEMS = 120;
const BUILDS_PER_REVIEW = 5;

type PlannerParse = { readonly ok: true; readonly items: ChecklistItem[]; readonly droppedReviews: number } | { readonly ok: false; readonly error: string };

const plannerReply: Decoder<{ readonly items?: JsonValue }> = object({ items: optional(jsonValue) });

function withoutCovers(item: ChecklistItem): ChecklistItem {
  const { covers: _covers, ...rest } = item;
  return rest;
}

function cleanedCovers(items: readonly ChecklistItem[], buildIds: ReadonlySet<string>): ChecklistItem[] {
  return items.map((item) => item.kind === "review" ? { ...item, covers: (item.covers ?? []).filter((id) => buildIds.has(id)) } : withoutCovers(item));
}

function droppedReviewIds(cleaned: readonly ChecklistItem[], buildCount: number): ReadonlySet<string> {
  const reviews = cleaned.filter((item) => item.kind === "review");
  const allowed = Math.max(1, Math.floor(buildCount / BUILDS_PER_REVIEW));
  const coveringNone = reviews.filter((item) => !item.covers?.length);
  const surplus = reviews.filter((item) => item.covers?.length).slice(allowed);
  return new Set([...coveringNone, ...surplus].map((item) => item.id));
}

/**
 * The planner's items, validated: unique slug ids and at most 120. A slip in covers never costs the whole plan: a build item's covers are dropped, a review keeps only
 * the build ids it names, and a review left covering none is dropped. No more reviews than one per 5 builds are kept (the surplus, latest first, is dropped).
 */
export function parsePlannerOutput(text: string): PlannerParse {
  const decoded = decodeModelJson(text, plannerReply);
  const reply = decoded.ok ? decoded.value : undefined;
  if (!reply) return { ok: false, error: "the planner's reply held no JSON object" };
  const parsed = parseChecklistItems(reply.items, true);
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const builds = parsed.items.filter((item) => item.kind !== "review");
  if (parsed.items.length > PLANNER_MAX_ITEMS) return { ok: false, error: `the planner returned ${parsed.items.length} items; the limit is ${PLANNER_MAX_ITEMS}` };
  if (!builds.length) return { ok: false, error: "the planner returned no build item" };
  const cleaned = cleanedCovers(parsed.items, new Set(builds.map((item) => item.id)));
  const dropped = droppedReviewIds(cleaned, builds.length);
  return { ok: true, items: cleaned.filter((item) => !dropped.has(item.id)), droppedReviews: dropped.size };
}

/** One problem the reviewer found: the covered item, what the frames show and what the spec says. */
export type ReviewFix = { readonly itemId: string; readonly problem: string; readonly expected: string };

type ReviewerParse = { readonly ok: true; readonly verdict: "pass" | "fix"; readonly fixes: ReviewFix[] } | { readonly ok: false; readonly error: string };

const MAX_FIXES = 6;
const MAX_FIX_TEXT = 240;
const NO_FIX: RawFix = { itemId: "", problem: "", expected: "" };

type RawFix = { readonly itemId: string; readonly problem: string; readonly expected: string };

const fixCell: Decoder<string> = union(map(string(), (text) => text.trim().replace(/\s+/g, " ").slice(0, MAX_FIX_TEXT)), map(jsonValue, () => ""));
const rawFix: Decoder<RawFix> = union(
  map(object({ itemId: optional(fixCell), problem: optional(fixCell), expected: optional(fixCell) }), (row): RawFix => ({ itemId: (row.itemId ?? "").toLowerCase(), problem: row.problem ?? "", expected: row.expected ?? "" })),
  map(jsonValue, () => NO_FIX),
);
const rawFixes: Decoder<readonly RawFix[]> = union(array(rawFix), map(jsonValue, (): readonly RawFix[] => []));
const reviewerReply: Decoder<{ readonly verdict: "pass" | "fix"; readonly fixes?: readonly RawFix[] }> = object({ verdict: literal("pass", "fix"), fixes: optional(rawFixes) });

function usableFixes(rows: readonly RawFix[], coveredIds: readonly string[]): ReviewFix[] {
  return rows.filter((row) => coveredIds.includes(row.itemId) && row.problem).slice(0, MAX_FIXES);
}

/** The reviewer's verdict. A fix names a covered item and says what is wrong and what was expected, at most 6 are kept; a "fix" with none usable is not a verdict. */
export function parseReviewerOutput(text: string, coveredIds: readonly string[]): ReviewerParse {
  const decoded = decodeModelJson(text, reviewerReply);
  const reply = decoded.ok ? decoded.value : undefined;
  if (!reply) return { ok: false, error: "the reviewer's reply held no pass or fix verdict" };
  if (reply.verdict === "pass") return { ok: true, verdict: "pass", fixes: [] };
  const fixes = usableFixes(reply.fixes ?? [], coveredIds);
  return fixes.length ? { ok: true, verdict: "fix", fixes } : { ok: false, error: "the reviewer said fix but named no usable fix for a covered item" };
}

/** The fixes as the owner reads them. */
export function fixesText(fixes: readonly ReviewFix[]): string {
  return fixes.map((fix) => `- ${fix.itemId}: ${fix.problem}${fix.expected ? ` (expected: ${fix.expected})` : ""}`).join("\n");
}

type ExpressionRow = { readonly layer: string; readonly property: string; readonly expression: string; readonly note: string };

type ExpressionParse = { readonly ok: true; readonly expressions: ExpressionRow[] } | { readonly ok: false; readonly error: string };

const MAX_EXPRESSIONS = 24;

function cell(max: number): Decoder<string> {
  return union(map(string(), (text) => text.trim().slice(0, max)), map(jsonValue, () => ""));
}

const rawExpression: Decoder<Partial<ExpressionRow>> = union(
  object({ layer: optional(cell(200)), property: optional(cell(200)), expression: optional(cell(4_000)), note: optional(cell(240)) }),
  map(jsonValue, (): Partial<ExpressionRow> => ({})),
);
const expressionReply: Decoder<{ readonly expressions: readonly Partial<ExpressionRow>[] }> = object({ expressions: array(rawExpression) });

function completeRow(row: Partial<ExpressionRow>): ExpressionRow[] {
  const { layer, property, expression } = row;
  return layer && property && expression ? [{ layer, property, expression, note: row.note ?? "" }] : [];
}

/** The expression specialist's rows (at most 24): layer, property and expression text are required; the note is optional. */
export function parseExpressionOutput(text: string): ExpressionParse {
  const decoded = decodeModelJson(text, expressionReply);
  const reply = decoded.ok ? decoded.value : undefined;
  if (!reply) return { ok: false, error: "the reply held no expressions list" };
  const rows = reply.expressions.slice(0, MAX_EXPRESSIONS).flatMap(completeRow);
  return rows.length ? { ok: true, expressions: rows } : { ok: false, error: "no expression row had a layer, a property and an expression" };
}

/** The layout an expression is written against is capped at about this many characters. */
export const EXPRESSION_LAYOUT_CHARS = 4_000;
const MARKER_COMMENT_CHARS = 60;

type MarkerRow = { readonly time: number; readonly comment: string };
type RawMarker = { readonly time: number; readonly comment?: string };

const markerComment: Decoder<string> = union(string(), map(jsonValue, () => ""));
const rawMarker: Decoder<RawMarker | undefined> = union(object({ time: number(), comment: optional(markerComment) }), map(jsonValue, (): undefined => undefined));
const markerValue: Decoder<readonly (RawMarker | undefined)[]> = map(object({ markers: array(rawMarker) }), (value) => value.markers);
const keyframeComment: Decoder<string> = union(string(), map(object({ comment: string() }), (value) => value.comment));

function markerRows(rows: readonly (RawMarker | undefined)[]): MarkerRow[] {
  return rows.flatMap((row) => row ? [{ time: Math.round(row.time * 1000) / 1000, comment: (row.comment ?? "").trim().slice(0, MARKER_COMMENT_CHARS) }] : []);
}

function findMarkerProperty(properties: readonly PropertySnapshot[] | undefined): PropertySnapshot | undefined {
  for (const property of properties ?? []) {
    if (property.matchName === "ADBE Marker") return property;
    const nested = findMarkerProperty(property.children);
    if (nested) return nested;
  }
  return undefined;
}

function keyframeMarkers(property: PropertySnapshot | undefined): MarkerRow[] {
  const rows = (property?.keyframes ?? []).map((key): RawMarker => {
    const comment = decode(keyframeComment, key.value);
    return comment.ok ? { time: key.time, comment: comment.value } : { time: key.time };
  });
  return markerRows(rows);
}

function layerMarkers(layer: LayerSnapshot): MarkerRow[] {
  const property = findMarkerProperty(layer.properties);
  const stored = decode(markerValue, property?.value);
  return stored.ok ? markerRows(stored.value) : keyframeMarkers(property);
}

/** The composition and layer facts an expression is written against, with the markers each carries; `truncated` says the layout was cut to fit its cap. */
export type ExpressionLayout = {
  readonly composition: { readonly name: string; readonly duration: number; readonly frameRate: number };
  readonly layers: ReadonlyArray<{ readonly index: number; readonly name: string; readonly type: string; readonly parent?: string }>;
  readonly compMarkers: readonly MarkerRow[];
  readonly layerMarkers: Readonly<Record<string, readonly MarkerRow[]>>;
  readonly truncated?: true;
};

type LayoutParts = {
  readonly composition: CompositionSnapshot;
  readonly layers: ExpressionLayout["layers"];
  readonly compMarkers: readonly MarkerRow[];
  readonly perLayer: ReadonlyArray<readonly [string, readonly MarkerRow[]]>;
};

function layoutParts(composition: CompositionSnapshot): LayoutParts {
  const names = new Map(composition.layers.map((layer) => [layer.id, layer.name]));
  const layers = composition.layers.map((layer) => {
    const parent = layer.parentId ? names.get(layer.parentId) : undefined;
    return { index: layer.index, name: layer.name, type: layer.type, ...(parent === undefined ? {} : { parent }) };
  });
  const perLayer = composition.layers.map((layer) => [layer.name, layerMarkers(layer)] as const).filter(([, rows]) => rows.length);
  return { composition, layers, compMarkers: markerRows(composition.markers?.markers ?? []), perLayer };
}

function layoutWithin(parts: LayoutParts, layerLimit: number, markerLimit: number): ExpressionLayout {
  const { composition, layers, compMarkers, perLayer } = parts;
  const cut = layerLimit < layers.length || compMarkers.length > markerLimit || perLayer.some(([, rows]) => rows.length > markerLimit);
  return {
    composition: { name: composition.name, duration: composition.duration, frameRate: composition.frameRate },
    layers: layers.slice(0, layerLimit),
    compMarkers: compMarkers.slice(0, markerLimit),
    layerMarkers: Object.fromEntries(perLayer.map(([name, rows]) => [name, rows.slice(0, markerLimit)])),
    ...(cut ? { truncated: true as const } : {}),
  };
}

const LAYER_LIMITS = [Infinity, 60, 40, 25, 15, 8];
const MARKER_LIMITS = [Infinity, 40, 20, 10, 5, 2, 0];

/** The comp's real layout for the expression specialist, cut (markers first, then layers) until it fits the cap in characters. */
export function expressionLayout(composition: CompositionSnapshot, cap = EXPRESSION_LAYOUT_CHARS): ExpressionLayout {
  const parts = layoutParts(composition);
  for (const [layerLimit, markerLimit] of LAYER_LIMITS.flatMap((layers) => MARKER_LIMITS.map((markers) => [layers, markers] as const))) {
    const layout = layoutWithin(parts, layerLimit, markerLimit);
    if (JSON.stringify(layout).length <= cap) return layout;
  }
  return layoutWithin(parts, 3, 0);
}
