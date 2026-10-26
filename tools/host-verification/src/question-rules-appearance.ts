/** Derives the findings for the appearance questions: whether a bare shape path draws, and how colour surfaces quantise. */
import { NO_COLOUR_CASE } from "./question-data.js";
import type { ColourCase, ShapeCase } from "./question-data.js";
import type { Recorded } from "./question-values.js";
import { fmt, hostOutcome, numberOf, sameNumber, str, vector, vectorOf } from "./question-values.js";

type Rect = ShapeCase["rect"];

const censusOf = (groups: ShapeCase["contents"]): string => groups.map((group) => `${group.name ?? "?"} (${group.matchName ?? "?"}; children ${group.children.map((child) => child.matchName ?? "?").join(", ")})`).join(" · ");
const isZeroRect = (entry: ShapeCase): boolean => [entry.rect.top, entry.rect.left, entry.rect.width, entry.rect.height].every((side) => side === 0);

function appendShapeCase(facts: string[], entry: ShapeCase): void {
  const { rect } = entry;
  facts.push(`"${entry.label ?? "?"}": ${hostOutcome(entry.host)}; sourceRectAtTime reads {top:${str(rect.top) ?? "?"}, left:${str(rect.left) ?? "?"}, width:${str(rect.width) ?? "?"}, height:${str(rect.height) ?? "?"}}`);
  facts.push(`  the layer's contents hold ${entry.contents.length} group(s): ${censusOf(entry.contents)}`);
}

const rectText = (rect: Rect): string => `{top:${str(rect.top)}, left:${str(rect.left)}, width:${str(rect.width)}, height:${str(rect.height)}}`;

function shapeBoundsAnswer(emptyRect: Rect, drawnRect: Rect): string[] {
  const centred = sameNumber(drawnRect.left, -(drawnRect.width ?? 0) / 2, 1e-6) && sameNumber(drawnRect.top, -(drawnRect.height ?? 0) / 2, 1e-6);
  return [
    `the answer: a shape group holding a path and no fill or stroke reports EMPTY content bounds (${rectText(emptyRect)}), while the same ellipse with a fill reports the path's bounds (${rectText(drawnRect)}${centred ? ` — a ${str(drawnRect.width)}x${str(drawnRect.height)} path centred on the origin` : ""})`,
    `so "a path with no paint draws nothing" is now measured, not assumed: sourceRectAtTime is the observable that separates the bare path from the painted one, and the only difference the probe made between the two groups is ensure_shape_fill`,
  ];
}

function appendShapeBoundsVerdict(facts: string[], cases: ShapeCase[]): void {
  const empty = cases.filter(isZeroRect), drawn = cases.filter((entry) => !isZeroRect(entry));
  const [firstEmpty] = empty, [firstDrawn] = drawn;
  if (firstEmpty && firstDrawn) facts.push(...shapeBoundsAnswer(firstEmpty.rect, firstDrawn.rect));
  else if (cases.length && !empty.length) facts.push(`every case reported NON-empty bounds, so on this host sourceRectAtTime does not separate a bare path from a painted one — the premise that a path without paint draws nothing is not observable this way`);
  else if (cases.length) facts.push(`every case reported empty bounds, so the fill made no difference this probe can see and the premise is unconfirmed`);
  else facts.push("no shape case was recorded, so this question measured nothing");
}

const matchNameCensus = (entry: ShapeCase): string =>
  JSON.stringify(entry.contents.map((group) => [group.matchName, group.children.map((child) => child.matchName)]));

function appendShapeCensusVerdict(facts: string[], cases: ShapeCase[]): void {
  if (cases.length <= 1) return;
  const censuses = new Set(cases.map(matchNameCensus));
  facts.push(censuses.size === 1
    ? `both groups carry the same contents census (same matchNames, same children), so the fill changed the bounds without changing what the layer holds at group level — the fill lives inside the group's Contents child, which is where a later operation must look for it`
    : `the groups' contents censuses differ, so the two cases are not the same layer shape and the bounds comparison says less than it looks like it does`);
}

