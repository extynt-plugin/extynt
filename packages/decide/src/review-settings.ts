// Exact settings the review pre-screen proves from receipts without a picture, in six languages: a font size, upper or lower case, a work area, a renamed composition, a camera or light that exists, a z value, an effect control given as a number, and a layer's blend mode.
import { NAME_ENTRY, WORK_AREA_PHRASES } from "./evidence-concept-tables.js";
import { clauseReading } from "./evidence-concepts.js";
import { foldText, hasWord, mentions } from "./evidence-words.js";

/** What a clause is a setting of, when it names one of the exact settings above. */
export type SettingReceipt = "text" | "comp" | "transform" | "layer" | "effect" | "blend";

const fold = (words: ReadonlyArray<string>): ReadonlyArray<string> => words.map(foldText);

/** Phrases that name the size of text. */
export const FONT_SIZE_PHRASES: ReadonlyArray<string> = fold([
  "font size", "text size", "type size", "point size", "size of the font", "size of the text", "tamano de fuente", "tamano de la fuente", "tamano de letra", "tamano de la letra", "tamano del texto", "tamano de texto",
  "schriftgrosse", "schrifthohe", "schriftgrad", "textgrosse", "taille de police", "taille de la police", "taille du texte", "taille de caractere", "taille des caracteres",
  "フォントサイズ", "文字サイズ", "テキストサイズ", "文字の大きさ", "フォントの大きさ", "字号", "字体大小", "文字大小", "文本大小",
]);

const CASE_PHRASES: ReadonlyArray<string> = fold([
  "all caps", "allcaps", "uppercase", "upper case", "capital letters", "capitals", "lowercase", "lower case", "title case", "sentence case", "small caps", "mayuscula", "minuscula",
  "grossbuchstaben", "kleinbuchstaben", "versalien", "grossschreib", "kleinschreib", "majuscule", "en minuscule", "capitales", "大文字", "小文字", "全部大写", "全大写", "大写", "小写", "全部小写",
]);

const COMP_NOUNS: ReadonlyArray<string> = fold(["composition", "composicion", "komposition", "コンポジション", "コンポ", "合成"]);

const LAYER_NOUNS: ReadonlyArray<string> = fold(["layer", "ebene", "capa", "calque", "couche", "レイヤー", "图层", "圖層"]);

const LIGHT_KINDS: ReadonlyArray<string> = fold([
  "point light", "spot light", "spotlight", "ambient light", "parallel light", "light layer", "a light", "new light", "luz puntual", "luz focal", "luz ambiental", "luz paralela", "capa de luz", "una luz",
  "punktlicht", "umgebungslicht", "parallellicht", "lichtebene", "ein licht", "lumiere ponctuelle", "lumiere ambiante", "lumiere parallele", "calque de lumiere", "une lumiere",
  "ポイントライト", "スポットライト", "アンビエントライト", "平行ライト", "ライトレイヤー", "ライトを", "ライトが", "点光源", "点光", "聚光灯", "环境光", "平行光", "灯光图层", "灯光层", "一盏灯光", "一盏灯", "一个灯光",
]);

const LAYER_KINDS: ReadonlyArray<string> = fold([
  "camera", "camara", "kamera", "カメラ", "摄像机", "相机", "摄影机",
]);

const CONTROL_NOUNS: ReadonlyArray<string> = fold([
  "opacity", "opacidad", "deckkraft", "opacite", "不透明度", "distance", "distancia", "abstand", "entfernung", "距離", "距离", "intensity", "intensidad", "intensitat", "intensite", "強さ", "強度", "强度", "amount", "cantidad", "menge", "quantite", "radius", "radio", "rayon", "半径",
  "softness", "suavidad", "weichheit", "douceur", "柔らかさ", "柔和度", "spread", "propagation", "ausbreitung", "threshold", "umbral", "schwellenwert", "seuil", "しきい値", "阈值", "strength", "fuerza", "force",
  "blurriness", "borrosidad", "unscharfe", "模糊度", "模糊量", "feather", "direction", "direccion", "richtung", "方向",
]);

