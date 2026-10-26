// Request structure: how many separate parts a request names, counted from its paragraphs, list markers, counted nouns and timings. Length alone never makes a request long.
import { foldRequest, phraseRegex } from "./request-text.js";

const MIN_PARAGRAPH_WORDS = 3;
const WORD_BREAK = /[^\p{L}\p{N}]+/u;
const PARAGRAPH_BREAK = /\n+/u;
const LIST_MARKER = /(?:^|[\s(])\(?\d{1,2}[.)](?=\s*\p{L})|(?:^|\n)\s*[-*•]\s*(?=\p{L})|[①-⑳]|(?:^|\n|。)\s*[一二三四五六七八九十][、．.]|第[一二三四五六七八九十](?:步|个|段|场|幕|镜|部分|点)/gmu;
const KANJI_NUMBERS: Readonly<Record<string, number>> = { 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const COUNTED_NUMBER = /(?:\d+|[一二两兩三四五六七八九十])(?=[つ个個段场幕条张页章項项组步件本枚番]|カット|シーン|セクション|ステップ|パート)/u;
const NUMBER_WORDS: Readonly<Record<string, number>> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, doce: 12,
  zwei: 2, drei: 3, vier: 4, funf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, zwolf: 12,
  deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10, douze: 12,
};
const SPELLED_NUMBER = Object.keys(NUMBER_WORDS).join("|");
const TIMING = new RegExp(`\\b\\d+(?:[.,]\\d+)?\\s*(?:s|secs?|seconds?|sek\\p{L}*|segundos?)\\b|\\b(?:${SPELLED_NUMBER})\\s+(?:secs?|seconds?|sekunden?|segundos?)\\b|\\b\\d{1,2}:\\d{2}(?::\\d{2})?\\b|\\d+\\s*(?:秒|分钟|分鐘|秒钟)|\\b\\d+\\s*(?:secondes?|seg\\p{L}*)\\b|\\b(?:${SPELLED_NUMBER})\\s+(?:secondes?)\\b`, "giu");

const PART_NOUNS = phraseRegex([
  "section", "shot", "scene", "card", "deliverable", "episode", "chapter", "=slide", "=slides", "sequence", "destination", "stop", "=product", "=products", "feature",
  "testimonial", "step", "stage", "=part", "=parts", "=item", "=items", "=name", "=names", "variant", "version", "=cut", "=cuts", "beat", "clip", "stinger", "highlight",
  "=comp", "=comps", "composition", "seccion", "escena", "tarjeta", "paso", "producto", "testimonio", "capitulo", "diapositiva", "abschnitt", "szene", "karte",
  "schritt", "kapitel", "folie", "セクション", "シーン", "カット", "カード", "章", "場面", "パート", "ステップ", "機能", "紹介", "ショット", "項目",
  "=plan", "=plans", "etape", "partie", "chapitre", "diapositive", "produit", "fonctionnalite", "livrable", "plano", "variante", "entregable", "pieza", "sequenz", "teil", "einstellung",
  "シーケンス", "バージョン", "バリエーション", "スライド", "ページ", "场景", "镜头", "分镜", "段落", "章节", "幻灯片", "片段", "部分", "步骤", "版本", "产品", "功能", "卡片", "页",
]);

function numberValue(word: string): number | undefined {
  if (/^\d+$/u.test(word)) return Number(word);
  return KANJI_NUMBERS[word] ?? NUMBER_WORDS[word];
}

function countedBefore(text: string, at: number): number {
  const before = text.slice(Math.max(0, at - 24), at);
  const counted = before.match(COUNTED_NUMBER);
  if (counted !== null) return numberValue(counted[0]) ?? 0;
  const words = before.split(WORD_BREAK).filter((word) => word.length > 0).slice(-3).reverse();
  return words.map((word) => numberValue(word.toLowerCase()) ?? 0).reduce((most, value) => Math.max(most, value), 0);
}

/** How many separate paragraphs of the request carry words of their own, read from the raw text so a line break is a real break. */
export function paragraphCount(request: string): number {
  return request.split(PARAGRAPH_BREAK)
    .map((paragraph) => foldRequest(paragraph))
    .filter((paragraph) => paragraph.split(" ").filter((word) => word.length > 0).length >= MIN_PARAGRAPH_WORDS).length;
}

/** How many list markers the request carries: numbers followed by a dot or bracket, bullets at a line start, or circled numbers. */
export function listMarkerCount(request: string): number {
  return [...request.matchAll(LIST_MARKER)].length;
}

/** The largest count of named parts: a number written before a part noun such as sections, shots, cards, destinations or comps. */
export function countedPartCount(request: string): number {
  const text = foldRequest(request);
  return [...text.matchAll(PART_NOUNS)].reduce((most, match) => Math.max(most, countedBefore(text, match.index ?? 0)), 0);
}

/** How many separate timings the request names: timecodes, durations in seconds or minutes, and spelled-out seconds. */
export function timingCount(request: string): number {
  return [...foldRequest(request).matchAll(TIMING)].length;
}
