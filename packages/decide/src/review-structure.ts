// Plain structural phrasings the review pre-screen proves from receipts: list continuations of a rename, text metrics set to a number, timing points moved by a number, and a rename that matches a list rather than a look.
import { clauseReading } from "./evidence-concepts.js";
import { RENAME_ENTRY } from "./evidence-concept-tables.js";
import { foldText, mentions, wordsOf } from "./evidence-words.js";
import { FONT_SIZE_PHRASES } from "./review-settings.js";

const TEXT_METRIC_ROOTS: ReadonlyArray<string> = [
  "tracking", "kerning", "leading", "letter spacing", "letterspacing", "laufweite", "zeichenabstand", "buchstabenabstand", "interlinea", "espaciado", "interlettrage", "crénage", "approche", "interligne", "字距", "字间距", "行距", "字符间距", "カーニング", "行間", "文字間",
  "トラッキング", "字間",
];

const TIMING_POINT_ROOTS: ReadonlyArray<string> = [
  "in point", "out point", "in points", "out points", "in and out", "in/out", "end point", "start point", "einstiegspunkt", "ausstiegspunkt", "punto de entrada", "punto de salida", "point d entree", "point de sortie", "入点", "出点", "イン点", "アウト点",
];

const LOOK_MATCH_ROOTS: ReadonlyArray<string> = ["colo", "look", "style", "grade", "tone", "palette", "mood", "feel", "mockup", "mock up", "moodboard", "styleframe", "style frame", "farb", "stil", "refer", "vorlage", "ref ", "modele", "maquette", "ressembl", "参考", "参照", "效果图", "样稿", "风格", "颜色", "見本", "モックアップ", "スタイルフレーム"];

const LIST_CONTINUATION_WORDS = 3;

const HAS_NUMBER = /\d/u;

/** Whether the clause sets a text metric (tracking, kerning, leading, font size) and gives a number. */
export function setsTextMetric(clause: string): boolean {
  return mentions(clause, [...TEXT_METRIC_ROOTS, ...FONT_SIZE_PHRASES]) && HAS_NUMBER.test(clause);
}

/** Whether the clause moves an in or out point by or to a number, so that "move" or "later" names a time, not a motion. */
export function movesTimingPoint(clause: string): boolean {
  return mentions(clause, TIMING_POINT_ROOTS) && HAS_NUMBER.test(clause);
}

function renameIndex(words: ReadonlyArray<string>): number {
  return words.findIndex((word) => RENAME_ENTRY.roots.some((root) => /^[a-z]+$/u.test(root) && word.startsWith(root)));
}

/** Whether the clause renames something and only afterwards says "match" a list or a sheet, so the match concerns the names and not a look. */
export function renamesToMatchNames(clause: string): boolean {
  const words = wordsOf(foldText(clause));
  const verb = renameIndex(words);
  return verb >= 0 && !mentions(`${words.slice(verb + 1).join(" ")} `, LOOK_MATCH_ROOTS);
}

function continuesList(previous: string | undefined, clause: string): boolean {
  if (previous === undefined || !clauseReading(previous).has("name")) return false;
  return clauseReading(clause).size === 0 && wordsOf(clause).length <= LIST_CONTINUATION_WORDS;
}

/** The clauses with the items of a comma list of new names kept with the rename clause that opens the list. */
export function withNameListsJoined(clauses: ReadonlyArray<string>): ReadonlyArray<string> {
  return clauses.reduce<ReadonlyArray<string>>((joined, clause) => {
    const last = joined[joined.length - 1];
    return continuesList(last, clause) ? [...joined.slice(0, -1), `${last} ${clause}`] : [...joined, clause];
  }, []);
}
