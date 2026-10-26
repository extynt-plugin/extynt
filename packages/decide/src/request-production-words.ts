// The words that mark a staged production: a completeness word, a production noun, a deliverable noun, a version noun, a build verb, a qualifier of a deliverable, a repeat word and a count word, in English, Spanish, German, French, Japanese and Chinese.
import { phraseRegex } from "./request-text.js";

/** Words for a whole piece: complete, full, whole, entire, start to finish, from scratch, in each language. */
export const COMPLETENESS_PATTERN = phraseRegex([
  "=complete", "=full", "=whole", "=entire", "from start to finish", "end to end", "from scratch",
  "=completo", "=completos", "=completa", "=completas", "=entero", "=entera", "de principio a fin", "de inicio a fin", "desde cero", "=todo el", "=toda la",
  "komplett", "vollständig", "=ganze", "=ganzen", "gesamt", "von anfang bis ende",
  "=complet", "=complets", "=completes", "=entier", "=entiere", "=entieres", "=tout le", "=toute la", "du debut a la fin", "de bout en bout", "de zero",
  "完全な", "完全版", "丸ごと", "全体の", "最初から最後まで", "ゼロから", "一式",
  "完整", "整个", "全套", "从头到尾", "从零开始", "端到端", "一整套",
]);

/** Nouns of a piece that is delivered as a whole: a video, a film, an intro, a title sequence, a package, a campaign, a project. */
export const PRODUCTION_PATTERN = phraseRegex([
  "=video", "=videos", "=film", "=films", "=promo", "=promos", "=intro", "=intros", "=opener", "=openers", "title sequence", "=credits", "=package", "=packages",
  "=campaign", "=campaigns", "=project", "=projects", "=trailer", "=trailers", "=commercial", "=commercials", "=explainer", "set of",
  "=pelicula", "=peliculas", "=apertura", "=creditos", "=paquete", "=campana", "=campanas", "=proyecto", "=anuncio", "secuencia de titulos",
  "=vorspann", "titelsequenz", "=abspann", "=paket", "=kampagne", "=projekt", "=werbespot", "=filme",
  "=generique", "sequence de titre", "=pack", "=campagne", "=projet", "spot publicitaire", "bande annonce", "=projets",
  "動画", "ビデオ", "映像", "映画", "プロモ", "イントロ", "オープニング", "タイトルシーケンス", "エンドロール", "クレジット", "パッケージ", "キャンペーン", "プロジェクト", "予告編", "ムービー",
  "视频", "影片", "电影", "宣传片", "预告片", "片头", "片尾", "开场", "项目", "工程", "系列", "套装", "广告", "合集",
]);

/** Nouns of one deliverable: an icon, a logo, a card, a slide, a scene, a transition, a variant or a version, each as a whole word or a whole plural. */
export const DELIVERABLE_PATTERN = phraseRegex([
  "=icon", "=icons", "=logo", "=logos", "=variant", "=variants", "=version", "=versions", "=size", "=sizes", "=scene", "=scenes", "=shot", "=shots",
  "=card", "=cards", "=slide", "=slides", "=clip", "=clips", "=piece", "=pieces", "=asset", "=assets", "=animation", "=animations", "=title", "=titles",
  "=template", "=templates", "=sticker", "=stickers", "=button", "=buttons", "=banner", "=banners", "=thumbnail", "=thumbnails", "=graphic", "=graphics",
  "=transition", "=transitions", "=section", "=sections", "=deliverable", "=deliverables", "=format", "=formats", "=cut", "=cuts", "=lower third", "=lower thirds",
  "=iconos", "=versiones", "=tamanos", "=escenas", "=planos", "=tarjetas", "=diapositivas", "=piezas", "=recursos", "=animaciones",
  "=titulos", "=plantillas", "=botones", "=miniaturas", "=graficos", "=transiciones", "=secciones", "=formatos", "=cortes",
  "=symbole", "=varianten", "=versionen", "=größen", "=szenen", "=karten", "=folien", "=teile", "=animationen", "=titel", "=vorlagen",
  "=miniaturen", "=grafiken", "=übergänge", "=abschnitte", "=formate", "=schnitte",
  "=icones", "=tailles", "=plans", "=diapositives", "=pieces", "=titres", "=modeles", "=boutons", "=bannieres", "=vignettes", "=graphismes",
  "=transitions", "=coupes",
  "アイコン", "ロゴ", "バリエーション", "バージョン", "サイズ", "シーン", "カット", "カード", "スライド", "クリップ", "アニメーション", "タイトル",
  "テンプレート", "ボタン", "バナー", "サムネイル", "トランジション", "セクション", "フォーマット", "アスペクト比",
  "图标", "标志", "变体", "版本", "尺寸", "场景", "镜头", "卡片", "幻灯片", "片段", "动画", "标题", "模板", "按钮", "横幅", "缩略图", "转场", "章节", "格式", "宽高比", "画幅",
]);

