// Substitutes for a typeface the host does not have: only installed families, ranked by the look a request describes, and the real face of the style asked for.
import type { Candidate } from "./candidate-search.js";
import { NO_MATCH } from "./candidate-search.js";
import type { FontRecord } from "./font-choice.js";
import { lookFit, meetsClasses, readLooks, tagsOf } from "./resolution-font-looks.js";
import { FAMILY_TAGS } from "./resolution-font-tags.js";
import { STYLE_WORDS } from "./resolution-font-names.js";
import { pickFont } from "./resolution-fonts.js";
import { clausesOf, wordsOf } from "./resolution-text.js";

const SUBSTITUTE_LIMIT = 4;

const FIT_FLOOR = 0.3;

const NEUTRAL_LOOK = "neutral sans";

const MIN_NAME_CHARS = 3;

const STYLE_CUE: ReadonlySet<string> = new Set([...STYLE_WORDS, "italics", "bolder"]);

const NAME_STOP: ReadonlySet<string> = new Set((
  "a an the this that these my our your its it them all every each any new same some one " +
  "use uses used make set with using in is are be should must can will would looks look stay keep has have " +
  "font fonts typeface typefaces typography title titles text heading headline subtitle caption body label layer layers line lines word words " +
  "size weight color colour case style spacing tracking leading kerning front back top bottom left right center middle white red blue green yellow gold outline shadow stroke glow " +
  "name named called"
).split(" "));

const NAMED_FONT_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:in|with|using)\s+(?:the\s+)?([A-Za-z][\w-]*(?:\s+[A-Za-z][\w-]*)?)\s+(?:bold|bolder|italics?|oblique|regular|semibold|extrabold|black|light|medium|thin|heavy|demi)\b/iu,
  /\b([A-Za-z][\w-]*(?:\s+[A-Za-z][\w-]*)?)\s+(?:font|typeface)\b/iu,
];

const NON_OUTLINE_TECHNOLOGY = /bitmap/iu;

const BOLD_STYLE = /bold|black|heavy|semibold|demi/iu;

const ITALIC_STYLE = /italic|oblique/iu;

const FONT_CUE = /\b(?:fonts?|typefaces?|typography)\b/iu;

interface StyleAsk {
  readonly bold: boolean;
  readonly italic: boolean;
}

interface Face {
  readonly record: FontRecord;
  readonly exact: boolean;
}

