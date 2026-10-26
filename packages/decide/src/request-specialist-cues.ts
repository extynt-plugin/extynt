// The cues each specialist role needs in its own right, in English, Spanish, German, French and Japanese: a plan or outline, a check for typos and errors, an expression, a build in stages, and motion.
import { countedPartCount, listMarkerCount, paragraphCount, timingCount } from "./request-structure.js";
import { withKana } from "./request-kana.js";
import { isStagedProduction } from "./request-production.js";
import { TIMED_SPAN } from "./request-timed-span.js";
import { asksFor, containsWord, foldRequest, phraseRegex, unionRegex } from "./request-text.js";
import { ENUMERATION_PATTERN, MOTION_PATTERN, REQUEST_LEXICON, REVIEW_PATTERN } from "./request-vocabulary.js";

const PLANNED_COUNTED_PARTS = 3;
const PLANNED_ENUMERATIONS = 2;
const BUILD_PARAGRAPHS = 3;

const PLAN_CUE: RegExp = unionRegex([
  phraseRegex([
    "=plan", "=plans", "=planning", "storyboard", "shot list", "=breakdown", "=checklist", "=roadmap", "map out", "beat sheet", "=itinerary", "a list of", "list them",
    "list these", "list each", "list in order", "planif", "=planea", "=planear", "esquema", "=planung", "=planen", "=gliederung", "ablaufplan", "plane die", "planst",
    "une liste", "una lista", "eine liste", "計画", "プラン", "絵コンテ", "リスト", "一覧",
    "planifier", "planifie", "feuille de route", "decoupage", "scenarimage", "plan d action", "guion grafico", "hoja de ruta", "lista de", "desglose", "planifica", "drehbuch", "fahrplan", "aufstellung", "auflistung",
    "コンテ", "段取り", "工程表", "ロードマップ", "チェックリスト", "手順", "计划", "规划", "分镜", "故事板", "清单", "大纲", "路线图",
  ]),
  /(?<!\b(?:an?|the|add|adds|adding|with|of|its|their|your|my)\s+)\boutlin(?:e|es|ed|ing)\b(?!\s+(?:of|around|on|stroke|the\s+(?:shape|logo|outline|text|mark|letters?|title)|a\s+(?:shape|stroke)))/giu,
]);

const PROOF_CUE: RegExp = unionRegex([
  phraseRegex([
    "typo", "spelling", "spell check", "spellcheck", "misspell", "grammar", "proofread", "proof-read", "proofing", "errors", "mistakes", "tippfehler",
    "rechtschreib", "grammatik", "faute", "orthographe", "fautes", "ortograf", "faltas", "errores", "誤字", "誤植", "スペル", "校正",
    "coquille", "relecture", "erratas", "korrekturles", "fehler", "間違い", "错别字", "拼写", "校对", "语法", "笔误", "错字",
  ]),
  /\bproof (?:the|all|every|each|my|this|these|it|everything|our|your)\b/giu,
]);

const EXPRESSION_CUE: RegExp = unionRegex([
  phraseRegex([
    "expression", "wiggl", "without keyframes", "counts up", "count up", "count down", "counts down", "driven by", "link", "ausdruck", "expresion",
    "vincul", "enlaza", "boucle", "verknupf", "schleife", "エクスプレッション", "リンク", "連動", "数式", "式を書",
    "compteur", "sans images cles", "bucle", "contador", "sin fotogramas clave", "endlos", "zahler", "ohne keyframes", "カウントアップ", "カウントダウン",
    "表达式", "循环", "联动", "关联", "计数器", "倒计时", "不用关键帧", "无需关键帧", "链接", "永远",
  ]),
  /\b(?:loop|cycle|rotate|spin|turn|move|pulse)\p{L}*\s+(?:forever|endlessly|indefinitely|continuously)\b|\b(?:forever|endlessly|indefinitely)\b/giu,
]);

const STAGED_CUE: RegExp = unionRegex([
  phraseRegex(["stage", "in order", "depend", "one at a time", "step", "sequential", "schrittweise", "nacheinander", "por etapas", "par etapes", "段階", "順番",
    "etape par etape", "un par un", "dans l ordre", "paso a paso", "uno por uno", "en orden", "en fases", "der reihe nach", "stufenweise", "phasenweise",
    "順に", "一つずつ", "1つずつ", "ステップ", "工程", "分步", "一步一步", "逐步", "依次", "按顺序", "分阶段", "一个一个", "一步步"]),
  /\bproofs? (?:for|of|per|after|before)\b/giu,
]);

const MOTION_CUE: RegExp = unionRegex([
  MOTION_PATTERN,
  phraseRegex([
    "desliz", "desvanec", "fundid", "fundir", "movimient", "velocidad", "ritmo", "transicion", "acelera", "ralentiz", "einblend", "ausblend",
    "uberblend", "bewegung", "tempo", "rhythmus", "einflieg", "schweb", "verzoger", "rebond", "fondu", "glisse", "mouvement", "transition",
    "rythme", "accelere", "ralenti", "動き", "動か", "モーション", "フェード", "スライド", "タイミング", "イーズ", "揺れ",
    "pulse", "oscill", "flotte", "apparition", "disparition", "pulsa", "oscila", "flota", "pulsier", "schwebt", "パルス", "浮遊", "ふわっと", "ぷるぷる",
    "飞入", "飞出", "弹出", "漂浮", "脉冲", "摆动", "晃动", "滑动", "动一动",
  ]),
]);

