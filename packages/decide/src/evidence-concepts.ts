// Reads a goal clause by clause: quoted names, composition settings and rename targets are set aside, then the concept tables and a few scoped rules say what the clause asks for.
import { AMBIGUOUS_LAYOUT_ENTRY, CONCEPT_ENTRIES, MARKER_ENTRY, MOTION_VERB_ENTRY, PURPOSE_OPENERS, RENAME_ENTRY, SETTINGS_CONTAINER_WORDS, SETTINGS_PHRASES, SIZE_NOUNS, SPATIAL_NOUN_ENTRY } from "./evidence-concept-tables.js";
import type { ConceptEntry, GoalConcept } from "./evidence-concept-tables.js";
import { foldText, hasWord, mentions, oneTypoFrom, wordsOf } from "./evidence-words.js";

type ClauseReading = ReadonlySet<GoalConcept>;

type RawConcept = GoalConcept | "motionVerb" | "ambiguousLayout" | "spatialNoun" | "timeQuantity";

const QUOTED_TEXT = /"[^"]*"|“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』|«[^»]*»|(?:^|\s)'[^']*'(?=\s|$|[.,;:!?])/gu;

const CLAUSE_BREAK = /\s+(?:and|und|y|et|then|dann|also|plus|sowie)\s+|そして|それから/giu;

const AXIS_OR_NUMBER_AHEAD = "(?!\\s*(?:[xyz]\\s*)?[-−]?\\d)";

const REVIEW_CLAUSE_BREAK = new RegExp(`\\s+(?:and|und|y(?! a )|et|then|dann|also|plus|sowie)${AXIS_OR_NUMBER_AHEAD}\\s+|[,;、]${AXIS_OR_NUMBER_AHEAD}\\s*|そして|それから`, "giu");

const NUMBER_WORDS = "one|two|three|four|five|six|seven|eight|nine|ten|eins|zwei|drei|vier|funf|sechs|sieben|acht|neun|zehn|un|une|una|dos|deux|trois|quatre|cinq|sept|huit|neuf|dix|tres|cuatro|cinco|seis|diez";

const TIME_UNITS = "seconds?|secs?|sec|s|sekunden?|segundos?|segs?|secondes?|frames?|fotogramas?|ms|minutes?|minutos?|minuten|min";

const AMOUNT = `(?:\\d+(?: \\d+)?|${NUMBER_WORDS})`;

const TIME_QUANTITY = new RegExp(`(?:^| )${AMOUNT} ?(?:${TIME_UNITS})(?= |$)|[\\d一二三四五六七八九十两半]+(?:秒|フレーム|ミリ秒|帧|毫秒|分钟)`, "u");

const DELAY = new RegExp(`(?:^| )(?:after|nach|despues de|tras|dentro de|apres|dans|later|spater) ${AMOUNT} ?(?:${TIME_UNITS})(?= |$)|[\\d一二三四五六七八九十两半]+秒(?:後|たって|経|后|钟后|之后)`, "u");

const FROM_WORDS: ReadonlyArray<string> = ["from", "von", "desde", "depuis", "から", "从"];

const CHANGE_CONCEPTS: ReadonlyArray<RawConcept> = ["transform", "look", "colour", "layout"];

const MATCH_ROOT = "match";

const MATCH_WINDOW = 4;

const MATCH_OBJECT_ROOTS: ReadonlyArray<string> = ["colo", "reference", "look", "style", "grade", "tone", "palette", "mood", "feel", "comp", "scene", "shot"];

const REFERENCE_NOUN_PARTS: ReadonlyArray<string> = [
  "referenc", "referenz", "vorlage", "mockup", "mock up", "styleframe", "style frame", "moodboard", "mood board", "参考", "参照", "見本", "モックアップ", "スタイルフレーム",
];

const REFERENCE_NOUN_WORDS: ReadonlyArray<string> = ["ref", "refs"];

const SIMILARITY_ROOTS: ReadonlyArray<string> = ["match", "exact", "identic", "copy", "copie", "kopier", "replicat", "nachbild", "nachbau", "duplicat", "similar", "ahnlich", "parecid", "semblable"];

