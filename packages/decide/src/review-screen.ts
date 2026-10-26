// The review pre-screen: whether the text-only record of covered work already proves it, so that the reviewer's picture-reading call can be left out.
import { clauseReading, goalClauseTexts, isReferenceMatch, withoutJapaneseRenameTarget } from "./evidence-concepts.js";
import { NAME_ENTRY, PURPOSE_OPENERS, RENAME_ENTRY, SETTINGS_CONTAINER_WORDS, SETTINGS_PHRASES, SPATIAL_NOUN_ENTRY, START_ROOTS } from "./evidence-concept-tables.js";
import type { GoalConcept } from "./evidence-concept-tables.js";
import { foldText, mentions, wordsOf } from "./evidence-words.js";
import { PICTURE_WORD_ROOTS, settingReceipts, withControlValuesJoined, withoutSettingWords } from "./review-settings.js";
import type { SettingReceipt } from "./review-settings.js";
import { movesTimingPoint, renamesToMatchNames, setsTextMetric, withNameListsJoined } from "./review-structure.js";
import { binary } from "./spec.js";
import type { BinarySpec } from "./spec.js";

/**
 * What the pre-screen reads, all of it text and counts from the receipts of the covered batches: the request, the specs of the covered items,
 * how the operations were confirmed, and the kinds of operation applied.
 */
export type ReviewScreenCase = {
  readonly goal: string;
  readonly specs: ReadonlyArray<string>;
  readonly batches: number;
  readonly exact: number;
  readonly approximate: number;
  readonly unconfirmed: number;
  readonly operations: ReadonlyArray<string>;
};

type Receipt = GoalConcept | SettingReceipt | "keyframe-removal" | "alignment";

type Part = { readonly receipts: ReadonlySet<Receipt>; readonly keep: boolean; readonly sized: boolean; readonly picture: ReadonlySet<GoalConcept> };

const PROVABLE_OPERATIONS: ReadonlySet<string> = new Set([
  "set_layer_name", "set_layer_attribute", "set_layer_property", "set_layer_parent", "set_layer_timing", "set_composition_settings", "create_composition",
  "create_folder", "move_item_to_folder", "add_marker", "remove_marker", "set_text_document", "delete_keyframes", "set_keyframes",
]);

const SETTING_OPERATIONS: ReadonlyMap<string, Receipt> = new Map<string, Receipt>([["create_layer", "layer"], ["ensure_effect", "effect"], ["set_effect_control", "effect"]]);

const TIMING_OPERATIONS: ReadonlyArray<string> = ["set_layer_timing", "add_marker", "set_keyframes"];

const ALIGNMENT_ROOTS: ReadonlyArray<string> = [
  "beat", "sync", "synchron", "sincroniz", "takt", "lands", "landet", "trifft", "hit", "schlag", "golpe", "compas", "lines up", "lined up", "line up with", "ビート", "拍", "同期", "battement", "synchro", "sur le rythme", "au rythme", "tombe sur", "coincid", "ritmo", "al ritmo", "rhythmus", "im takt", "リズム", "音に合わせ", "卡点", "节拍", "对拍", "踩点", "同步",
];

const MOVE_INTO_ROOTS: ReadonlyArray<string> = ["into", "hinein", "dans", "dentro", "dedans", "in den", "in die", "in das", "入れ", "en la carpeta", "放进", "放入", "移到", "移入", "拖进", "放到文件夹"];

const FOLDER_MOVE_VERBS: ReadonlyArray<string> = ["move", "mover", "mueve", "moving", "verschieb", "verschob", "bewegen", "beweg", "bewegt", "移動", "deplac", "mets", "mettre", "mueve", "muev", "移动", "放进", "放入", "移到"];

const ALIGNMENT_FRAME = /(?:^| )(?:frame|frames|bild|fotograma|フレーム) \d+/u;

const NAME_VERB_ROOTS: ReadonlyArray<string> = [...RENAME_ENTRY.roots, ...NAME_ENTRY.roots].filter((root) => /^[a-z]+$/u.test(root));

const NAME_VERB_WORDS: ReadonlyArray<string> = NAME_ENTRY.words;

const NAME_STOP_WORDS: ReadonlySet<string> = new Set([...PURPOSE_OPENERS, "with", "mit", "con", "avec", "in", "on", "at", "by", "from", "using", "like", "while"]);