/** Nouns of versions of one piece: aspect ratios, versions, variants, formats, cuts and sizes. */
export const VERSION_PATTERN = phraseRegex([
  "aspect ratio", "=version", "=versions", "=variant", "=variants", "=format", "=formats", "=cut", "=cuts", "=size", "=sizes",
  "=relacion de aspecto", "=relaciones de aspecto", "=versiones", "=variantes", "=formatos", "=cortes", "=tamanos",
  "=seitenverhaltnis", "=seitenverhaltnisse", "=versionen", "=varianten", "=formate", "=schnitte", "=größen",
  "=ratio", "=ratios", "=coupes", "=tailles",
  "アスペクト比", "バージョン", "バリエーション", "フォーマット", "版本", "变体", "宽高比", "画幅", "格式", "尺寸",
]);

/** Verbs that ask for a thing to be made: make, build, create, produce, animate, design, put together, and their forms in the other five languages. */
export const BUILD_PATTERN = phraseRegex([
  "=make", "=makes", "=build", "=builds", "=rebuild", "=rebuilds", "=create", "=creates", "=produce", "=produces", "=generate", "=assemble",
  "=animate", "=animates", "=design", "=designs", "put together", "do me", "design me",
  "=haz", "=hazme", "=hacer", "=crea", "=creame", "=crear", "=construye", "=genera", "=rehaz",
  "=mach", "=mache", "=machen", "=erstell", "=erstelle", "=erstellen", "=baue", "=bau", "=bauen", "=erzeuge", "=gestalte",
  "=fais", "=faites", "=cree", "=crees", "=creer", "=construis", "=genere", "=refais", "=fabrique", "=realise", "=realiser",
  "作って", "作る", "作成", "制作", "作り", "作れ", "作り直", "生成", "構築",
  "做", "制作", "创建", "生成", "搭建", "构建", "改成", "做成",
]);

/** The word before a whole piece that makes it a target already named ("the whole video", "das ganze Video", "la vidéo entière"), so an edit to it is not a production. */
export const DEFINITE_WORDS: ReadonlySet<string> = new Set([
  "the", "this", "that", "my", "our", "your", "its", "his", "her", "their",
  "el", "la", "los", "las", "mi", "mis", "su", "sus", "este", "esta", "ese", "esa",
  "der", "die", "das", "den", "dem", "meine", "meinen", "diese", "dieses", "dieser",
  "le", "les", "mon", "ma", "mes", "ce", "cet", "cette", "ces", "son", "sa", "ses", "du",
]);

/** Chinese and Japanese words that mark a whole piece as a target, read in the few characters before it. */
export const CJK_DEFINITE_PATTERN: RegExp = phraseRegex(["这个", "那个", "这段", "那段", "我的", "把", "将", "この", "その", "あの"]);