const EDGE = "(?<![\\p{L}\\p{N}])";
const PLURAL_PARTS = "(?:sections|shots|scenes|cards|deliverables|episodes|chapters|sequences|stages|parts|abschnitte|szenen|karten|secciones|escenas|tarjetas|cartes|etapes|chapitres|livrables|capitulos|secuencias|entregables|kapitel|sequenzen|etappen)";
const PART_NOUN = "(?:sections?|shots?|scenes?|cards?|deliverables?|episodes?|chapters?|slides?|sequences?|stages?|steps?|parts?|abschnitt\\p{L}*|szene\\p{L}*|karte\\p{L}*|secci\\p{L}*|escena\\p{L}*|tarjeta\\p{L}*|carte\\p{L}*|etape\\p{L}*|chapitre\\p{L}*|livrable\\p{L}*|partie\\p{L}*)";
const PART_NOUN_JA = "(?:セクション|シーン|カット|カード)";
const PART_JA_STANDALONE = "(?:セクション|シーン|カット|场景|镜头|分镜|段落|章节|幻灯片|片段|环节)";
const EACH_WORDS = "(?:each|every|jede[rns]?|cada|chaque|各|毎|每个|每一|各个|それぞれ|各々)";

const PART_WORDS: RegExp = unionRegex([
  withKana(new RegExp(`${EDGE}${PLURAL_PARTS}(?![\\p{L}\\p{N}])|${PART_JA_STANDALONE}`, "giu")),
  phraseRegex(["intro", "outro", "opener", "bumper", "verse", "chorus", "end card", "introduccion", "einleitung", "abspann", "generique", "イントロ", "アウトロ"]),
  withKana(new RegExp(`${EDGE}${EACH_WORDS}\\s+(?:\\p{L}+\\s+){0,2}${PART_NOUN}(?![\\p{L}\\p{N}])|${EACH_WORDS}\\s*${PART_NOUN_JA}`, "giu")),
]);


function countedParts(request: string): number {
  return countedPartCount(request.replace(TIMED_SPAN, " "));
}

function multiPartRequest(request: string): boolean {
  const text = foldRequest(request);
  const listed = [...text.matchAll(ENUMERATION_PATTERN)].length >= PLANNED_ENUMERATIONS;
  return countedParts(request) >= PLANNED_COUNTED_PARTS || (listed && containsWord(text, PART_WORDS));
}

const PLAN_OBJECT = "(?:plan|plans|storyboard\\p{L}*|outline\\p{L}*|checklist|breakdown|roadmap|shot list|list|itinerary)";

const BUILD_CUE: RegExp = unionRegex([
  new RegExp(`(?<!\\b(?:the|a|an|of|your|my|this|that|its)\\s+)\\b(?:build|builds|building|construct(?:s|ed|ing)?|assembl(?:e|es|ed|ing)|produc(?:e|es|ed|ing)|make|makes|making|create|creates|creating)\\b(?!\\s+(?:\\p{L}+\\s+){0,2}?${PLAN_OBJECT}\\b)`, "giu"),
  phraseRegex(["baue", "erstell", "construy", "=crea", "=creo", "fabriqu", "construi", "作って", "作成", "作る", "=cree", "=fais", "realise", "=monte", "genere", "=haz", "hacer", "genera", "elabora", "=mach", "gestalte", "generier", "realisier", "作り", "制作", "構築", "つくって", "組んで", "创建", "搭建", "做一个", "做个", "生成", "构建", "建一个", "新建", "做出", "做成"]),
]);

function planCueAsked(request: string): boolean {
  return asksFor(foldRequest(request), PLAN_CUE, REQUEST_LEXICON);
}

/** Whether a request asks for a plan or outline, or is built from several named parts that need planning. */
export function plansRequest(request: string): boolean {
  return planCueAsked(request) || multiPartRequest(request) || isStagedProduction(request);
}

function buildAsked(request: string): boolean {
  return asksFor(foldRequest(request), BUILD_CUE, REQUEST_LEXICON) || motionRequest(request);
}

function plannedOnly(request: string): boolean {
  return (planCueAsked(request) || checksRequest(request)) && !buildAsked(request);
}

const BUILD_ENUMERATIONS = 3;
const BUILD_COUNTED_PARTS = 4;
const BUILD_TIMINGS = 3;

function longBuildRequest(request: string): boolean {
  const text = foldRequest(request);
  const listed = [...text.matchAll(ENUMERATION_PATTERN)].length >= BUILD_ENUMERATIONS;
  return countedParts(request) >= BUILD_COUNTED_PARTS || timingCount(request) >= BUILD_TIMINGS || paragraphCount(request) >= BUILD_PARAGRAPHS
    || listMarkerCount(request) > 0 || (listed && containsWord(text, PART_WORDS));
}

/** Whether a request asks for something to be built or animated in stages: a build with an order, a dependency or a proof, or a long build; a plan or review alone is not a build, but a plan of an animated piece is. */
export function stagesRequest(request: string): boolean {
  const staged = asksFor(foldRequest(request), STAGED_CUE, REQUEST_LEXICON) || longBuildRequest(request);
  return (staged && !plannedOnly(request)) || (planCueAsked(request) && motionRequest(request)) || isStagedProduction(request);
}

/** Whether a request asks for motion of a layer, in any of the five languages; a refused motion is not asked. */
export function motionRequest(request: string): boolean {
  return asksFor(foldRequest(request), MOTION_CUE, REQUEST_LEXICON);
}

/** Whether a request asks for a check of finished work: a review, a check, or a proof of typos and spelling. */
export function checksRequest(request: string): boolean {
  const text = foldRequest(request);
  return asksFor(text, unionRegex([PROOF_CUE, REVIEW_PATTERN]), REQUEST_LEXICON);
}

/** Whether a request asks for an expression: an explicit wiggle, link, counter, driven value or forever loop. */
export function expressionRequest(request: string): boolean {
  return asksFor(foldRequest(request), EXPRESSION_CUE, REQUEST_LEXICON);
}