/** The findings for the question of whether a shape path with no fill or stroke has bounds. */
export function deriveShapeWithoutPaint(cases: ShapeCase[]): string[] {
  const facts: string[] = [];
  for (const entry of cases) appendShapeCase(facts, entry);
  appendShapeBoundsVerdict(facts, cases);
  appendShapeCensusVerdict(facts, cases);
  return facts;
}

const quantised = (value: number): number => Math.round(value * 255) / 255;

interface CompositionColour { sent: Recorded; readBack: Recorded; writeOutcome: string }

function appendCompositionPrecision(facts: string[], composition: CompositionColour, sent: number[]): boolean {
  const readBack = vectorOf(composition.readBack);
  facts.push(`composition background: ${composition.writeOutcome}; sent ${fmt(composition.sent)} → read back ${fmt(composition.readBack)}`);
  const isEightBit = readBack.length === sent.length && readBack.every((value, index) => sameNumber(value, quantised(sent[index] ?? 0), 1e-9));
  facts.push(isEightBit
    ? `  that is 1/255 quantisation exactly (${sent.map((value) => `${String(value)} → ${String(Math.round(value * 255))}/255`).join(", ")}), so this surface stores 8 bits per channel`
    : `  the read-back is not the 1/255 quantisation of what was sent (which would be ${fmt(sent.map(quantised))})`);
  return isEightBit;
}

const effectControl = (cases: ColourCase[]): ColourCase => cases.find((entry) => entry.readBack !== undefined) ?? cases[cases.length - 1] ?? NO_COLOUR_CASE;

function appendControlPrecision(facts: string[], control: ColourCase, sent: number[], readBack: number[]): boolean {
  const dimensions = numberOf(control.dimensions);
  facts.push(`effect control (${control.label ?? "set_effect_control"}): ${hostOutcome(control.host)}; the same triple reads back ${fmt(control.readBack)} with ${dimensions === null ? "an unreadable number of" : String(dimensions)} component(s)`);
  const isFloat32 = sent.length > 0 && readBack.length >= sent.length && sent.every((value, index) => sameNumber(readBack[index], Math.fround(value), 1e-9));
  facts.push(isFloat32
    ? `  every component is the Float32 rounding of what was sent (${sent.map((value) => `${String(value)} is stored as ${String(Math.fround(value))}`).join(", ")}), NOT 1/255 quantisation — the effect-control surface is Float32`
    : `  the components are not the Float32 roundings of what was sent, so the surface's storage is not settled by this read-back`);
  return isFloat32;
}

function appendControlShapeNotes(facts: string[], control: ColourCase, readBack: number[], sent: number[]): void {
  if (vector(control.eightBitPrediction)) facts.push(`  an 8-bit read-back would have been ${fmt(control.eightBitPrediction)}; the host did not return that`);
  if (readBack.length === 4 && sent.length === 3) facts.push(`  the read-back carries FOUR components where three were written: alpha 1 is appended to the RGB that was sent, while the composition background reads back three`);
}

function appendPrecisionVerdict(facts: string[], compositionIsEightBit: boolean, isFloat32: boolean): void {
  if (compositionIsEightBit && isFloat32) facts.push(`the answer: the two surfaces differ. An effect-control colour is Float32 RGBA — compare it against the Float32 rounding of what was sent and expect the fourth alpha component — while the composition background is 8-bit RGB, where 0.1 becomes 26/255. One tolerance cannot be right for both`);
  else facts.push(`the two surfaces were not both measured as expected, so no single comparison rule follows from this report`);
}

/** The findings for the question of whether an effect-control colour is quantised like a composition background. */
export function deriveEffectColorPrecision(composition: CompositionColour, cases: ColourCase[]): string[] {
  const facts: string[] = [], sent = vectorOf(composition.sent);
  const compositionIsEightBit = appendCompositionPrecision(facts, composition, sent);
  const control = effectControl(cases), readBack = vectorOf(control.readBack);
  const isFloat32 = appendControlPrecision(facts, control, sent, readBack);
  appendControlShapeNotes(facts, control, readBack, sent);
  appendPrecisionVerdict(facts, compositionIsEightBit, isFloat32);
  return facts;
}