const EFFECT_NAMES: ReadonlyArray<string> = fold([
  "shadow", "sombra", "schlagschatten", "schatten", "ombre", "シャドウ", "影", "阴影", "投影", "blur", "desenfoque", "difuminado", "weichzeichner", "flou", "ぼかし", "ブラー", "模糊", "虚化",
  "glow", "resplandor", "lueur", "グロー", "発光", "发光", "辉光", "vignette", "vineta", "vignettage", "ビネット", "暗角", "grain", "grano", "korn", "グレイン", "颗粒", "noise", "ruido", "rauschen", "bruit", "ノイズ", "噪点",
  "contrast", "contraste", "kontrast", "コントラスト", "对比度", "saturation", "saturacion", "sattigung", "彩度", "饱和度", "brightness", "helligkeit", "luminosite", "明るさ", "亮度",
]);

const BLEND_PHRASES: ReadonlyArray<string> = fold([
  "blend mode", "blending mode", "transfer mode", "layer mode", "modo de fusion", "modo de mezcla", "modo de transferencia", "fusionsmodus", "fullmodus", "uberblendmodus", "mischmodus", "ebenenmodus",
  "mode de fusion", "mode de melange", "mode de transfert", "描画モード", "ブレンドモード", "合成モード", "レイヤーモード", "混合模式", "叠加模式", "图层模式", "混合方式",
]);

const BLEND_MODES: ReadonlyArray<string> = fold([
  "normal", "dissolve", "darken", "multiply", "color burn", "linear burn", "lighten", "screen", "color dodge", "linear dodge", "add", "overlay", "soft light", "hard light", "vivid light", "linear light", "pin light",
  "hard mix", "difference", "exclusion", "subtract", "divide", "hue", "saturation", "color", "luminosity", "multiplicar", "pantalla", "superponer", "luz suave", "luz intensa", "diferencia", "exclusion", "oscurecer", "aclarar",
  "multiplizieren", "negativ multiplizieren", "ineinanderkopieren", "weiches licht", "hartes licht", "differenz", "aufhellen", "abdunkeln", "produit", "ecran", "superposition", "lumiere tamisee", "lumiere crue", "eclaircir", "obscurcir",
  "乗算", "スクリーン", "オーバーレイ", "ソフトライト", "ハードライト", "差の絶対値", "加算", "覆い焼き", "焼き込み", "正片叠底", "滤色", "叠加", "柔光", "强光", "差值", "排除", "变亮", "变暗", "颜色减淡", "颜色加深", "相加", "实色混合",
]);

const COMPOUND_EFFECTS: ReadonlyArray<string> = ["schlagschatten"];

/** Words that describe how something looks or where on the picture it sits, which no read-back proves: a tone, a weight, a finish, a side. */
export const PICTURE_WORD_ROOTS: ReadonlyArray<string> = fold([
  "dark", "dim", "faint", "heavy", "thick", "thin", "strong", "harsh", "deep", "shiny", "glossy", "vivid", "faded", "washed", "muted", "punchy", "moody", "retro", "vintage", "grungy", "gritty", "neon", "pastel", "dreamy", "sleek", "modern", "playful", "fancy", "ugly",
  "left side", "right side", "left", "right", "top", "bottom", "corner", "edge",
  "oscur", "tenue", "intens", "vibrante", "apagad", "fuerte", "grueso", "izquierd", "derech", "esquina", "lado", "arriba", "abajo", "borde",
  "dunkel", "grell", "matt", "zart", "links", "rechts", "oben", "unten", "ecke", "seite", "rand",
  "sombre", "lumineux", "vif", "vive", "terne", "epais", "gauche", "droite", "en haut", "en bas", "coin", "cote", "bord",
  "暗い", "濃く", "濃い", "薄く", "薄い", "太く", "太い", "細く", "派手", "地味", "レトロ", "ポップ", "鮮やか", "くっきり", "ふんわり", "左側", "右側", "左上", "右上", "左下", "右下", "隅", "端",
  "深色", "浅色", "暗色", "明亮", "鲜艳", "复古", "梦幻", "厚重", "轻盈", "醒目", "突出", "夸张", "左侧", "右侧", "左边", "右边", "左上角", "右上角", "角落", "边缘",
]);

