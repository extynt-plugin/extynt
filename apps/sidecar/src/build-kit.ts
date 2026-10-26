// The MCP build kit: the panel's up-front material for a request (shapes, schemas, resolved examples, fonts, host failures) as one text in MCP wording; read by the ae_get_build_kit tool.
import type { FontSubstitution, RuntimeOperationEvidence } from "@extynt/mcp-server";
import { fontsAreAuthoritative } from "@extynt/capability-catalogue";
import type { FontInventory, FontRecord } from "@extynt/capability-catalogue";
import { faceFor, missingNamedFont, styleAskedIn, substituteFamilies } from "@extynt/decide";
import { bookedOneOf } from "./decision-book.js";
import { commonOperationShapes, hostFailureLines, operationDisclosure, VALUES_AND_UNITS } from "./agent-briefing.js";
import { requestedOperationTypes } from "./request-coverage.js";
import { recipeBlock } from "./request-recipes.js";
import { SCENE_SVG_RULES } from "./scene-svg-rules.js";

const SAFE_FAMILIES = ["Arial", "Helvetica Neue", "Helvetica", "Segoe UI", "Verdana", "Tahoma"] as const;
const SAFE_RANKS: ReadonlyMap<string, number> = new Map(SAFE_FAMILIES.map((family, rank) => [family.toLowerCase(), rank]));
const REGULAR_STYLES: ReadonlySet<string> = new Set(["regular", "roman", "book", "normal"]);

interface FamilyFaces { first: FontRecord; regular: FontRecord | undefined }

function facesBySafeRank(items: readonly FontRecord[]): Map<number, FamilyFaces> {
  const faces = new Map<number, FamilyFaces>();
  for (const item of items) {
    const rank = SAFE_RANKS.get(item.family.toLowerCase());
    if (rank === undefined) continue;
    const known = faces.get(rank) ?? { first: item, regular: undefined };
    faces.set(rank, { first: known.first, regular: known.regular ?? (REGULAR_STYLES.has(item.style.toLowerCase()) ? item : undefined) });
  }
  return faces;
}

/** The PostScript name of a plain face of the first safe family this host lists, so a build needs no font search; undefined when none is listed. Families that ship with every desktop OS are preferred in order. */
export function safeDefaultFont(fonts: FontInventory | undefined): string | undefined {
  const faces = facesBySafeRank(fonts?.items ?? []);
  const best = faces.get(Math.min(...faces.keys()));
  return best ? (best.regular ?? best.first).postScriptName : undefined;
}

const describeFace = (items: readonly FontRecord[], family: string, request: string): string => {
  const face = faceFor(items, family, styleAskedIn(request));
  if (!face) return family;
  return `"${family}" as ${face.record.postScriptName} (${face.record.style}${face.exact ? "" : "; no exact face for the style asked, so the nearest real style"})`;
};

function requestedFontSubstitution(request: string, fonts: FontInventory | undefined): FontSubstitution | undefined {
  if (!fonts || !fontsAreAuthoritative(fonts)) return undefined;
  const named = missingNamedFont(request, fonts.items);
  return named === undefined ? undefined : { requested: named.name, offered: substituteFamilies(request, fonts.items) };
}

/** Adds to `into` the font the request names that the complete census lacks, with the installed families that stand in for it, best first; nothing when no stand-in fits. */
export function recordFontSubstitution(into: FontSubstitution[], request: string, fonts: FontInventory | undefined): void {
  const substitution = requestedFontSubstitution(request, fonts);
  if (substitution?.offered.length) into.push(substitution);
}

function missingFontLine(request: string, fonts: FontInventory | undefined): string | undefined {
  if (!fonts || !fontsAreAuthoritative(fonts)) return undefined;
  const named = missingNamedFont(request, fonts.items);
  if (named === undefined) return undefined;
  const [best, ...others] = substituteFamilies(request, fonts.items).map((family) => describeFace(fonts.items, family, request));
  const absent = `the request names "${named.name}", which is not installed on this host (its font list is complete, so that is certain)`;
  if (best === undefined) return `Fonts: ${absent}. No installed family fits its look: omit font to keep the layer's default, and say so in your reply. Do not ask the user about it unless they insisted on that exact font.`;
  const alternatives = others.length ? ` Alternatives, all installed: ${others.join("; ")}.` : "";
  return `Fonts: ${absent}. Do not ask the user about it unless they insisted on that exact font. Use the installed substitute ${best}, setting font to its postScriptName so bold and italic stay real styles.${alternatives} Say in your reply which font you used and that "${named.name}" is not installed. Only installed families may be named to the user.`;
}