const EXPLAINING_ROOTS: ReadonlyArray<string> = [
  "find", "encontr", "finden", "wiederfind", "locat", "ubic", "expression", "ausdruck", "expresion", "script", "skript", "access", "zugriff", "identif",
  "select", "auswahl", "seleccion", "target", "ansprech", "erreich", "alcanz", "benutz",
];

const LATER_WORDS: ReadonlyArray<string> = ["later", "spater", "despues", "danach", "tarde"];

const JAPANESE_PURPOSE = "ために";

const CHANGE_ROOTS: ReadonlyArray<string> = [
  "make", "give", "add", "apply", "increas", "decreas", "reduc", "more", "less", "brighter", "darker", "mach", "gib", "fug", "hinzu", "erhoh", "verstark",
  "agreg", "haz", "aplic", "aument", "ajout", "donne", "rend", "augment", "追加", "足", "fais", "applique", "diminu", "reduis", "anade", "reduce", "verringer", "reduzier", "anheb", "增加", "减少", "添加", "调高", "调低", "加上", "加一",
];

const JUDGEMENT_EXTRA_ROOTS: ReadonlyArray<string> = [
  ...PICTURE_WORD_ROOTS,
  "warm", "cool", "readab", "legib", "pop", "punch", "subtl", "smooth", "glatt", "balanc", "harmon", "lesbar", "suave", "calid", "fluid", "gentle",
  "sanft", "dramat", "crisp", "polish", "chaleur", "doux", "lisib", "暖か", "温か", "滑らか", "なめらか", "読みやす", "バランス",
  "prett", "sharp", "soft", "bold", "rich", "snap", "calm", "clean", "chaud", "froid", "fluide", "equilibr", "dramatiq", "frio", "nitid", "dramatic", "kalt", "scharf", "weich", "kraftig", "dezent", "klar", "sauber", "柔らか", "クリア", "シャープ", "クール", "ドラマチック", "インパクト", "見やすい", "温暖", "清晰", "易读", "柔和", "平滑", "顺滑", "丝滑", "冲击", "戏剧", "干净", "锐利",
];

const LOOK_OR_JUDGEMENT: ReadonlySet<GoalConcept> = new Set<GoalConcept>(["look", "colour", "judgement"]);

const PLACEMENT_ROOTS: ReadonlyArray<string> = ["setze", "pon", "coloc", "place", "put", "positionier", "position", "配置", "mets", "positionn", "pose", "lege", "置い", "放在", "放到", "摆在", "设置位置"];

const KEYFRAME_NO_WORDS: ReadonlySet<string> = new Set(["no", "kein", "keine", "sin", "ohne", "sans", "aucun", "aucune"]);

const STRUCTURAL_CONCEPTS: ReadonlySet<GoalConcept> = new Set<GoalConcept>(["name", "comp", "parent", "marker", "folder", "timing", "text", "attribute", "transform"]);

const PICTURE_CONCEPTS: ReadonlySet<GoalConcept> = new Set<GoalConcept>(["motion", "sequence", "counting", "look", "colour", "layout", "judgement"]);

const RECEIPTS: ReadonlyMap<Receipt, ReadonlyArray<string>> = new Map<Receipt, ReadonlyArray<string>>([
  ["name", ["set_layer_name"]],
  ["attribute", ["set_layer_attribute"]],
  ["transform", ["set_layer_property"]],
  ["parent", ["set_layer_parent"]],
  ["marker", ["add_marker", "remove_marker"]],
  ["folder", ["create_folder", "move_item_to_folder"]],
  ["timing", ["set_layer_timing"]],
  ["comp", ["set_composition_settings", "create_composition"]],
  ["text", ["set_text_document"]],
  ["keyframe-removal", ["delete_keyframes", "set_layer_property"]],
  ["alignment", TIMING_OPERATIONS],
  ["layer", ["create_layer"]],
  ["effect", ["ensure_effect", "set_effect_control"]],
  ["blend", ["set_layer_property", "set_layer_attribute"]],
]);

const KEYFRAME_ROOTS: ReadonlyArray<string> = ["keyframe", "schlusselbild", "fotograma", "images cles", "image cle", "imagenes clave", "fotograma clave", "キーフレーム", "关键帧"];

