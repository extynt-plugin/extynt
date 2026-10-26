// The words the request deciders read, in English and in the Spanish, German, French and Japanese requests use: refusals, edits, clause breaks, questions, drawing, motion and counted parts.
import { phraseRegex, unionRegex } from "./request-text.js";
import type { Lexicon } from "./request-text.js";

const CUE_PHRASES = [
  "do not", "=not", "without", "avoid", "never", "skip", "remove", "leave out", "leave off", "get rid of", "no need", "instead of", "rather than", "drop the", "lose the",
  "=sin", "nada de", "en vez de", "en lugar de", "ohne", "kein", "nicht", "=nie", "=nunca", "evit", "elimin", "quita", "quitar", "borra", "weglassen", "lass weg", "anstatt", "=statt",
  "verzicht", "entfern", "losch", "=ni", "=sans", "=jamais", "=pas", "=aucun", "supprim", "enlev", "retire", "au lieu de", "ne pas", "pas de", "pas besoin",
  "ない", "なし", "無し", "不要", "外して", "消して", "やめ", "抜き", "せず", "いらない", "要らない", "取り除", "削除", "入れず",
  "不要", "不用", "不需要", "无需", "不必", "请勿", "不加", "不带", "去掉", "去除", "移除", "删除", "删掉", "取消", "没有", "别加", "别用", "别做", "别要", "别给", "而不是", "换掉",
];
const ACT_PHRASES = [
  "add", "make", "give", "use", "apply", "create", "build", "animate", "put", "set", "turn", "have", "includ", "fuge", "mach", "erstell", "animier", "gib", "setz",
  "crea", "anad", "agreg", "anima", "pon", "ajout", "cree", "fais", "donne", "mets", "utilis", "appliqu", "construi", "genere", "haz", "dale", "usa", "aplica", "construy",
  "coloca", "genera", "bau", "benutz", "verwend", "wende", "nimm", "=leg", "gestalte", "anim", "追加", "作", "付け", "入れ", "足し", "加え", "つけ", "使", "適用", "設定", "生成",
  "添加", "加上", "加个", "加一个", "做个", "制作", "创建", "使用", "应用", "设置", "生成", "搭建", "建立", "给它", "让它", "来个", "整个", "做出",
];
const NEGATED_NO = /(?<!there(?:'s|\s+(?:are|is))\s+)(?<![\p{L}\p{N}])no(?![\p{L}\p{N}])(?!\s+(?:haya|hayan|hay|queden|existan|quede|sea|sean)(?![\p{L}\p{N}]))/giu;

const CONJ_PHRASES = [
  "=and", "then", "=plus", "also", "after that", "=und", "dann", "danach", "anschliessend", "=auch", "=y", "luego", "despues", "ademas", "tambien", "=et", "puis", "ensuite", "apres", "aussi",
  "そして", "また", "それから", "その後", "次に", "さらに", "そのうえ", "然后", "接着", "并且", "而且", "以及", "还有", "同时", "再", "并",
];
const BREAK_PHRASES = [
  "=but", "however", "except", "=aber", "=pero", "=mais", "けど", "でも", "=sino", "aunque", "salvo", "excepto", "=sondern", "jedoch", "allerdings", "ausser", "=sauf", "cependant", "toutefois",
  "しかし", "ただし", "だけど", "なしで", "無しで", "抜きで", "ないで", "なくて", "せずに", "但是", "但", "不过", "可是", "然而", "只是", "除了",
];

/** The request's refusal, action, clause-break and conjunction words, as the refusal state reads them. */
export const REQUEST_LEXICON: Lexicon = {
  cue: unionRegex([phraseRegex(CUE_PHRASES), NEGATED_NO]),
  act: phraseRegex(ACT_PHRASES),
  brk: unionRegex([/[.;,!?:、。；！？]/u, phraseRegex(BREAK_PHRASES)]),
  conj: phraseRegex(CONJ_PHRASES),
};

/** Words that start an answer rather than an edit: question words, explain and tell, and a question mark. */
export const ANSWER_PATTERN = unionRegex([phraseRegex([
  "=what", "=which", "=how", "=why", "=does", "=where", "=is it", "=explain", "tell me", "describe", "=wie", "=warum", "=welche", "=wo",
  "=whats", "=wat", "=hows", "=wut", "difference between", "diff between", "differences between", "=diff", "=cuales", "=cuanto", "=cuanta",
  "=cuantos", "=cuantas", "que es", "cual es", "explica", "explicame", "=dime", "por que", "como funciona", "was ist", "was macht",
  "wie viele", "wie funktioniert", "unterschied zwischen", "diferencia entre", "erklar", "¿", "教えて", "説明", "なぜ", "何", "どう", "どこ", "どの",
  "=quien", "que significa", "para que sirve", "que hace", "que diferencia", "cuales son", "=wer", "=wann", "=weshalb", "=wieso", "=womit", "=wofur", "=wozu", "=woher",
  "sag mir", "was bedeutet", "was sind", "was passiert", "gibt es", "=quoi", "=quel", "=quelle", "=quels", "=quelles", "=pourquoi", "=combien", "est ce que", "c est quoi",
  "explique", "expliquer", "dis moi", "difference entre", "differences entre", "comment ca", "comment faire", "comment fonctionne", "comment puis", "a quoi sert", "que signifie",
  "ですか", "ますか", "でしょうか", "とは", "の違い", "違いは", "って何", "いくつ", "どれ", "どんな", "ありますか", "できますか",
  "什么", "为什么", "为何", "怎么", "怎样", "如何", "哪个", "哪些", "哪里", "多少", "吗", "呢", "请问", "告诉我", "解释", "区别", "差别", "有没有", "是什么",
]), /^\s*(?:is|are|does|did|has|was|should)(?![\p{L}\p{N}])/iu]);

/** Praise or thanks, which needs no edit when nothing else asks for one. */
export const PRAISE_PATTERN = phraseRegex(["great", "thanks", "thank you", "awesome", "nice", "perfect", "well done", "good job", "danke", "gracias", "ありがとう",
  "genial", "perfecto", "buen trabajo", "excelente", "=toll", "=prima", "=klasse", "perfekt", "=super", "merci", "parfait", "bravo", "bien joue", "excellent",
  "素晴らしい", "すばらしい", "最高", "いいね", "完璧", "ナイス", "お疲れ", "助かった", "ありがと", "谢谢", "感谢", "太棒", "很好", "不错", "完美", "辛苦了"]);

/** A modal request aimed at the assistant: can you, could you, kannst du, puedes. */
export const EDIT_MODAL_PATTERN = unionRegex([
  /\b(?:can|could|would|will|kannst|konntest|konnten|konntet|wurdest|wurdet|wurden|puedes|podrias|pourrais|peux|pouvez|pourriez)[\s-]+(?:you|du|tu|vous|ihr|sie)\b/giu,
  /\b(?:tu|vous) (?:peux|pouvez|pourrais|pourriez)\b|\b(?:du|ihr) (?:kannst|konntest|konnt|koennt)\b|(?:你|您)(?:能|可以|能够|可不可以)(?:给|帮|把|在|为|替)/giu,
  /\b(?:me puedes|me podrias|podrias|puedes|podrian|pueden|me ayudas|serias capaz de)\s+\p{L}+/giu,
  /能不能|可不可以|可以帮|能帮|能否|可否|麻烦你|麻烦帮|帮我(?:加|做|把|给|添加|创建|设置|调|改|制作)|(?<!教え|知らせ|説明し|見せ|示し|伝え)(?:てくれ|てもらえ|ていただけ|てほしい|て欲しい|てください)/gu,
]);

/** Words that name an edit to the project, used when a request only praises. */
export const EDIT_VERB_PATTERN = phraseRegex([
  "add", "make", "rename", "move", "change", "scale", "trim", "delete", "shift", "fade", "blur", "animat", "bounce", "wiggl", "remove", "hide", "lock", "sort",
  "label", "organi", "set", "place", "duplicat", "parent", "link", "loop", "draw", "design", "produce", "build", "stagger", "ease", "slide", "rotate", "color", "resize",
  "crop", "replace", "turn", "give", "use", "apply", "create", "fuge", "mach", "setz",
  "anad", "agrega", "cambia", "crea", "mueve", "elimina", "borra", "pon", "anima", "renombr", "duplic", "aplica", "usa", "oculta", "bloquea", "ordena", "escala", "gira", "rota",
  "andere", "verschieb", "losch", "entfern", "benenn", "dupliz", "erstell", "verwend", "blende", "sperr", "skalier", "dreh",
  "ajout", "fais", "mets", "change", "supprim", "deplac", "cree", "renom", "dupliqu", "applique", "utilis", "masqu", "verrouill",
  "追加", "作", "変更", "変え", "削除", "移動", "拡大", "縮小", "回転", "複製", "非表示", "ロック", "適用", "設定", "調整",
  "添加", "加上", "创建", "制作", "修改", "改成", "改为", "设置", "删除", "移动", "缩放", "旋转", "复制", "隐藏", "锁定", "重命名", "应用", "调整", "做成", "变成", "换成",
]);

/** Words for the Layer Styles feature and for the styles that exist only as Layer Styles, in each language: their AE menu names (Inner Glow, Bevel and Emboss, Satin, the overlays) and the plain "layer style" wording. A plain Drop Shadow or Outer Glow is not here, because an effect of the same name exists. */
export const LAYER_STYLE_PATTERN = phraseRegex([
  "layer style", "layerstyle", "estilo de capa", "estilos de capa", "ebenenstil", "style de calque", "styles de calque", "style de couche", "レイヤースタイル", "レイヤー スタイル", "レイヤー・スタイル", "图层样式", "图层风格",
  "inner glow", "inner shadow", "bevel and emboss", "emboss", "satin", "color overlay", "gradient overlay", "pattern overlay", "stroke style",
  "sombra interior", "resplandor interior", "bisel y relieve", "satinado", "superposicion de color", "superposicion de degradado",
  "schatten nach innen", "schein nach innen", "abgeflachte kante und relief", "glanz", "farbüberlagerung", "verlaufsüberlagerung",
  "ombre interne", "lueur interne", "biseau et estampage", "incrustation couleur", "incrustation dégradé",
  "シャドウ（内側）", "光彩（内側）", "ベベルとエンボス", "サテン", "カラーオーバーレイ", "グラデーションオーバーレイ",
  "内阴影", "内发光", "斜面和浮雕", "光泽", "颜色叠加", "渐变叠加",
]);

/** Words that point a name at an object that already exists: existing, kept, renamed-from, past context, and the edit verbs (move, hide, duplicate, blur, open, check) that act on a layer rather than make one. */
export const REFERENCE_NAME_WORDS: ReadonlySet<string> = new Set([
  "existing", "existente", "existentes", "vorhanden", "vorhandene", "bestehend", "bestehende", "old", "viejo", "vieja", "alte", "alten", "keep", "keeps", "stay", "stays", "reuse", "rename", "renames", "source",
  "existant", "existante", "ancien", "ancienne", "garde", "renomme", "reutilise", "fuente", "origen", "quelle",
  "used", "previous", "previously", "earlier", "before", "last", "tried", "yesterday", "from", "like", "select", "open", "check", "inspect", "find", "read", "show", "hide", "unhide", "lock", "unlock", "mute", "solo",
  "move", "moves", "shift", "offset", "nudge", "push", "pull", "slide", "delete", "remove", "duplicate", "copy", "clone", "blur", "sharpen", "scale", "rotate", "fade", "trim", "split", "parent", "unparent", "link", "unlink", "animate", "recolor", "recolour", "change", "edit", "update", "fix", "restyle", "resize", "reposition", "align", "center", "centre", "bring", "send",
  "mueve", "mover", "desplaza", "oculta", "ocultar", "muestra", "duplica", "duplicar", "copia", "borra", "elimina", "bloquea", "abre", "revisa", "comprueba", "selecciona", "desenfoca", "escala", "gira", "anima", "cambia", "edita", "usado", "usada", "usaste", "usamos", "anterior", "antes",
  "verschiebe", "verschieb", "verschieben", "versetze", "verstecke", "blende", "dupliziere", "kopiere", "offne", "prufe", "wahle", "losche", "sperre", "skaliere", "drehe", "animiere", "andere", "bearbeite", "benutzt", "verwendet", "vorher", "frueher", "letzten", "vorherigen", "unscharf",
  "deplace", "deplacer", "masque", "cache", "duplique", "copie", "ouvre", "verifie", "selectionne", "supprime", "verrouille", "floute", "decale", "anime", "modifie", "utilise", "precedent", "precedente", "avant",
]);

/** Words that introduce a name a request asks to be created: a create verb, a new thing, or a naming word. */
export const CREATE_NAME_WORDS: ReadonlySet<string> = new Set([
  "create", "creates", "make", "makes", "build", "builds", "add", "new", "crea", "erstelle", "erstell",
  "neue", "neuen", "neues", "erzeuge", "nueva", "nuevo", "nouvelle", "nouveau",
  "generate", "generates", "setup", "spawn", "insert", "adds", "crear", "genera", "anade", "agrega", "construye", "haz", "hacer", "pon",
  "lege", "anlegen", "erstellen", "erzeugen", "baue", "fuge", "fugt", "cree", "creer", "creez", "genere", "ajoute", "ajouter", "fais", "faire", "fabrique", "construis",
]);

/** Words that give a thing its name (named, called, namens, nomme, llamada): they say the name is the thing's, not whether the thing is made or already there. */
export const NAME_LINK_WORDS: ReadonlySet<string> = new Set([
  "named", "called", "call", "name", "titled", "label", "labelled", "labeled", "llamada", "llamado", "llamados", "llamadas", "llama", "nombrada", "nombre", "titulada", "titulado",
  "benannt", "namens", "namen", "genannt", "heisst", "nomme", "nommee", "nom", "appele", "appelee", "appelle", "intitule", "intitulee",
]);

/** Drawing verbs and their informal forms (doodle, scribble, draw out, hand-drawn) in English, Spanish, German, French, Japanese and Chinese; a drawn participle counts too. A Latin stem starts a word (after at most a separable prefix), so it is not read inside a compound noun or another word (Weichzeichner, withdraw, normalen); a Chinese or Japanese verb is not read inside a noun (描边, 描画モード, 動画一括). */
export const DRAW_VERB_PATTERN = new RegExp(
  "(?<![a-z])(?:nach|ein|auf|ab|an|vor|aus|um|durch|hin|her|re|over|out)?(?:draw|paint|illustrat|sketch|doodl|scribbl|depict|zeichn|skizzier|kritzel|malen|gemalt|aufmal|dibuj|pint|ilustr|garabat|boceta|esboz|dessin|peign|peind|croqu|griffon)[a-z]*"
    + "|描(?!边|邊|述|写|寫|画モード|画順|画設定)|手描|落書|スケッチ|線画|描画(?!モード|順|設定)|绘制|绘画|描绘|手绘|涂鸦|素描|勾画|绘出"
    + "|(?<![动動映録录计計企规規漫插])画(?:一|个|出|张|只|条|成|下来|了)",
  "giu",
);

/** Words for a drawing idiom that is not a picture: draw attention, draw the eye, draw a conclusion. */
export const DRAW_IDIOM_PATTERN = /^\s*(?:the\s+|a\s+)?(?:attention|focus|eyes?|viewers?|audience|conclusions?|comparisons?|inspiration|parallels?|connections?|up\b|back\b)/iu;

/** Nouns that name a picture to be drawn, even without a drawing verb. */
export const DRAWABLE_PATTERN = phraseRegex([
  "skyline", "landscape", "paisaje", "landschaft", "paysage", "mascot", "mascota", "maskottchen", "artwork", "logo mark", "illustration", "personaje",
  "personnage", "イラスト", "街並み", "風景", "キャラクター",
  "cityscape", "scenery", "seascape", "cartoon", "creature", "ilustracion", "dibujo", "caricatura", "dibujos animados", "atardecer", "horizonte urbano",
  "zeichnung", "stadtansicht", "gemalde", "sonnenuntergang", "comicfigur", "mascotte", "caricature", "coucher de soleil", "panorama urbain", "horizon urbain",
  "マスコット", "似顔絵", "夕焼け", "夕日", "夕暮れ", "絵を", "挿絵", "スカイライン", "キャラ",
  "风景", "景观", "天际线", "城市夜景", "插画", "插图", "卡通", "漫画", "角色", "吉祥物", "日落", "夕阳", "星空", "森林", "海边", "人物画",
]);

/** Nouns of plain shapes, which a drawing verb draws without a picture. */
export const SHAPE_PATTERN = phraseRegex([
  "line", "circle", "rectangle", "square", "arrow", "shape", "stroke", "dot", "bar", "box", "triangle", "ellipse", "oval",
  "linea", "circulo", "rectangulo", "cuadrado", "flecha", "=forma", "=formas", "trazo", "punto", "barra", "caja", "triangulo", "elipse",
  "linie", "kreis", "rechteck", "quadrat", "pfeil", "=form", "=formen", "strich", "punkt", "balken", "dreieck",
  "ligne", "cercle", "rectangle", "carre", "fleche", "=forme", "=formes", "trait", "=point", "barre", "boite", "triangle",
  "円", "四角", "矢印", "図形", "長方形", "線", "丸", "三角", "ライン", "ボックス", "ドット", "バー", "楕円",
  "圆", "线", "圈", "方形", "矩形", "三角", "箭头", "线条", "形状", "圆圈", "方框", "星形", "椭圆",
]);

/** Nouns of layers and footage, which a drawing verb or a picture noun does not make a picture of. */
export const ARRANGED_PATTERN = phraseRegex([
  "layer", "footage", "clip", "video", "solid", "precomp", "title", "text", "subtitle", "lower third", "capa", "titel", "titulo", "texto", "タイトル", "レイヤー", "ebene",
  "calque", "metrage", "sous-titre", "sous titre", "texte", "plano de color", "video", "untertitel", "schrift", "ebenen", "pieza",
  "テキスト", "字幕", "素材", "映像", "ビデオ", "平面", "图层", "文字", "标题", "素材", "视频", "剪辑", "纯色", "预合成", "字幕", "文本",
]);

const ANIMATION_STEM = /\banim(?!al(?:es?)?\b)\p{L}*/giu;

/** Words for an animated, eased or timed change of a layer: an animation stem in any language (animate, anímalo, animiere), bounce, easing and timing words. */
export const MOTION_PATTERN = unionRegex([phraseRegex([
  "animat", "animier", "bounce", "bounc", "rebot", "hupf", "prall", "バウンス", "バウンド", "跳ね", "ease", "easing", "イージング", "overshoot", "settle", "stagger",
  "cascade", "timing", "spring", "suavi", "interpol", "beschleunig", "elast", "asient", "federn", "=slide", "=slides", "sliding", "reveal", "shake", "rhythm", "floaty",
  "kinetic", "fade", "drift", "sting", "=hold", "=holds", "=hit", "=hits", "=beat", "=beats",
  "アニメ", "rebond", "fondu", "glisse", "apparition", "rythme", "ressort", "acceler", "ralenti", "elastique", "decal", "einblend", "ausblend", "gleiten", "abprall", "schwung",
  "rhythmus", "zeitversetzt", "uberschwing", "verlangsam", "aparece", "desaparece", "desliz", "desvanec", "entrada animada", "ralentiz", "acelera",
  "フェードイン", "フェードアウト", "スライドイン", "弾む", "弾ま", "バネ", "オーバーシュート", "時間差", "リズム", "加速", "減速", "イーズ",
  "动画", "动效", "动起来", "弹跳", "缓动", "缓入", "缓出", "淡入", "淡出", "滑入", "滑出", "弹性", "弹簧", "回弹", "过冲", "错开", "节奏", "加速", "减速",
]), ANIMATION_STEM]);

/** Words for an expression: a wiggle, a loop, a link, a counter or a value that is driven by another. */
export const EXPRESSION_PATTERN = phraseRegex([
  "expression", "wiggl", "loop", "forever", "link", "counts up", "count up", "count down", "driven by", "slider", "without keyframes", "ausdruck", "expresion",
  "エクスプレッション", "ループ", "数式", "式を書", "式で",
  "boucle", "en boucle", "compteur", "sans images cles", "bucle", "enlaza", "vincula", "contador", "sin fotogramas clave", "para siempre",
  "schleife", "endlos", "verknupf", "zahler", "ohne keyframes", "連動", "カウントアップ", "カウントダウン", "無限",
  "表达式", "循环", "无限", "永远", "永久", "联动", "关联", "计数器", "倒计时", "不用关键帧", "无需关键帧", "链接",
]);

/** Words for a check of finished frames or footage. */
export const REVIEW_PATTERN = phraseRegex([
  "review", "check", "verify", "look at", "inspect", "audit", "go through", "flag any", "proofread", "double-check", "scan", "prufe", "revis", "verific",
  "compruebe", "確認", "検証",
  "comprueb", "chequea", "inspeccion", "audita", "repasa", "uberpruf", "kontrollier", "durchsehen", "gegenlesen", "verifie", "controle", "inspecte", "examine", "relis", "passe en revue",
  "チェック", "点検", "見直", "レビュー", "確かめ", "检查", "核对", "校对", "审查", "审核", "验证", "复查",
]);

/** Words for a judgement of how a result looks or feels, which a design-minded agent makes. */
export const JUDGEMENT_PATTERN = phraseRegex([
  "premium", "look", "feel", "judgement", "judgment", "design", "disen", "gestalt", "entwirf", "entwerf", "デザイン", "mood", "vibe", "polish", "elegant", "cinematic",
  "dramatic", "professional",
  "haut de gamme", "cinematograph", "dramatique", "professionnel", "ambiance", "luxe", "cinematograf", "dramatico", "profesional", "ambiente", "lujo", "estetica",
  "filmisch", "dramatisch", "professionell", "stimmung", "hochwertig", "luxur", "edel",
  "高級", "おしゃれ", "オシャレ", "洗練", "かっこいい", "映画的", "シネマティック", "ドラマチック", "雰囲気", "ムード", "エレガント",
  "高级", "高端", "质感", "氛围", "电影感", "电影般", "大气", "优雅", "专业", "设计感", "时尚",
]);

/** Words for a part of a long request: a section, shot, scene, card, deliverable, episode, chapter, slide or sequence. */
export const SECTION_PATTERN = phraseRegex([
  "section", "shot", "scene", "card", "deliverable", "episode", "chapter", "slide", "sequence", "seccion", "escena", "tarjeta", "abschnitt", "szene", "karte",
  "セクション", "シーン", "カット", "カード",
  "entregable", "capitulo", "secuencia", "diapositiva", "kapitel", "sequenz", "folie", "etappe", "=carte", "=cartes", "etape", "partie", "chapitre", "diapositive", "livrable",
  "場面", "チャプター", "スライド", "パート", "シーケンス", "场景", "镜头", "段落", "章节", "幻灯片", "分镜", "片段", "环节",
]);

/** Words that give each part of a request its own build. */
export const EACH_PATTERN = phraseRegex(["each", "every", "jede", "cada", "jeder", "各", "毎", "jedes", "jeden", "jedem", "todos los", "todas las", "=alle", "chaque", "tous les", "toutes les", "それぞれ", "各々", "每个", "每一", "各个", "每页", "每段", "每场", "每组"]);

/** The punctuation and conjunctions that separate the parts of a list: commas, semicolons, and, und, y, et; a conjunction after a comma joins the same separator and is not counted twice. */
export const ENUMERATION_PATTERN = /[;、，；]|,(?=\s*\p{L})|(?<!,\s*)\b(?:and|und|y|et|sowie)\b|(?<![柔温缓平暖融调混附])和(?![谐])|以及|还有|および/giu;
