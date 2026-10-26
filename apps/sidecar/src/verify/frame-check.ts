// Frame placement: what the host measured of each layer a plan placed, judged against the composition's frame, and the receipt rows and model-facing sentences that come of it.
import { boolean, decode, fallback, literal, map, number, object, optional, skippingInvalid, string, tuple, union } from "@extynt/decode";
import type { Decoder, Infer } from "@extynt/decode";
import type { Opaque } from "../snapshot-view.js";

type FrameVerdict = "IN_FRAME" | "OFF_FRAME" | "CLIPPED";
type FrameBox = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };
type FramePoint = readonly [number, number];

/** One receipt row per checked layer. A finding (OFF_FRAME or CLIPPED) carries the settled sample's time and box and the sentence the model is told. An IN_FRAME row may carry an edge note: the layer is cut by or touches the frame edge at a moment of its motion, though it is inside at rest. The note is advisory and never a finding. */
export interface FrameCheckRow {
  readonly compositionId: string;
  readonly layerId: string;
  readonly layer: string;
  readonly verdict: FrameVerdict;
  readonly time?: number;
  readonly box?: FrameBox;
  readonly parent?: { readonly name: string; readonly world: FramePoint | null };
  readonly suggestedPosition?: FramePoint;
  readonly message?: string;
  readonly edge?: string;
}

const CLIPPED_BELOW = 0.5;
const TEXT_CLIPPED_BELOW = 0.98;
const TOUCH_PIXELS = 2;
const ROW_LIMIT = 32;
const SAMPLE_LIMIT = 4;

const clipped = (limit: number): Decoder<string> => map(string(), (text) => text.slice(0, limit));
const pairOfNumbers = tuple(number(), number());
const cornersOfBox = tuple(number(), number(), number(), number());

const hostSample = object({ kind: fallback(clipped(16), ""), time: number(), active: boolean(), box: fallback(cornersOfBox, null) });
const hostParent = object({ name: clipped(120), world: fallback(pairOfNumbers, null) });
const hostFrameCheck = object({
  compositionId: clipped(64),
  layerId: clipped(64),
  name: clipped(120),
  width: number(),
  height: number(),
  samples: skippingInvalid(hostSample, SAMPLE_LIMIT),
  position: fallback(pairOfNumbers, null),
  shift: fallback(pairOfNumbers, null),
  parent: fallback(hostParent, null),
  text: fallback(literal(true), false),
});

/** The layers a plan placed, as the host measured them: a malformed row or sample is dropped, never guessed at, and only the first rows and samples are read. */
export const hostFrameChecks: Decoder<ReadonlyArray<HostFrameCheck>> = skippingInvalid(hostFrameCheck, ROW_LIMIT);

/** What the host measured of one layer a plan placed: its comp-space box at several times, and the position and shift that would centre it. */
export type HostFrameCheck = Infer<typeof hostFrameCheck>;
type HostFrameSample = HostFrameCheck["samples"][number];
type DrawnBox = NonNullable<HostFrameSample["box"]>;

const storedBox = object({ left: number(), top: number(), right: number(), bottom: number() });
const storedParent = object({ name: clipped(120), world: fallback(pairOfNumbers, null) });
const storedVerdict = union(literal("IN_FRAME"), literal("OFF_FRAME"), literal("CLIPPED"));
const storedFields = object({
  compositionId: clipped(64),
  layerId: clipped(64),
  layer: clipped(120),
  verdict: storedVerdict,
  time: optional(fallback(number(), undefined)),
  box: optional(fallback(storedBox, undefined)),
  parent: optional(fallback(storedParent, undefined)),
  suggestedPosition: optional(fallback(pairOfNumbers, undefined)),
  message: optional(fallback(clipped(600), undefined)),
  edge: optional(fallback(clipped(600), undefined)),
});

function storedRow(fields: Infer<typeof storedFields>): FrameCheckRow {
  const { time, box, parent, suggestedPosition, message, edge, ...identity } = fields;
  return {
    ...identity,
    ...(time === undefined ? {} : { time }),
    ...(box === undefined ? {} : { box }),
    ...(parent === undefined ? {} : { parent }),
    ...(suggestedPosition === undefined ? {} : { suggestedPosition }),
    ...(message === undefined ? {} : { message }),
    ...(edge === undefined ? {} : { edge }),
  };
}

const storedFrameRows = skippingInvalid(map(storedFields, storedRow), ROW_LIMIT);