const SIMILARITY_WORDS: ReadonlyArray<string> = ["like", "wie", "como", "comme", "same", "gleich", "gleiche", "igual", "identique", "identisch", "mismo", "misma"];

const SIMILARITY_PARTS: ReadonlyArray<string> = ["のように", "通り", "同じ", "合わせ", "真似", "に合わ", "と同じ"];

const POLITE_TAILS = /\b(?:thanks(?: a lot| so much)?|thank you|please|pls|plz|porfa|por favor|gracias|merci(?: beaucoup)?|s'il vous plait|bitte|danke|s'il te pla[iî]t|s il te pla[iî]t)\b|お願い(?:します|いたします)?|ありがとう(?:ございます)?/giu;

const JAPANESE_NAME_MARKERS: ReadonlyArray<string> = ["名前", "名を"];

const JAPANESE_RENAME_ENDS = ["変更", "にして", "にする"];

const SPACED_UNITS = /(^|[^a-z0-9])(\d+) ?(fps|px)/gu;

const SETTING_CONTAINER_WINDOW = 3;

const MARKER_TIMING_WORDS: ReadonlySet<string> = new Set(["beat", "beats", "downbeat", "downbeats", "bpm", "tempo", "bar", "bars"]);

const MARKER_PLACEMENT_ROOTS: ReadonlyArray<string> = ["put", "place", "platzier", "coloc", "stell", "pon", "pone"];

const PLACEMENT_WORDS: ReadonlyArray<string> = ["pon", "pone", "set", "sets", "setz"];

const PLACEMENT_STARTS: ReadonlyArray<string> = ["put", "place", "platzier", "coloc", "stell"];

const LATIN_PHRASE = /^[a-z ]+$/;

function goalClauses(goal: string): ReadonlyArray<string> {
  return goal.replace(QUOTED_TEXT, " ").split(CLAUSE_BREAK).filter((clause) => foldText(clause) !== "");
}

function removeSettingPhrase(folded: string, phrase: string): string {
  const latin = LATIN_PHRASE.test(phrase);
  const haystack = latin ? ` ${folded} ` : folded;
  const needle = latin ? ` ${phrase} ` : phrase;
  return haystack.split(needle).join(" ").trim();
}

function removeSettingPhrases(folded: string): string {
  return SETTINGS_PHRASES.reduce((rest, phrase) => removeSettingPhrase(rest, phrase), folded);
}

function isContainerNear(words: ReadonlyArray<string>, index: number): boolean {
  return words.slice(Math.max(0, index - SETTING_CONTAINER_WINDOW), index).some((word) => SETTINGS_CONTAINER_WORDS.includes(word));
}

function removeContainedSizes(words: ReadonlyArray<string>): ReadonlyArray<string> {
  return words.filter((word, index) => !(SIZE_NOUNS.includes(word) && isContainerNear(words, index)));
}

function isRenameWord(word: string): boolean {
  return RENAME_ENTRY.roots.some((root) => LATIN_PHRASE.test(root) && word.startsWith(foldText(root)));
}

function truncateAfterRename(words: ReadonlyArray<string>): ReadonlyArray<string> {
  const index = words.findIndex(isRenameWord);
  return index < 0 ? words : words.slice(0, index + 1);
}

function isMarkerTiming(word: string): boolean {
  return MARKER_TIMING_WORDS.has(word) || word.startsWith("time") || MARKER_PLACEMENT_ROOTS.some((root) => word.startsWith(root));
}

function withoutMarkerTiming(words: ReadonlyArray<string>, text: string): ReadonlyArray<string> {
  return namedBy(text, MARKER_ENTRY) ? words.filter((word) => !isMarkerTiming(word)) : words;
}

function firstFound(text: string, needles: ReadonlyArray<string>, from: number): { readonly needle: string; readonly index: number } | undefined {
  const hits = needles.map((needle) => ({ needle, index: text.indexOf(needle, from) })).filter((hit) => hit.index >= 0);
  return hits.sort((left, right) => left.index - right.index)[0];
}