const REMOVAL_ROOTS: ReadonlyArray<string> = [
  "remov", "delet", "clear", "strip", "entfern", "losch", "quit", "elimin", "borr", "supprim", "enlev", "retir", "efface", "削除", "取り除", "消", "外す", "删除", "移除", "去掉", "清除", "清空", "删掉",
];

const KEEP_ROOTS: ReadonlyArray<string> = ["keep", "stay", "remain", "unchanged", "bleib", "behalt", "manten", "conserv", "garde", "そのまま", "laisse", "reste", "inchang", "tel quel", "deja", "unverandert", "lass", "維持", "変えず", "保持", "保留", "不变", "维持", "不动"];

const TIMING_ROOTS: ReadonlyArray<string> = ["duration", "dauer", "duracion", "start time", "end time", "in point", "out point", "point d entree", "point de sortie", "temps de debut", "temps de fin", "startzeit", "endzeit", "tiempo de inicio", "tiempo de fin", "継続時間", "デュレーション", "開始時間", "終了時間", "イン点", "アウト点", "时长", "持续时间", "入点", "出点", "开始时间", "结束时间", ...START_ROOTS];

const SIZE_ROOTS: ReadonlyArray<string> = ["size", "groesse", "grosse", "tamano", "taille", "サイズ", "大小", "尺寸"];

const FOLDER_NOUNS: ReadonlySet<string> = new Set(["folder", "folders", "ordner", "carpeta", "carpetas", "dossier", "dossiers", "フォルダ"].map(foldText));

const CONTAINERS: ReadonlySet<string> = new Set((
  "layer layers solid solids folder folders composition comp comps null nulls shape shapes footage item items " +
  "ebene ebenen capa capas calque calques couche couches"
).split(" "));

const NAMING: ReadonlySet<string> = new Set((
  "called named namens heisst heist llamada llamado nombrada nombrado appelee appele nomme nommee"
).split(" "));

const DETERMINERS: ReadonlySet<string> = new Set((
  "the a an my our this that der die das den dem ein eine einen el la los las un una le les"
).split(" "));

const BOUNDARIES: ReadonlySet<string> = new Set([
  ...DETERMINERS,
  ...("to of on at for by with from into in and or all every each its their his her set lock hide make move rename add put keep remove delete " +
    "so then it zu auf mit von bei und para por con en de del al des du").split(" "),
]);

const TARGET_FOLLOWERS: ReadonlySet<string> = new Set(["to", "at", "on", "by", "in", "with", "from", "and", "und", "auf", "bei", "so"]);

const SPAN_AFTER_NAMING = 3;

const SPAN_BEFORE_CONTAINER = 2;

function isNumber(word: string | undefined): boolean {
  return word !== undefined && /^\d+$/u.test(word);
}

function markBefore(words: ReadonlyArray<string>, index: number, dropped: Set<number>): void {
  for (let next = index - 1; next >= Math.max(0, index - SPAN_BEFORE_CONTAINER); next -= 1) {
    if (BOUNDARIES.has(words[next] ?? "")) return;
    dropped.add(next);
  }
}

function markAfter(words: ReadonlyArray<string>, index: number, dropped: Set<number>): void {
  for (let next = index + 1; next <= Math.min(words.length - 1, index + SPAN_AFTER_NAMING); next += 1) {
    if (BOUNDARIES.has(words[next] ?? "")) return;
    dropped.add(next);
  }
}

function isTargetAfterDeterminer(words: ReadonlyArray<string>, index: number): boolean {
  const next = words[index + 1];
  return DETERMINERS.has(words[index - 1] ?? "") && (next === undefined || TARGET_FOLLOWERS.has(next) || isNumber(next));
}

function layerNamesRemoved(words: ReadonlyArray<string>): ReadonlyArray<string> {
  const dropped = new Set<number>();
  words.forEach((word, index) => {
    if (CONTAINERS.has(word)) markBefore(words, index, dropped);
    if (NAMING.has(word) || FOLDER_NOUNS.has(word)) markAfter(words, index, dropped);
    if (!BOUNDARIES.has(word) && isTargetAfterDeterminer(words, index)) dropped.add(index);
  });
  return words.filter((_, index) => !dropped.has(index));
}