const storedFrameChecks: Decoder<ReadonlyArray<FrameCheckRow> | undefined> = fallback(
  map(storedFrameRows, (rows) => (rows.length ? rows : undefined)),
  undefined,
);

const whole = (value: number): number => Math.round(value);
const seconds = (time: number): string => `${Math.round(time * 100) / 100} s`;
const point = (value: FramePoint): string => `${whole(value[0])},${whole(value[1])}`;
const tenth = (value: number): number => Math.round(value * 10) / 10;

function meets(a0: number, a1: number, b0: number, b1: number): boolean {
  return a1 > a0 ? a1 > b0 && a0 < b1 : a0 >= b0 && a0 <= b1;
}

function insideShare(box: DrawnBox | null, width: number, height: number): number {
  if (!box) return 1;
  const [left, top, right, bottom] = box;
  const area = (right - left) * (bottom - top);
  if (area <= 0) return 1;
  const overlap = Math.max(0, Math.min(right, width) - Math.max(left, 0)) * Math.max(0, Math.min(bottom, height) - Math.max(top, 0));
  return overlap / area;
}

/** One sample against the frame. A backdrop larger than the frame is never clipped, however little of it shows; a text box is clipped by any real cut. */
export function judgeSample(box: DrawnBox, width: number, height: number, text = false): FrameVerdict {
  const [left, top, right, bottom] = box;
  if (!meets(left, right, 0, width) || !meets(top, bottom, 0, height)) return "OFF_FRAME";
  if (text) return insideShare(box, width, height) < TEXT_CLIPPED_BELOW ? "CLIPPED" : "IN_FRAME";
  const smaller = (right - left) * (bottom - top) < width * height;
  return smaller && insideShare(box, width, height) < CLIPPED_BELOW ? "CLIPPED" : "IN_FRAME";
}

interface Judged {
  readonly time: number;
  readonly box: DrawnBox;
  readonly verdict: FrameVerdict;
}

function judgedSamples(check: HostFrameCheck): Judged[] {
  return check.samples.flatMap((sample): Judged[] => (sample.active && sample.box ? [{ time: sample.time, box: sample.box, verdict: judgeSample(sample.box, check.width, check.height, check.text) }] : []));
}

function roundedBox(box: DrawnBox): FrameBox {
  return { left: tenth(box[0]), top: tenth(box[1]), right: tenth(box[2]), bottom: tenth(box[3]) };
}

function suggestedPositionOf(check: HostFrameCheck): FramePoint | null {
  return check.position && check.shift ? [check.position[0] + check.shift[0], check.position[1] + check.shift[1]] : null;
}

interface Finding {
  readonly verdict: FrameVerdict;
  readonly time: number;
  readonly box: FrameBox;
  readonly share: number;
  readonly suggested: FramePoint | null;
}

function textClippedMessage(check: HostFrameCheck, found: Finding, where: string): string {
  const head = `"${check.name}" is cut off by the ${check.width}×${check.height} frame edge at ${seconds(found.time)}: its box spans ${where} (${whole(found.share * 100)}% of it is inside).`;
  const fix = found.suggested ? ` Move it so the whole box is inside, for example Position ≈ (${point(found.suggested)}), or check its paragraph justification.` : " Move it so the whole box is inside the frame.";
  return check.parent ? `${head} It is parented to ${check.parent.name}, so its Position is relative to that layer.${fix}` : `${head}${fix}`;
}

function parentedMessage(head: string, parent: NonNullable<HostFrameCheck["parent"]>, suggested: FramePoint | null): string {
  const world = parent.world ? ` (world ${point(parent.world)})` : "";
  const fix = suggested ? `: to centre it, use Position ≈ (${point(suggested)}).` : ".";
  return `${head} It is parented to ${parent.name}${world}, so its Position, and any Position expression, is relative to that layer rather than the composition${fix}`;
}

function frameMessage(check: HostFrameCheck, found: Finding): string {
  const frame = `${check.width}×${check.height}`;
  const where = `x ${whole(found.box.left)}–${whole(found.box.right)}, y ${whole(found.box.top)}–${whole(found.box.bottom)}`;
  if (check.text && found.verdict === "CLIPPED") return textClippedMessage(check, found, where);
  const state = found.verdict === "OFF_FRAME" ? `outside the ${frame} frame at ${seconds(found.time)}` : `mostly outside the ${frame} frame at ${seconds(found.time)} (${whole(found.share * 100)}% of its box is inside)`;
  const head = `${check.name} is ${state}: its box spans ${where}.`;
  if (check.parent) return parentedMessage(head, check.parent, found.suggested);
  return found.suggested ? `${head} To centre it, use Position ≈ (${point(found.suggested)}).` : head;
}