/** The folded text with the old name and the new name of a Japanese rename set aside, so that only the rename itself is read. */
export function withoutJapaneseRenameTarget(folded: string): string {
  const marker = firstFound(folded, JAPANESE_NAME_MARKERS, 0);
  const end = marker === undefined ? undefined : firstFound(folded, JAPANESE_RENAME_ENDS, marker.index + marker.needle.length);
  if (marker === undefined || end === undefined) return folded;
  const runStart = folded.slice(0, marker.index).lastIndexOf(" ") + 1;
  return folded.slice(0, runStart) + marker.needle + folded.slice(end.index + end.needle.length);
}

function withUnitsSpaced(folded: string): string {
  return folded.replace(SPACED_UNITS, "$1$2 $3");
}

function isPlacementWord(word: string): boolean {
  return PLACEMENT_WORDS.includes(word) || PLACEMENT_STARTS.some((start) => word.startsWith(start));
}

function withoutSettingVerbs(words: ReadonlyArray<string>, named: boolean): ReadonlyArray<string> {
  return named ? words.filter((word) => !isPlacementWord(word)) : words;
}

function clauseWords(clause: string): ReadonlyArray<string> {
  const unspaced = withUnitsSpaced(withoutJapaneseRenameTarget(foldText(clause)));
  const settingsRemoved = removeSettingPhrases(unspaced);
  const words = withoutSettingVerbs(wordsOf(settingsRemoved), settingsRemoved !== unspaced);
  return truncateAfterRename(withoutMarkerTiming(removeContainedSizes(words), settingsRemoved));
}

function matchesAReference(words: ReadonlyArray<string>): boolean {
  return words.some((word, index) => word.startsWith(MATCH_ROOT) && mentions(words.slice(index + 1, index + 1 + MATCH_WINDOW).join(" "), MATCH_OBJECT_ROOTS));
}

function namesAReference(text: string): boolean {
  const folded = foldText(text);
  return REFERENCE_NOUN_PARTS.some((part) => folded.includes(part)) || hasWord(text, REFERENCE_NOUN_WORDS);
}

function asksForSimilarity(text: string): boolean {
  const folded = foldText(text);
  return mentions(text, SIMILARITY_ROOTS) || hasWord(text, SIMILARITY_WORDS) || SIMILARITY_PARTS.some((part) => text.includes(part)) || ` ${folded} `.includes(" as in ");
}

/** Whether a clause asks the work to match a reference, a comp, a mockup or a style frame, whatever other words it holds; such a clause is always a look judgement. */
export function isReferenceMatch(text: string): boolean {
  return (namesAReference(text) && asksForSimilarity(text)) || matchesAReference(wordsOf(text));
}

function hasTypoOfParent(words: ReadonlyArray<string>): boolean {
  return words.some((word) => oneTypoFrom(word, "parent"));
}

function ordersUnder(words: ReadonlyArray<string>): boolean {
  return words.some((word) => word.startsWith("ordn")) && words.includes("unter");
}

function linksToA(words: ReadonlyArray<string>): boolean {
  return words.includes("a") && words.some((word) => word === "lier" || word === "lie" || word === "relie");
}

function namedBy(text: string, entry: ConceptEntry): boolean {
  return mentions(text, entry.roots) || hasWord(text, entry.words);
}

type ClauseScene = { readonly text: string; readonly words: ReadonlyArray<string> };

const RAW_RULES: ReadonlyArray<readonly [RawConcept, (scene: ClauseScene) => boolean]> = [
  ["judgement", ({ text }) => isReferenceMatch(text)],
  ["parent", ({ words }) => hasTypoOfParent(words) || ordersUnder(words) || linksToA(words)],
  ["motionVerb", ({ text }) => namedBy(text, MOTION_VERB_ENTRY)],
  ["ambiguousLayout", ({ text }) => namedBy(text, AMBIGUOUS_LAYOUT_ENTRY)],
  ["spatialNoun", ({ text }) => namedBy(text, SPATIAL_NOUN_ENTRY)],
  ["timeQuantity", ({ text }) => TIME_QUANTITY.test(text)],
  ["motion", ({ text }) => DELAY.test(text)],
];

