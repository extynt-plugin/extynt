// How one UPPER_SNAKE name in a request is read: made by a create verb, or an object that already exists (an edit verb acts on it, it is said to exist, or it is past context).
import { CREATE_NAME_WORDS, NAME_LINK_WORDS, REFERENCE_NAME_WORDS } from "./request-vocabulary.js";

const WORD_BREAK = /[^\p{L}\p{N}_]+/u;
const CLAUSE_END = /[.;!?]/u;
const WINDOW_WORDS = 8;
const CJK_NEAR_BEFORE = 16;
const CJK_NEAR_AFTER = 24;

const DEFINITE = new Set(["the", "that", "this", "these", "those", "el", "la", "los", "las", "este", "esta", "der", "die", "das", "den", "dem", "diese", "diesen", "dieser", "le", "les", "cette", "ce", "cet"]);
const INDEFINITE = new Set(["a", "an", "another", "one", "ein", "eine", "einen", "einem", "einer", "un", "una", "uno", "une", "fresh", "neue", "neuen"]);
const LAYER_NOUNS = new Set([
  "layer", "comp", "composition", "null", "solid", "text", "shape", "camera", "light", "precomp", "group", "folder", "adjustment", "controller", "capa", "composicion", "nulo", "texto", "forma", "camara", "luz", "carpeta",
  "ebene", "komposition", "nullobjekt", "text", "form", "kamera", "licht", "ordner", "calque", "composition", "forme", "lumiere", "dossier", "objet", "title", "titulo", "titel", "titre",
]);
const JOINERS = new Set(["and", "und", "y", "et", "e", "plus", "also", "then", "sowie", "ou", "or", "oder", "o", "the", "a", "an", "la", "el", "le", "die", "der", "das"]);
const PREPOSITIONS = new Set([
  "to", "on", "onto", "in", "into", "inside", "within", "for", "of", "at", "by", "with", "over", "under", "above", "below", "behind", "around", "against",
  "auf", "zu", "zum", "zur", "im", "an", "am", "bei", "mit", "fur", "uber", "unter", "hinter", "in", "sobre", "en", "al", "de", "del", "para", "con", "por", "sur", "dans", "pour", "avec", "sous", "chez", "au", "aux", "du",
]);
const RENAME_TARGET = /\b(?:rename[sd]?|renombra\p{L}*|benenne\p{L}*|umbenenn\p{L}*|renomm\p{L}*|duplicat\p{L}*|duplic\p{L}*|duplizier\p{L}*|dupliqu\p{L}*|copy|copie\p{L}*|copia\p{L}*|kopier\p{L}*|clone|save)\b[^.;]*\b(?:to|as|zu|als|como|comme|en|in|par|a)\s*$/iu;

const CJK_CREATE = /新規|新しい|作成|作って|作る|という名前|名前の|名前で|レイヤー名|命名|创建|新建|建立|名为|叫做|取名|新的|添加|新增|生成|制作|重命名为|改名为|改成|命名为/gu;
const CJK_EXISTING = /既存|今ある|元の|そのまま|名前を変更|リネーム|現有|已有|现有|原来的|保留|重命名|改名|原有|已存在|把|将|選択|选中|选择|隐藏|复制|移动|打开|检查|前の|前回|以前|之前|上次|使った|用过/gu;
const CJK_CREATE_AFTER = /という名前|という名の|名前の|名前で|名前を|を(?:新規|新しく)?(?:作|つく|作成|追加|生成)|として作|作って|作る|作成|新規|命名为|取名为|的(?:新)?(?:图层|合成)(?:创建|新建)/u;
const CJK_EXISTING_AFTER = /動かし|動かす|移動|ずらし|ずらす|隠|非表示|表示|複製|コピー|ぼかし|ぼかす|開い|開く|確認|チェック|選択|選んで|削除|消し|ロック|オフセット|すでに|既に|もう|そのまま|使った|使って|使用|拡大|縮小|回転|フェード|調整|変更|移动|隐藏|显示|复制|模糊|打开|检查|选中|选择|删除|锁定|偏移|已经|已存在|存在|保持|保留|不变|用过|放大|缩小|旋转|调整|修改/u;
const CJK_RENAME_TARGET_AFTER = /^(?:に|へ)(?:リネーム|改名|名前変更|名前を変更|変更)/u;
const CJK_NEGATION_AFTER = /ない|なく|不要|不用|别|无需|避免|やめ|せず|ずに|禁止/u;
const CJK_CLAUSE = /[、。，,;；!?！？]/u;
const CJK_CHAR = /[぀-ヿ一-鿿]/u;