function findingRow(check: HostFrameCheck, settled: Judged): FrameCheckRow {
  const suggested = suggestedPositionOf(check);
  const found = { verdict: settled.verdict, time: settled.time, box: roundedBox(settled.box), share: insideShare(settled.box, check.width, check.height), suggested };
  return {
    compositionId: check.compositionId,
    layerId: check.layerId,
    layer: check.name,
    verdict: found.verdict,
    time: found.time,
    box: found.box,
    ...(check.parent ? { parent: check.parent } : {}),
    ...(suggested ? { suggestedPosition: [whole(suggested[0]), whole(suggested[1])] as const } : {}),
    message: frameMessage(check, found),
  };
}

function edgeKindOf(check: HostFrameCheck, judged: Judged): "cut" | "touch" | "clear" {
  if (judged.verdict !== "IN_FRAME") return "cut";
  return touchesEdge(judged.box, check.width, check.height) ? "touch" : "clear";
}

function touchesEdge(box: DrawnBox, width: number, height: number): boolean {
  const [left, top, right, bottom] = box;
  if (right - left >= width || bottom - top >= height) return false;
  return left <= TOUCH_PIXELS || top <= TOUCH_PIXELS || right >= width - TOUCH_PIXELS || bottom >= height - TOUCH_PIXELS;
}

function edgeNoteOf(check: HostFrameCheck, judged: ReadonlyArray<Judged>): string | undefined {
  const ordered = [...judged].sort((first, second) => first.time - second.time);
  const rest = ordered[ordered.length - 1];
  const moment = ordered.find((entry) => edgeKindOf(check, entry) !== "clear");
  if (!rest || !moment || edgeKindOf(check, rest) !== "clear") return undefined;
  const cut = edgeKindOf(check, moment) === "cut";
  const frame = `${check.width}×${check.height}`;
  const where = `x ${whole(moment.box[0])}–${whole(moment.box[2])}, y ${whole(moment.box[1])}–${whole(moment.box[3])}`;
  const state = cut ? `is cut by the ${frame} frame edge` : "touches the frame edge";
  return `${check.name} ${state} at ${seconds(moment.time)} while it moves (its box spans ${where}), though it is inside the frame at rest (${seconds(rest.time)}). Check whether that moment should reach the edge.`;
}

/** The finding for one layer, or an IN_FRAME row; null when nothing could be measured while the layer was drawn. Motion passes through the frame edge on the way in or out, so one drawn sample inside the frame clears the layer, and a transient edge contact that the rest does not show is noted, not found. */
export function frameCheckRow(check: HostFrameCheck): FrameCheckRow | null {
  const judged = judgedSamples(check);
  const settled = judged[0];
  if (!settled) return null;
  if (judged.some((entry) => entry.verdict === "IN_FRAME")) {
    const edge = edgeNoteOf(check, judged);
    return { compositionId: check.compositionId, layerId: check.layerId, layer: check.name, verdict: "IN_FRAME", ...(edge === undefined ? {} : { edge }) };
  }
  return findingRow(check, settled);
}

/** The receipt rows for what the host measured; undefined when it measured nothing. */
export function frameCheckRows(hostChecks: ReadonlyArray<HostFrameCheck> | undefined): ReadonlyArray<FrameCheckRow> | undefined {
  const rows = (hostChecks ?? []).flatMap((check) => frameCheckRow(check) ?? []);
  return rows.length ? rows : undefined;
}

/** The stored rows of a receipt read through `storedFrameChecks`; anything that is not a list of valid rows reads as none. */
export function boundedFrameChecks(value: Opaque): FrameCheckRow[] | undefined {
  const decoded = decode(storedFrameChecks, value);
  return decoded.ok && decoded.value ? [...decoded.value] : undefined;
}

/** The standing findings among rows, keyed by layer so a later check of the same layer replaces an earlier one. */
export function standingFindings(rowsInOrder: ReadonlyArray<FrameCheckRow>): FrameCheckRow[] {
  const latest = new Map<string, FrameCheckRow>();
  for (const row of rowsInOrder) latest.set(`${row.compositionId}:${row.layerId}`, row);
  return [...latest.values()].filter((row) => row.verdict !== "IN_FRAME");
}