const fontLine = (fonts: FontInventory | undefined, request: string): string => {
  const missing = missingFontLine(request, fonts);
  if (missing) return missing;
  const safe = safeDefaultFont(fonts);
  return safe
    ? `Fonts: omit font to keep the text layer's default, or use "${safe}" (installed on this host). ae_search_fonts only for a specific typeface the request names.`
    : "Fonts: omit font to keep the text layer's default; ae_search_fonts (one query) only for a specific typeface the request names.";
};

const QUEUES = /\bqueues\b/g;
const QUEUED = /\bqueued\b/g;
const QUEUE = /\bqueue\b/g;

const forPlans = (text: string): string => text.replace(QUEUES, "proposes").replace(QUEUED, "proposed").replace(QUEUE, "plan");

const DRAWN_SCENE = /\b(draw(?:n|ing)?|illustrat\w*|scene|scenery|landscape|skyline|starfield|planets?|rockets?|mascot|logo ?mark|artwork)\b/iu;

/** The answers to what a request asks to have made: a picture to be drawn, or text, shapes and footage to be arranged. */
export const SCENE_LABELS = ["drawn-scene", "arranged-layers"] as const;

type SceneLabel = (typeof SCENE_LABELS)[number];

/** Whether a request asks for a picture to be drawn (a scene, an illustration, a character) rather than text, shapes or footage to be arranged. */
export function decideSceneRequest(input: { request: string }): SceneLabel {
  const booked = bookedOneOf({ decision: "drawn-scene", text: input.request }, SCENE_LABELS);
  if (booked !== undefined) return booked;
  return DRAWN_SCENE.test(input.request) ? "drawn-scene" : "arranged-layers";
}

const sceneBlock = (request: string, compositionId: string): string[] => decideSceneRequest({ request }) === "drawn-scene" ? [
  `Drawn scene: pass the drawing as ae_propose_plan {svg} (not ae_create_vector_artwork) so each part becomes a native shape layer you can animate. Target: compositionId "${compositionId}" (the svg viewBox must match its size) or a create_composition at the viewBox size in operations. Layers are named for the svg group ids; the result's svgScene.layers lists each name with its plan layerId. Animate in later plans, targeting the layers by name.`,
  `SVG rules: ${SCENE_SVG_RULES}`,
  "",
] : [];

const PLAN_SHAPE_NOTE = 'Plan shape: an operation is {type, ...fields}. Layer and item addresses (compositionId, layerId, propertyPath, effectPath; itemId for project items) nest in "target" except where an operation shape shows them at the top level; operations with no target (create_composition, create_folder, import_file...) take every field at the top level. Never write an "action" field — type selects the operation (edit_keyframes alone may state delete|move|scale|copy; otherwise it infers move from offset, scale from factor, copy from source). An unknown field is refused. ae_describe_native_operation (summary) gives one operation\'s input schema and example; pass an array of ids to describe several at once.';

/** What the panel model is given up front for a request, as one text for an MCP client: shared pieces, MCP wording. */
export function buildKit(request: string, compositionId: string, fonts: FontInventory | undefined, evidence?: Readonly<Record<string, RuntimeOperationEvidence>>): string {
  const operations = requestedOperationTypes(request);
  const needed = new Set(operations);
  const failed = hostFailureLines(Object.fromEntries(Object.entries(evidence ?? {}).filter(([type]) => needed.has(type))));
  const lines = [
    ...commonOperationShapes("propose"),
    ...operationDisclosure(operations),
    "",
    VALUES_AND_UNITS,
    "",
    PLAN_SHAPE_NOTE,
    "",
    ...recipeBlock(request, compositionId, "Propose"),
    "",
    ...sceneBlock(request, compositionId),
    fontLine(fonts, request),
    ...(failed.length ? ["Operations this request needs that this host has failed to read back before (prefer a different route, or a narrower write, over repeating one):", ...failed] : []),
    "Build in a few ae_propose_plan {apply:true} stages; before answering call ae_check_request with the user's request.",
  ];
  return forPlans(lines.join("\n"));
}