function isKeyframeOrTimeWord(words: ReadonlyArray<string>, index: number): boolean {
  const word = words[index] ?? "";
  if (KEYFRAME_ROOTS.some((root) => word.startsWith(root))) return true;
  return word.startsWith("time") && words[index - 1] !== "over";
}

function withoutPictureNoise(clause: string): string {
  const withoutCjkKeyframes = clause.split("キーフレーム").join(" ");
  const words = wordsOf(withoutCjkKeyframes).filter((_, index, all) => !isKeyframeOrTimeWord(all, index));
  return layerNamesRemoved(words).join(" ");
}

function firstWordIs(clause: string, word: string): boolean {
  return wordsOf(clause)[0] === word;
}

function hasKeyframeWord(clause: string): boolean {
  const folded = foldText(clause);
  return KEYFRAME_ROOTS.some((root) => folded.includes(foldText(root)));
}

function hasNoWord(clause: string): boolean {
  return wordsOf(clause).some((word) => KEYFRAME_NO_WORDS.has(word)) || clause.includes("なし");
}

function removesKeyframes(clause: string): boolean {
  return hasKeyframeWord(clause) && (mentions(clause, REMOVAL_ROOTS) || hasNoWord(clause));
}

function setsLiteralValue(clause: string, reading: ReadonlySet<GoalConcept>): boolean {
  const numbers = clause.match(/\d+/gu)?.length ?? 0;
  return numbers >= 2 || (numbers === 1 && (reading.has("transform") || reading.has("timing") || mentions(clause, TIMING_ROOTS)));
}

function placesAtValues(clause: string): boolean {
  return (clause.match(/\d+/gu)?.length ?? 0) >= 2 && mentions(clause, PLACEMENT_ROOTS);
}

function isStructural(clause: string): boolean {
  const reading = clauseReading(clause);
  return reading.has("name") || firstWordIs(clause, "title") || reading.has("attribute") || removesKeyframes(clause) || setsLiteralValue(clause, reading);
}

function isAlignment(clause: string): boolean {
  return mentions(withoutSettingWords(foldText(clause)), ALIGNMENT_ROOTS) || (ALIGNMENT_FRAME.test(foldText(clause)) && !mentions(clause, START_ROOTS));
}

function isNameVerb(word: string): boolean {
  return NAME_VERB_WORDS.includes(word) || NAME_VERB_ROOTS.some((root) => word.startsWith(root));
}

function isNameStop(word: string): boolean {
  return NAME_STOP_WORDS.has(word) || CHANGE_ROOTS.some((root) => word.startsWith(root));
}

function hasLiteralValue(clause: string): boolean {
  return placesAtValues(clause) || setsLiteralValue(clause, clauseReading(clause));
}

function isColourName(tokens: ReadonlyArray<string>, index: number): boolean {
  const token = tokens[index] ?? "";
  if (!clauseReading(token).has("colour")) return false;
  const capitalised = index > 0 && /^\p{Lu}/u.test(token);
  const modifier = DETERMINERS.has(foldText(tokens[index - 1] ?? "")) && !BOUNDARIES.has(foldText(tokens[index + 1] ?? ""));
  return capitalised || modifier;
}

function withoutColourNames(clause: string): string {
  if (!hasLiteralValue(clause)) return clause;
  const tokens = clause.split(/[^\p{L}\p{N}]+/u).filter((token) => token !== "");
  return tokens.filter((_, index) => !isColourName(tokens, index)).join(" ");
}

function withoutNames(clause: string): string {
  const words = wordsOf(clause);
  const verb = words.findIndex(isNameVerb);
  if (verb < 0) return clause;
  const stop = words.findIndex((word, index) => index > verb && isNameStop(word));
  return [...words.slice(0, verb + 1), ...words.slice(stop < 0 ? words.length : stop)].join(" ");
}

function splitPurpose(clause: string): { readonly body: string; readonly tail: string | undefined } {
  const words = wordsOf(clause);
  const index = words.findIndex((word) => PURPOSE_OPENERS.includes(word));
  if (index >= 0) return { body: words.slice(0, index).join(" "), tail: words.slice(index + 1).join(" ") };
  const cut = clause.indexOf(JAPANESE_PURPOSE);
  return cut < 0 ? { body: clause, tail: undefined } : { body: clause.slice(0, cut), tail: clause.slice(cut + JAPANESE_PURPOSE.length) };
}