function rawConcepts(text: string, words: ReadonlyArray<string>): Set<RawConcept> {
  const found = new Set<RawConcept>();
  for (const [concept, entry] of CONCEPT_ENTRIES) {
    if (namedBy(text, entry)) found.add(concept);
  }
  for (const [concept, holds] of RAW_RULES) {
    if (holds({ text, words })) found.add(concept);
  }
  return found;
}

function isStaticMove(text: string, raw: ReadonlySet<RawConcept>, words: ReadonlyArray<string>): boolean {
  return !raw.has("timeQuantity") && !raw.has("motion") && !words.some((word) => FROM_WORDS.includes(word)) && /\d/.test(text);
}

function settleMotionVerb(text: string, raw: Set<RawConcept>, words: ReadonlyArray<string>): void {
  if (!raw.has("motionVerb")) return;
  raw.delete("motionVerb");
  if (raw.has("folder")) return;
  raw.add(isStaticMove(text, raw, words) ? "transform" : "motion");
}

function settleArrangement(raw: Set<RawConcept>): void {
  if (raw.has("ambiguousLayout") && raw.has("spatialNoun")) raw.add("layout");
}

function settleChangeOverTime(raw: Set<RawConcept>): void {
  if (raw.has("timeQuantity") && !raw.has("timing") && CHANGE_CONCEPTS.some((concept) => raw.has(concept))) raw.add("motion");
}

function isGoalConcept(concept: RawConcept): concept is GoalConcept {
  return concept !== "motionVerb" && concept !== "timeQuantity" && concept !== "spatialNoun" && concept !== "ambiguousLayout";
}

const HEX_COLOUR = /#[0-9a-f]{3,8}\b/iu;

function namesASetting(clause: string): boolean {
  const folded = withUnitsSpaced(withoutJapaneseRenameTarget(foldText(clause)));
  return removeSettingPhrases(folded) !== folded;
}

function readClause(clause: string): ClauseReading {
  const words = clauseWords(clause);
  const text = words.join(" ");
  const raw = rawConcepts(text, words);
  if (HEX_COLOUR.test(clause)) raw.add("colour");
  settleMotionVerb(text, raw, words);
  settleArrangement(raw);
  if (!namesASetting(clause)) settleChangeOverTime(raw);
  return new Set<GoalConcept>([...raw].filter(isGoalConcept));
}

function opensPurpose(clause: string): boolean {
  return PURPOSE_OPENERS.includes(wordsOf(clause)[0] ?? "");
}

function joinPurposeClauses(clauses: ReadonlyArray<string>): ReadonlyArray<string> {
  return clauses.reduce<ReadonlyArray<string>>((joined, clause) => {
    const last = joined[joined.length - 1];
    return opensPurpose(clause) && last !== undefined ? [...joined.slice(0, -1), `${last} ${clause}`] : [...joined, clause];
  }, []);
}

/** The clauses a goal is read as for the review pre-screen: like goal clauses, but a comma and an `and y 540` or `et x 100` coordinate stay in one clause, and a clause that opens with a purpose word (`so`, `damit`, `para`) stays with the clause it explains. */
export function goalClauseTexts(goal: string): ReadonlyArray<string> {
  return joinPurposeClauses(goal.replace(QUOTED_TEXT, " ").replace(POLITE_TAILS, " ").split(REVIEW_CLAUSE_BREAK).filter((clause) => foldText(clause) !== ""));
}

/** The concepts one clause names, read the same way as the clauses of a goal. */
export function clauseReading(clause: string): ClauseReading {
  return readClause(clause);
}

function goalReadings(goal: string): ReadonlyArray<ClauseReading> {
  return goalClauses(goal).map(readClause);
}

/** The concepts a whole goal names: the union of its clauses. */
export function goalConcepts(goal: string): ClauseReading {
  return new Set<GoalConcept>(goalReadings(goal).flatMap((reading) => [...reading]));
}
