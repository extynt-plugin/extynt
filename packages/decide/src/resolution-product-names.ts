// Reads a request that names a product the catalogue does not hold (a vendor and product, a "Deep X", an AI tool) so the effect resolver answers none instead of the nearest built-in.
import { foldLetters } from "./text-folding.js";

const RUN = /(?<![A-Za-z0-9])[A-Z][A-Za-z0-9]*(?: +[A-Z0-9][A-Za-z0-9]*)*/gu;
const TOKEN = /[A-Z0-9][A-Za-z0-9]*/gu;
const WORD = /[A-Za-z][A-Za-z0-9]*/gu;

const USE_VERBS = "use|using|with|con|avec|add|apply|applying|try|get|put|need|want|give me|usa|usar|utiliza|utilizar|aplica|aplicar|anade|agrega|agregar|pon|ponle|nutze|nutz|benutze|benutzen|verwende|verwenden|wende|fuge|setze|nimm|utilise|utiliser|applique|appliquer|ajoute|ajouter|mets|essaie|prends";
const ARTICLES = "the|a|an|some|el|la|un|una|unos|den|die|das|ein|eine|einen|le|les|une|du|des|mon|ma";
const MARKERS = "plugin|plug-in|preset|effect|efecto|effekt|effet|filter|filtro|filtre";

const LATIN_LEAD = new RegExp(`(?:^|[\\s,;:(])(?:(?:${USE_VERBS})\\s+(?:(?:${ARTICLES})\\s+)?(?:(?:${MARKERS})\\s+)?|(?:${MARKERS})\\s+)$`, "iu");
const LATIN_TAIL = /^ *(?:plugin|plug-in|preset|pack|suite|extension|tool|herramienta|werkzeug|outil)(?![A-Za-z])/iu;
const CJK_LEAD = /(?:用|使用|套用|应用|添加|加上|加个|加一个|来个|做个|使う|使って|適用して)\s*$/u;
const CJK_TAIL = /^\s*(?:で|を(?:使|足|入れ|追加|かけ|適用|付け)|のプラグイン|のエフェクト|のフィルタ|プラグイン|エフェクト|插件|滤镜|特效)/u;
const AI_TOOL = /(?<![A-Za-z])(?:AI|KI|IA)(?![A-Za-z])|(?<![a-z])ai[- ]?(?:powered|based|driven)(?![a-z])/u;

const LAYER_LEAD = /(?:^|\s)(?:to|on|onto|into|of|in|for|al|en|au|aux|sur|dans|du|zum|zur|auf|im|am|von)\s+(?:(?:the|el|la|le|les|der|die|das|dem)\s+)?$/iu;
const LEADING_VERB = new RegExp(`^(?:${USE_VERBS})(?![A-Za-z])`, "iu");
const LAYER_NOUNS = new Set(["title", "text", "logo", "background", "layer", "solid", "shape", "null", "camera", "light", "footage", "video", "image", "photo", "comp", "composition", "mask", "subtitle", "caption", "heading", "intro", "outro", "scene", "clip", "shot"]);

const MIN_TOKEN = 3;
const MAX_ACRONYM = 4;
const TITLE_CASED_WORDS = 4;
const NAME_UNKNOWNS = 2;

function isTitleCased(text: string): boolean {
  const words = text.match(WORD) ?? [];
  return words.length >= TITLE_CASED_WORDS && words.every((word) => /^[A-Z]/u.test(word));
}

function unknownTokens(run: string, known: (word: string) => boolean): ReadonlyArray<string> {
  return (run.match(TOKEN) ?? []).filter((token) => token.length >= MIN_TOKEN && !(token === token.toUpperCase() && token.length <= MAX_ACRONYM) && !LAYER_NOUNS.has(token.toLowerCase()) && !known(token));
}

function isNamedAfter(before: string, after: string): boolean {
  return LATIN_LEAD.test(before) || CJK_LEAD.test(before) || LATIN_TAIL.test(after) || CJK_TAIL.test(after);
}

function startsPhrase(before: string, run: string): boolean {
  return before.trim() === "" && (run.match(TOKEN) ?? []).length >= 2;
}

/** Whether the request names a product that is not one of the effects the user has: an AI tool, or a run of capitalised words after "use", "add" or "apply" (or before "plugin", or at the start of the request) in which a word is no effect word. `known` says whether a word names something the catalogue holds. */
export function namesUnlistedProduct(phrase: string, known: (word: string) => boolean): boolean {
  const folded = foldLetters(phrase);
  const text = folded.replace(LEADING_VERB, (verb) => verb.toLowerCase());
  if (AI_TOOL.test(text)) return true;
  if (isTitleCased(text)) return false;
  return [...text.matchAll(RUN)].some((match) => {
    const before = text.slice(0, match.index);
    const after = text.slice(match.index + match[0].length);
    const unknown = unknownTokens(match[0], known);
    if (unknown.length === 0) return false;
    if (unknown.length >= NAME_UNKNOWNS && !LAYER_LEAD.test(before)) return true;
    return isNamedAfter(before, after) || (startsPhrase(before, match[0]) && unknown.includes(match[0].match(TOKEN)?.[0] ?? ""));
  });
}