function isPictureText(text: string): boolean {
  return [...clauseReading(text)].some((concept) => PICTURE_CONCEPTS.has(concept)) || mentions(text, JUDGEMENT_EXTRA_ROOTS);
}

function hasLookOrJudgement(content: string): boolean {
  const looks = [...clauseReading(content)].some((concept) => LOOK_OR_JUDGEMENT.has(concept));
  return looks || mentions(content, JUDGEMENT_EXTRA_ROOTS);
}

function statesTiming(body: string): boolean {
  return clauseReading(body).has("timing") || mentions(body, TIMING_ROOTS);
}

function purposeVetoes(tail: string, timed: boolean): boolean {
  const content = wordsOf(tail).filter((word) => !LATER_WORDS.includes(word)).join(" ");
  if (timed && isAlignment(content)) return hasLookOrJudgement(content);
  if (timed && /\d/u.test(content)) return isPictureText(content);
  return !mentions(content, EXPLAINING_ROOTS) || isPictureText(content);
}

function withoutFolderMoveVerb(clause: string): string {
  if (!mentions(clause, MOVE_INTO_ROOTS)) return clause;
  return wordsOf(clause).filter((word) => !mentions(word, FOLDER_MOVE_VERBS)).join(" ");
}

function withoutAlignedLayout(subject: string, picture: Set<GoalConcept>): void {
  if (!isAlignment(subject)) return;
  picture.delete("motion");
  if (!mentions(subject, SPATIAL_NOUN_ENTRY.roots)) picture.delete("layout");
}

function judgesTheClause(subject: string, clause: string): boolean {
  return mentions(subject, JUDGEMENT_EXTRA_ROOTS) || (isReferenceMatch(clause) && !renamesToMatchNames(clause));
}

function pictureOf(clause: string): ReadonlySet<GoalConcept> {
  const { body, tail } = splitPurpose(clause);
  const subject = withoutNames(withoutJapaneseRenameTarget(withoutSettingWords(foldText(withoutColourNames(withoutFolderMoveVerb(body))))));
  const picture = new Set([...clauseReading(withoutPictureNoise(subject))].filter((concept) => PICTURE_CONCEPTS.has(concept)));
  if (isStructural(subject) && !mentions(subject, CHANGE_ROOTS)) picture.delete("look");
  withoutAlignedLayout(subject, picture);
  if (movesTimingPoint(subject)) picture.delete("motion");
  if (judgesTheClause(subject, clause)) picture.add("judgement");
  if (tail !== undefined && purposeVetoes(tail, statesTiming(body))) picture.add("purpose");
  return picture;
}

function namesCompSetting(clause: string): boolean {
  return mentions(clause, SETTINGS_PHRASES) && (mentions(clause, SETTINGS_CONTAINER_WORDS) || !mentions(clause, TIMING_ROOTS));
}

function addSettingReceipts(clause: string, receipts: Set<Receipt>): void {
  if (mentions(clause, MOVE_INTO_ROOTS)) receipts.add("folder");
  if (namesCompSetting(clause)) receipts.add("comp");
  if (!setsTextMetric(clause)) return;
  receipts.add("text");
  receipts.add("transform");
}

function partOf(clause: string): Part {
  const receipts = new Set<Receipt>([...clauseReading(clause)].filter((concept) => STRUCTURAL_CONCEPTS.has(concept)));
  if (firstWordIs(clause, "title")) receipts.add("name");
  if (placesAtValues(clause)) receipts.add("transform");
  if (isAlignment(clause)) receipts.add("alignment");
  if (mentions(clause, TIMING_ROOTS)) receipts.add("timing");
  if (removesKeyframes(clause)) receipts.add("keyframe-removal");
  addSettingReceipts(clause, receipts);
  settingReceipts(clause).forEach((receipt) => receipts.add(receipt));
  return { receipts, keep: mentions(clause, KEEP_ROOTS), sized: mentions(clause, SIZE_ROOTS), picture: pictureOf(clause) };
}