interface NamedFont extends StyleAsk {
  readonly name: string;
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function familyCandidate(family: string): Candidate {
  return { key: family, names: [family], group: "font family", title: family };
}

function installedFamilies(installed: ReadonlyArray<FontRecord>): ReadonlyArray<string> {
  return [...new Set(installed.map((record) => record.family).filter((family) => family !== ""))];
}

function isOutline(record: FontRecord): boolean {
  return record.technology === undefined || !NON_OUTLINE_TECHNOLOGY.test(record.technology);
}

function outlineFamilies(installed: ReadonlyArray<FontRecord>): ReadonlyArray<string> {
  return installedFamilies(installed.filter(isOutline));
}

function namedFamilyLook(phrase: string): string | undefined {
  const tags = FAMILY_TAGS.get(phrase.trim().toLowerCase()) ?? FAMILY_TAGS.get(cleanName(phrase).toLowerCase());
  return tags?.join(" ");
}

function lookOf(phrase: string): string {
  const named = namedFamilyLook(phrase);
  if (named !== undefined) return named;
  const looks = wordsOf(phrase.toLowerCase()).filter((word) => !STYLE_CUE.has(word)).join(" ");
  return readLooks(clausesOf(looks)).total === 0 ? NEUTRAL_LOOK : looks;
}

function rankFamilies(look: string, installed: ReadonlyArray<FontRecord>): string[] {
  const demand = readLooks(clausesOf(look));
  return outlineFamilies(installed)
    .map((family) => ({ family, tags: tagsOf(familyCandidate(family)) }))
    .map((row) => ({ family: row.family, fit: lookFit(demand, row.tags), inClass: meetsClasses(demand, row.tags) }))
    .filter((row) => row.fit >= FIT_FLOOR && row.inClass)
    .sort((left, right) => right.fit - left.fit || compareText(left.family, right.family))
    .slice(0, SUBSTITUTE_LIMIT)
    .map((row) => row.family);
}

/** The installed families whose style tags best fit the look a phrase describes, best first. A family the host reports as bitmap, raster or symbol only is never offered. A family outside a class the look names (a serif for a serif or didone) is not offered. A known typeface whose look no installed family fits gets the neutral sans, as a phrase with no look does. Only installed families are ever returned. */
export function substituteFamilies(phrase: string, installed: ReadonlyArray<FontRecord>): string[] {
  const ranked = rankFamilies(lookOf(phrase), installed);
  return ranked.length > 0 || namedFamilyLook(phrase) === undefined ? ranked : rankFamilies(NEUTRAL_LOOK, installed);
}

/** The bold and italic a text asks for. */
export function styleAskedIn(text: string): StyleAsk {
  return { bold: /\bbold/iu.test(text), italic: /\bitalic|\boblique/iu.test(text) };
}

function styleScore(style: string, ask: StyleAsk): number {
  return (BOLD_STYLE.test(style) === ask.bold ? 2 : 0) + (ITALIC_STYLE.test(style) === ask.italic ? 1 : 0);
}

/** The face of a family that best matches the bold and italic asked for, a real style before any substitute; undefined when the family has no listed face. */
export function faceFor(installed: ReadonlyArray<FontRecord>, family: string, ask: StyleAsk): Face | undefined {
  const faces = installed.filter((record) => record.family === family);
  let best: FontRecord | undefined;
  let bestScore = -1;
  for (const face of faces) {
    const score = styleScore(face.style, ask);
    if (score > bestScore) {
      best = face;
      bestScore = score;
    }
  }
  if (best === undefined) return undefined;
  return { record: best, exact: BOLD_STYLE.test(best.style) === ask.bold && ITALIC_STYLE.test(best.style) === ask.italic };
}

function cleanName(raw: string): string {
  return raw.split(/\s+/).filter((word) => !STYLE_CUE.has(word.toLowerCase()) && !NAME_STOP.has(word.toLowerCase())).join(" ");
}

function namedFontOf(request: string): NamedFont | undefined {
  for (const pattern of NAMED_FONT_PATTERNS) {
    const name = cleanName(pattern.exec(request)?.[1] ?? "");
    if (name.length >= MIN_NAME_CHARS) return { name, ...styleAskedIn(request) };
  }
  return undefined;
}

/** The named typeface of a request when the installed families do not hold it, else undefined. Whether that is certain depends on the census, which the caller checks. */
export function missingNamedFont(request: string, installed: ReadonlyArray<FontRecord>): NamedFont | undefined {
  const named = namedFontOf(request);
  if (named === undefined) return undefined;
  const key = pickFont(named.name, installedFamilies(installed).map(familyCandidate));
  return key === NO_MATCH ? named : undefined;
}

/** The look tags a typeface table row gives a family name, as one phrase (empty when the tables do not know the name). */
export function familyLook(name: string): string {
  return (FAMILY_TAGS.get(name.toLowerCase()) ?? []).join(" ");
}

/** The families the typeface tables know that a question names, lower case, whole words only, and only when the question is about a font at all. */
export function hasFontCue(text: string): boolean {
  return FONT_CUE.test(text);
}

export function knownFamiliesNamedIn(text: string): ReadonlyArray<string> {
  if (!hasFontCue(text)) return [];
  const spaced = ` ${text.toLowerCase().replace(/[^a-z0-9]+/gu, " ")} `;
  return [...FAMILY_TAGS.keys()].filter((name) => spaced.includes(` ${name} `));
}