const Z_VALUE = /(?:^| )z(?: ?(?:position|pos|wert|value|axe|axis|achse|koordinate))? \d|z(?:位置|轴|軸|坐标)/u;

const PLACEHOLDER = " zzword ";

const PLAIN = /^[a-z0-9 ]+$/u;

const HAS_NUMBER = /\d/u;

function removePhrase(folded: string, phrase: string): string {
  if (!PLAIN.test(phrase)) return folded.split(phrase).join(PLACEHOLDER);
  return folded.replace(new RegExp(`(?<![a-z0-9])${phrase}(?:e?s)?(?![a-z0-9])`, "gu"), PLACEHOLDER);
}

function removePhrases(folded: string, phrases: ReadonlyArray<string>): string {
  return phrases.reduce(removePhrase, folded);
}

function namesComp(clause: string): boolean {
  return mentions(clause, COMP_NOUNS) || hasWord(clause, ["comp", "comps"]);
}

function renamesAComp(clause: string): boolean {
  const renames = mentions(clause, NAME_ENTRY.roots) || hasWord(clause, NAME_ENTRY.words);
  return renames && namesComp(clause) && !mentions(clause, LAYER_NOUNS);
}

function hasControlValue(clause: string): boolean {
  return HAS_NUMBER.test(clause) && mentions(clause, CONTROL_NOUNS);
}

function namesBlendMode(clause: string): boolean {
  return mentions(clause, BLEND_PHRASES);
}

function namesLayerKind(clause: string): boolean {
  return mentions(clause, LAYER_KINDS) || mentions(clause, LIGHT_KINDS);
}

/** The exact settings a clause names, as the receipts that prove them. */
export function settingReceipts(clause: string): ReadonlySet<SettingReceipt> {
  const found = new Set<SettingReceipt>();
  if (mentions(clause, CASE_PHRASES)) found.add("text");
  if (mentions(clause, WORK_AREA_PHRASES) || renamesAComp(clause)) found.add("comp");
  if (Z_VALUE.test(foldText(clause))) found.add("transform");
  if (namesLayerKind(clause)) found.add("layer");
  if (hasControlValue(clause)) found.add("effect");
  if (namesBlendMode(clause)) found.add("blend");
  return found;
}

/** The folded clause without the words of its exact settings, so that a shadow with a distance, a camera, a blend mode or a font size is not read as a look. */
export function withoutSettingWords(folded: string): string {
  const effects = hasControlValue(folded) ? [...EFFECT_NAMES, ...CONTROL_NOUNS] : [];
  const blends = namesBlendMode(folded) ? [...BLEND_PHRASES, ...BLEND_MODES] : [];
  const cases = mentions(folded, CASE_PHRASES) ? CASE_PHRASES : [];
  return removePhrases(folded, [...COMPOUND_EFFECTS, ...FONT_SIZE_PHRASES, ...cases, ...LIGHT_KINDS, ...effects, ...blends]);
}

/** The clauses with a bare control value (`distance 20`) kept with the clause before it when that one names an effect. */
export function withControlValuesJoined(clauses: ReadonlyArray<string>): ReadonlyArray<string> {
  return clauses.reduce<ReadonlyArray<string>>((joined, clause) => {
    const last = joined[joined.length - 1];
    const continues = last !== undefined && hasControlValue(clause) && clauseReading(withoutSettingWords(foldText(clause))).size === 0 && mentions(last, EFFECT_NAMES);
    return continues ? [...joined.slice(0, -1), `${last} ${clause}`] : [...joined, clause];
  }, []);
}