function receiptsOf(receipt: Receipt, part: Part, goalHasText: boolean): ReadonlyArray<string> {
  const base = RECEIPTS.get(receipt) ?? [];
  if (receipt !== "transform") return base;
  const kept = part.keep ? ["set_layer_parent"] : [];
  const sized = part.sized && goalHasText ? ["set_text_document"] : [];
  return [...base, ...kept, ...sized];
}

function coveredBy(part: Part, operations: ReadonlySet<string>, goalHasText: boolean): boolean {
  return [...part.receipts].some((receipt) => receiptsOf(receipt, part, goalHasText).some((operation) => operations.has(operation)));
}

function onlyProvable(operations: ReadonlyArray<string>, parts: ReadonlyArray<Part>): boolean {
  const provable = (operation: string): boolean => {
    const needed = SETTING_OPERATIONS.get(operation);
    return PROVABLE_OPERATIONS.has(operation) || (needed !== undefined && parts.some((part) => part.receipts.has(needed)));
  };
  return operations.length > 0 && operations.every(provable);
}

function everyReadBackExact(state: ReviewScreenCase): boolean {
  return state.exact > 0 && state.approximate === 0 && state.unconfirmed === 0;
}

function timingUnproven(parts: ReadonlyArray<Part>, specs: ReadonlyArray<string>, operations: ReadonlySet<string>): boolean {
  const aligned = parts.some((part) => part.receipts.has("alignment")) || specs.some((spec) => goalClauseTexts(spec).some(isAlignment));
  return aligned && !TIMING_OPERATIONS.some((operation) => operations.has(operation));
}

function joinedClauses(text: string): ReadonlyArray<string> {
  return withControlValuesJoined(withNameListsJoined(goalClauseTexts(text)));
}

function judgesThePicture(parts: ReadonlyArray<Part>, specs: ReadonlyArray<string>): boolean {
  return parts.some((part) => part.picture.size > 0) || specs.some((spec) => joinedClauses(spec).some((clause) => pictureOf(clause).size > 0));
}

function provedByReceipts(state: ReviewScreenCase): boolean {
  const parts = joinedClauses(state.goal).map(partOf);
  if (state.batches === 0 || !everyReadBackExact(state) || !onlyProvable(state.operations, parts) || parts.length === 0) return false;
  const operations = new Set(state.operations);
  const goalHasText = parts.some((part) => part.receipts.has("text"));
  const timingClaimed = timingUnproven(parts, state.specs, operations);
  return !timingClaimed && parts.every((part) => part.receipts.size > 0 && coveredBy(part, operations, goalHasText)) && !judgesThePicture(parts, state.specs);
}

/**
 * Whether the covered work is proved by its receipts so that nobody has to look at a rendered frame of it. A review is skipped only when the receipts clearly prove it:
 * every asked part must name structure (a name, a composition setting, a value, a parent, a marker, a folder, a trim, text, a lock, or the removal of keyframes),
 * and at least one receipt of an operation that proves that structure must have been confirmed exactly. A part that names a look, a colour, a layout, a motion,
 * a sequence, a count, a judgement or a purpose keeps its review, and so does any approximate or unconfirmed read-back. Layer names and keyframe or timing words
 * do not count as looks. A model answer is never enough alone; the sidecar also needs the visual waiver, so a request that asks for a look keeps its review.
 */
export const REVIEW_PROVEN: BinarySpec<ReviewScreenCase> = binary<ReviewScreenCase>({
  name: "review-proven",
  instructions: "A job in After Effects built sections, and each section has a spec. The state holds the request, the specs, and counts from the receipts: how many operations the host confirmed exactly by reading values back, how many only approximately, how many not at all, and the kinds of operation applied. Decide whether the specs ask only for exact values, names, timing or structure that this read-back already proves, so that nobody needs to look at a rendered picture of the work.",
  stakes: "high",
  criteria: {
    true: "Every operation was confirmed exactly, nothing is approximate or unconfirmed, and the specs ask only for exact values, names, timing or structure that the read-back proves; nothing was drawn or designed.",
    false: "Something was drawn, designed, animated or styled so that how it looks or moves matters, or any operation is approximate or unconfirmed, or a spec asks for a look, a layout, a match or a judgement.",
  },
  deterministic: provedByReceipts,
});