function lastEnd(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].reduce((end, match) => Math.max(end, (match.index ?? 0) + match[0].length), -1);
}

function earliest(text: string, creating: RegExp, existing: RegExp): "create" | "existing" | undefined {
  const made = text.search(creating);
  const kept = text.search(existing);
  if (made < 0 && kept < 0) return undefined;
  return kept < 0 || (made >= 0 && made <= kept) ? "create" : "existing";
}

function readingAround(near: string, head: string): "create" | "existing" | undefined {
  const made = lastEnd(near, CJK_CREATE);
  const kept = lastEnd(near, CJK_EXISTING);
  if (made < 0 && kept < 0) return earliest(head, CJK_CREATE_AFTER, CJK_EXISTING_AFTER);
  return made > kept ? "create" : "existing";
}

/** Whether a name followed and preceded by Japanese or Chinese is made ("create", "existing"), or undefined when those words say nothing about it. */
export function cjkReading(before: string, after: string): "create" | "existing" | undefined {
  const near = before.slice(-CJK_NEAR_BEFORE);
  const head = after.trimStart().slice(0, CJK_NEAR_AFTER).split(CJK_CLAUSE)[0] ?? "";
  if (!CJK_CHAR.test(near + head)) return undefined;
  if (CJK_RENAME_TARGET_AFTER.test(head)) return "create";
  const reading = readingAround(near, head);
  return reading === "create" && CJK_NEGATION_AFTER.test(head) ? "existing" : reading;
}

function clauseWords(before: string): ReadonlyArray<string> {
  const pieces = before.split(CLAUSE_END);
  const last = pieces.at(-1) ?? "";
  const clause = last.split(WORD_BREAK).some((word) => word.length > 0) || pieces.length < 2 ? last : (pieces.at(-2) ?? "");
  return clause.split(WORD_BREAK).filter((word) => word.length > 0).reverse().slice(0, WINDOW_WORDS);
}

function isName(word: string): boolean {
  return word.includes("_") && word === word.toUpperCase();
}

function governedByVerb(verb: string, near: ReadonlyArray<string>): boolean {
  const linked = near.some((word) => NAME_LINK_WORDS.has(word));
  return CREATE_NAME_WORDS.has(verb) && (linked || !PREPOSITIONS.has(near[0] ?? ""));
}

function namesAnObjectToMake(near: ReadonlyArray<string>): boolean {
  const verb = near.find((word) => CREATE_NAME_WORDS.has(word) || REFERENCE_NAME_WORDS.has(word));
  if (verb !== undefined) return governedByVerb(verb, near);
  if (near.some((word) => NAME_LINK_WORDS.has(word))) return !near.some((word) => DEFINITE.has(word));
  return LAYER_NOUNS.has(near[0] ?? "") && INDEFINITE.has(near[1] ?? "");
}

function followsEarlierName(near: ReadonlyArray<string>): boolean {
  return near.length === 0 || near.every((word) => JOINERS.has(word));
}

/** Whether the text before a name makes it: a create verb or a naming word governs it, a rename or copy points at it as the new name, and a list of names after one made name is made too. */
export function latinReading(before: string, previousMade: boolean): boolean {
  if (RENAME_TARGET.test(before.split(CLAUSE_END).pop() ?? "")) return true;
  const words = clauseWords(before);
  const stop = words.findIndex(isName);
  const near = (stop < 0 ? words : words.slice(0, stop)).map((word) => word.toLowerCase());
  if (stop >= 0 && followsEarlierName(near)) return previousMade;
  return namesAnObjectToMake(near);
}