/** Words that say a deliverable is animated, looped, designed or part of a set: each of a count of five to seven needs one of them near its noun. */
export const QUALIFIER_PATTERN: RegExp = phraseRegex([
  "=animated", "=looping", "=looped", "=designed", "each with", "set of", "=variants", "=versions", "=scenes", "lower third", "lower thirds", "=slides",
  "=animados", "=animadas", "en bucle", "=disenados", "=disenadas", "cada uno con", "juego de", "=variantes", "=versiones", "=escenas", "tercio inferior", "=diapositivas",
  "=animiert", "=animierte", "=animierten", "in schleife", "=schleife", "=entworfen", "jede mit", "jeder mit", "jedes mit", "satz von", "=varianten", "=versionen", "=szenen", "untere drittel", "=folien",
  "=anime", "=animees", "=animes", "en boucle", "=concus", "=concue", "=concues", "chacun avec", "chacune avec", "jeu de", "=variantes", "=versions", "=scenes", "tiers inferieur", "=diapositives",
  "アニメーション付き", "アニメ付き", "ループ", "デザインした", "それぞれ", "セット", "バリエーション", "バージョン", "シーン", "ロワーサード", "スライド",
  "动画", "循环", "设计", "每个", "一套", "变体", "版本", "场景", "下三分之一", "幻灯片", "带动画",
]);

/** Words that make a count a copy count, never new deliverables: copies, duplicates, repeats, times. */
export const REPEAT_PATTERN: RegExp = phraseRegex([
  "=copy", "=copies", "=copie", "=duplicate", "=duplicates", "=duplicated", "=duplicating", "=repeat", "=repeats", "=repeated", "=times", "=clone", "=clones",
  "=kopie", "=kopien", "=duplizieren", "=wiederholung", "=wiederholungen", "=copias", "=copia", "=duplicados", "=duplicar", "=repetir", "=veces",
  "=doublons", "=dupliquer", "=repeter", "=fois", "=exemplaires",
  "コピー", "複製", "繰り返し", "复制", "副本", "重复",
]);

const NUMBER_WORD_VALUES: ReadonlyArray<readonly [string, number]> = [
  ["two", 2], ["three", 3], ["four", 4], ["five", 5], ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9], ["ten", 10], ["eleven", 11], ["twelve", 12],
  ["dos", 2], ["tres", 3], ["cuatro", 4], ["cinco", 5], ["seis", 6], ["siete", 7], ["ocho", 8], ["nueve", 9], ["diez", 10], ["once", 11], ["doce", 12],
  ["zwei", 2], ["drei", 3], ["vier", 4], ["funf", 5], ["sechs", 6], ["sieben", 7], ["acht", 8], ["neun", 9], ["zehn", 10], ["elf", 11], ["zwolf", 12],
  ["deux", 2], ["trois", 3], ["quatre", 4], ["cinq", 5], ["six", 6], ["sept", 7], ["huit", 8], ["neuf", 9], ["dix", 10], ["onze", 11], ["douze", 12],
  ["二", 2], ["两", 2], ["三", 3], ["四", 4], ["五", 5], ["六", 6], ["七", 7], ["八", 8], ["九", 9], ["十", 10], ["十一", 11], ["十二", 12],
];

/** The value of each spelled-out count, keyed by its folded, lowercase form. */
export const NUMBER_WORDS: ReadonlyMap<string, number> = new Map(NUMBER_WORD_VALUES);

const byLengthDescending = (words: ReadonlyArray<string>): string => [...words].sort((first, second) => second.length - first.length).join("|");
const LATIN_NUMBERS = NUMBER_WORD_VALUES.map(([word]) => word).filter((word) => /^[a-z]+$/.test(word));
const CJK_NUMBERS = NUMBER_WORD_VALUES.map(([word]) => word).filter((word) => !/^[a-z]+$/.test(word));

/** A spelled-out count: a whole Latin word, or a Chinese or Japanese numeral with no word edges. */
export const NUMBER_WORD_PATTERN: RegExp = new RegExp(`(?<![\\p{L}\\p{N}])(?:${byLengthDescending(LATIN_NUMBERS)})(?![\\p{L}\\p{N}])|${byLengthDescending(CJK_NUMBERS)}`, "giu");
