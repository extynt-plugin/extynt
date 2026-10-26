// Small multilingual concept tables for reading a motion designer's goal: each concept lists the folded roots and whole words that name it in English, Spanish, German and Japanese.
/** The concepts a goal clause can name; the first group is what the evidence decisions read, the second is structure the review pre-screen can prove by receipts. */
export type GoalConcept =
  | "motion" | "sequence" | "counting" | "transform" | "look" | "colour" | "layout" | "judgement" | "purpose"
  | "name" | "comp" | "parent" | "marker" | "folder" | "timing" | "text" | "attribute";

/** The words that name one concept: folded prefixes or phrases (`roots`) and whole folded words (`words`). */
export type ConceptEntry = { readonly roots: ReadonlyArray<string>; readonly words: ReadonlyArray<string> };

const MOTION_ENTRY: ConceptEntry = {
  roots: [
    "animat", "anima", "keyframe", "ease", "easing", "velocity", "parallax", "trail", "transition", "fad", "appear", "erscheint", "erscheinen", "disappear",
    "slide", "sliding", "bounce", "rebot", "pulse", "flash", "blink", "parpade", "flicker", "wipe", "reveal", "stagger", "cascade", "delay", "swing", "schwing",
    "wobble", "shake", "drift", "orbit", "kreis", "loop", "bucle", "repet", "time", "over time", "einblend", "ausblend", "fundid", "aparec", "desaparec", "desliz",
    "gleit", "hupf", "schleif", "later", "spater", "despues", "rebote",
    "フェード", "アニメ", "徐々", "ループ", "スライド", "点滅", "出現", "登場", "現れ", "バウンス", "揺", "弾む",
    "animer", "anime", "animation", "fondu", "apparai", "apparit", "disparai", "disparu", "glisse", "glisser", "rebond", "pulsation", "clignot", "defil", "balayage", "decalage", "decale", "retard", "boucle", "bouclage", "repetition", "mouvement", "ralenti", "acceler", "progressiv", "peu a peu", "petit a petit", "oscill", "tremble", "secou", "flotte", "ondul", "a l entree", "image cle", "sautille", "pendule", "dans le temps",
    "oscil", "temblor", "sacud", "flotan", "ralent", "aceler", "gradual", "poco a poco", "salta", "retras", "desfase", "escalonad", "cascada", "en bucle", "ciclo", "movimiento", "se mueve", "latido",
    "animier", "verblass", "taucht auf", "tauch auf", "erschein", "verschwind", "spring", "federn", "pulsier", "puls", "blink", "flacker", "zitter", "wackel", "pendel", "schweb", "treib", "verzoger", "versetzt", "zeitversetzt", "langsam", "beschleunig", "abbrems", "allmahlich", "nach und nach", "schrittweise", "bewegung", "uber zeit", "zeitlich", "schleife", "wiederhol", "endlos", "dauerschleife", "fliegt", "fliess",
    "動き", "動く", "イージング", "緩急", "イーズ", "加速", "減速", "ゆっくり", "だんだん", "少しずつ", "ふわっと", "現れる", "消える", "消え", "出てくる", "飛び出", "跳ね", "バウンド", "ポップ", "点灯", "明滅", "ちらつ", "ブリンク", "パルス", "脈動", "揺れ", "振動", "シェイク", "公転", "周回", "繰り返", "遅延", "ディレイ", "ずらし", "時間差", "スタガー", "ワイプ", "トランジション", "遷移", "スクロール", "ウィグル", "ワイグル", "ふわふわ", "浮遊", "流れる", "入ってくる", "キーフレーム", "モーション",
    "动画", "动起来", "动态", "运动", "淡入", "淡出", "渐入", "渐出", "渐渐", "逐渐", "慢慢", "缓入", "缓出", "缓动", "缓和", "弹跳", "回弹", "弹出", "弹入", "出现", "消失", "显现", "闪烁", "闪动", "闪现", "脉冲", "脉动", "抖动", "晃动", "摇摆", "摆动", "震动", "漂浮", "飘动", "滑入", "滑出", "滑动", "划入", "划出", "擦除", "错开", "延迟", "延时", "循环", "重复", "关键帧", "过渡", "转场", "视差", "拖尾", "运镜", "推镜", "逐字", "逐渐", "加速", "减速",
  ],
  words: [],
};

const SEQUENCE_ENTRY: ConceptEntry = {
  roots: [
    "nacheinander", "hintereinander", "reihe nach", "einer nach", "one after", "in turn", "one by one", "one at a time", "in sequence", "in succession",
    "successive", "sequential", "consecutive", "uno tras", "uno por uno", "de una en una", "por turnos", "secuencial",
    "順番", "順に", "一つずつ", "一つ一つ", "1つずつ", "次々", "交互",
    "l un apres l autre", "un apres l autre", "une apres l autre", "un par un", "une par une", "tour a tour", "successivement", "en sequence", "a la suite", "chacun son tour", "en cascade", "l un apres", "successif", "decale l un",
    "uno detras de otro", "uno a uno", "de uno en uno", "sucesiv", "en orden", "en cadena", "escalonad", "consecutiv", "alternando", "por orden", "una tras otra", "uno tras otro",
    "einzeln", "der reihe", "schritt fur schritt", "nach und nach", "reihenfolge", "abwechselnd", "eins nach", "gestaffelt", "staffel", "nacheinander", "hintereinander", "versetzt", "reihum",
    "ひとつずつ", "一個ずつ", "1個ずつ", "一文字ずつ", "1文字ずつ", "一枚ずつ", "順次", "ずらして", "時間差", "連続で", "順繰り", "順々", "ひとつひとつ",
    "依次", "逐个", "逐一", "一个接一个", "一个一个", "挨个", "轮流", "依序", "按顺序", "按序", "接连", "先后", "交替", "错开", "逐字", "逐行", "一个个",
  ],
  words: [],
};

const COUNTING_ENTRY: ConceptEntry = {
  roots: [
    "countdown", "count up", "count down", "count from", "counter", "counts up", "zahle von", "zahl von", "zahle bis", "zahl bis", "zahle hoch", "zahle herunter",
    "zahle runter", "contar desde", "contar de", "cuenta atras", "cuenta regresiva", "contador",
    "カウント", "数える",
    "compte a rebours", "compteur", "compter", "decompte", "compte jusqu", "compte de", "compte vers",
    "cuenta hasta", "cuenta de", "contar hasta", "contando", "cronometro", "temporizador", "cuenta regres",
    "zahler", "zahlt", "hochzahl", "runterzahl", "herunterzahl", "stoppuhr", "timer", "ablaufende",
    "カウントアップ", "カウンター", "タイマー", "ストップウォッチ", "秒読み", "数字が増", "数字が変", "数が増", "数字を数",
    "倒计时", "计数", "计时", "数到", "数数", "数字递增", "数字滚动", "计数器", "读秒", "从0数", "累加",
  ],
  words: [],
};

const TRANSFORM_ENTRY: ConceptEntry = {
  roots: [
    "position", "posicion", "opacit", "opacid", "deckkraft", "transparen", "scale", "skala", "escala", "skalier", "size", "rotat", "rotier", "zoom", "anchor",
    "ankerpunkt", "put", "place", "platzier", "coloc", "stell",
    "位置", "座標", "不透明", "透明", "拡大", "縮小", "回転", "配置", "サイズ", "スケール", "アンカーポイント", "ancl", "rotaci",
    "echelle", "opacite", "rotation", "ancrage", "positionn", "taille", "agrand", "reduire", "reduit", "pivot",
    "tamano", "giro", "girar", "anclaje", "posicionar", "agrand", "encoger", "escalar",
    "grosse", "drehen", "vergrosser", "verkleiner", "positionier", "transparenz", "ankerpunkt",
    "大きさ", "大きく", "小さく", "角度", "傾き", "アンカー", "透過", "反転", "倍に", "パーセント",
    "缩放", "放大", "缩小", "大小", "尺寸", "旋转", "角度", "不透明度", "透明度", "锚点", "放到", "放在", "摆在", "调整大小", "移到", "位置",
  ],
  words: ["pon", "pone"],
};

const LOOK_ENTRY: ConceptEntry = {
  roots: [
    "visual", "design", "scene", "vector", "shape", "mask", "matte", "occlu", "ring", "planet", "rocket", "glow", "style", "render", "look", "shadow",
    "blur", "bright", "contrast", "satur", "tint", "hue", "gradient", "texture", "grain", "outline", "stroke", "fill", "light", "shine", "sparkl", "typograph",
    "font", "cinemat", "premium", "fog", "smoke", "framing", "lens", "depth", "vignett", "background", "sombra", "brill", "resplandor", "desenfoq", "luz",
    "escena", "diseno", "fondo", "estilo", "mascara", "tipograf", "fuente", "schatten", "glanz", "leucht", "unschar", "licht", "szene", "gestalt", "hintergrund",
    "stil", "schrift", "nebel", "影", "光", "ぼかし", "背景", "シーン", "デザイン", "見た目", "文字", "フォント", "グロー", "シャドウ",
    "ombre", "flou", "luminos", "eclat", "lueur", "contraste", "saturat", "teinte", "degrade", "texture", "grain", "contour", "remplissage", "lumiere", "brillance", "scintill", "brouillard", "fumee", "cadrage", "objectif", "profondeur", "vignett", "arriere plan", "decor", "conception", "police", "rendu", "effet", "dessin", "dessine", "illustr", "visuel", "aspect", "apparence", "ambiance", "forme", "filtre", "nettete",
    "efecto", "sombra", "desenfoque", "difumin", "brillo", "contraste", "saturac", "degradado", "textura", "grano", "contorno", "relleno", "iluminac", "niebla", "humo", "encuadre", "profundidad", "vineteado", "vigneta", "apariencia", "aspecto", "dibuj", "ilustr", "visual", "nitidez", "enfoque", "borde", "trazo",
    "effekt", "kontrast", "sattigung", "farbton", "verlauf", "textur", "korn", "kontur", "umriss", "fullung", "rauch", "tiefenscharfe", "optik", "aussehen", "wirkung", "zeichn", "maske", "filter", "scharfe", "weichzeichn",
    "エフェクト", "ブラー", "ドロップシャドウ", "輝", "発光", "コントラスト", "彩度", "明るさ", "明度", "色相", "グラデーション", "テクスチャ", "ノイズ", "グレイン", "アウトライン", "輪郭", "塗り", "ストローク", "ライト", "質感", "ライティング", "霧", "煙", "ビネット", "ヴィネット", "被写界深度", "レンズ", "奥行き", "装飾", "図形", "シェイプ", "マスク", "マット", "イラスト", "ベクター", "スタイル", "ルック", "キラキラ", "光沢", "反射", "フレア", "ぼけ", "ボケ", "ピント", "シャープ", "にじみ", "描",
    "效果", "特效", "视觉", "外观", "样式", "风格", "设计", "场景", "背景", "阴影", "投影", "模糊", "虚化", "发光", "光晕", "光泽", "亮度", "对比度", "饱和度", "色调", "色相", "渐变", "纹理", "噪点", "颗粒", "描边", "轮廓", "填充", "形状", "蒙版", "遮罩", "遮片", "矢量", "字体", "景深", "镜头", "暗角", "质感", "画面", "插画", "绘制", "画一个", "锐化", "滤镜",
  ],
  words: ["form", "forma"],
};

const COLOUR_ENTRY: ConceptEntry = {
  roots: ["colo", "farb", "couleur", "赤", "青", "緑", "黄色", "白", "黒", "紫", "橙", "茶色", "金色", "灰色", "ピンク", "水色", "紺", "色", "teint", "colori", "nuance", "bleu", "jaune", "blanc", "gris", "dore", "argente", "bordeaux", "rosee", "naranja", "amarillo", "celeste", "dorado", "plateado", "morado", "rojiz", "azulad", "verdoso", "verdes", "blau", "grun", "gruen", "gelb", "schwarz", "grau", "braun", "orang", "violett", "turkis", "tuerkis", "rosa", "rote", "golden", "silbern", "オレンジ", "レッド", "ブルー", "グリーン", "イエロー", "ブラック", "ホワイト", "グレー", "パープル", "ゴールド", "シルバー", "ベージュ", "ターコイズ", "マゼンタ", "シアン", "カラー", "暖色", "寒色", "金色", "銀色", "桃色", "颜色", "色彩", "色调", "红", "蓝", "绿", "黄", "黑", "紫", "橙", "粉", "灰", "棕", "青色", "天蓝", "深蓝", "暖色", "冷色", "配色", "着色", "染色", "变色", "银色"],
  words: [
    "red", "rot", "rojo", "roja", "rouge", "blue", "blau", "azul", "bleu", "green", "grun", "verde", "vert", "yellow", "gelb", "amarillo", "jaune", "orange",
    "purple", "violet", "violett", "lila", "morado", "pink", "rosa", "rose", "white", "weiss", "weiß", "blanco", "blanc", "black", "schwarz", "negro", "noir",
    "grey", "gray", "grau", "gris", "gold", "golden", "navy", "teal", "cyan", "turquoise", "turquesa", "crimson", "scarlet", "maroon", "magenta", "beige", "brown",
    "braun", "marron", "brun", "silver", "silber", "plata", "ivory", "lime", "indigo", "coral", "lavender", "mint", "aqua", "azure",
  ],
};

const LAYOUT_ENTRY: ConceptEntry = {
  roots: [
    "arrang", "layout", "lay out", "line up", "align", "ausricht", "zentrier", "centred", "centered", "centre", "center", "centrad", "distribut", "verteil",
    "evenly", "gleichm", "stack", "stapel", "apil", "grid", "raster", "rejilla", "cuadricul", "gitter", "side by side", "nebeneinander", "lado a lado", "reparte",
    "distribuy", "alinea", "above", "below", "beside", "next to", "left of", "right of", "overlap", "collid", "oberhalb", "unterhalb", "neben", "links von",
    "rechts von", "encima", "debajo", "junto a", "al lado", "uberlapp", "solap",
    "並べ", "並び", "整列", "横一列", "一列", "均等", "等間隔", "中央", "中心", "重な", "ぶつか", "隣", "上に", "下に", "左に", "右に", "グリッド",
    "aligner", "aligne", "centrer", "repartir", "reparti", "distribu", "empile", "grille", "cote a cote", "au dessus", "en dessous", "a cote de", "a gauche de", "a droite de", "chevauch", "superpos", "disposition", "dispos", "colonne", "rangee", "espacement",
    "alinear", "centra", "disposicion", "superpon", "apila", "arriba de", "abajo de", "a la izquierda de", "a la derecha de", "espaciado", "separacion", "lado a lado",
    "ausrichten", "anordnung", "uberlag", "stapeln", "untereinander", "ubereinander", "links von", "mittig", "mittelpunkt", "bundig", "abstand", "raster", "anordn",
    "揃え", "揃える", "そろえ", "センター", "中央揃え", "左揃え", "右揃え", "間隔", "重ね", "重なり", "横に", "縦に", "上下", "左右", "整頓", "敷き詰め", "レイアウト", "並べて", "並べる",
    "对齐", "排列", "排成", "排一排", "排版", "布局", "居中", "水平居中", "垂直居中", "均匀", "等距", "间距", "分布", "堆叠", "叠放", "网格", "并排", "一排", "一列", "一行", "上方", "下方", "旁边", "左边", "右边", "重叠", "重合", "摆放", "摆成", "整齐",
  ],
  words: [],
};

/** Words that only make an arrangement when a spatial noun sits in the same clause: the sort-or-arrange verbs. */
export const AMBIGUOUS_LAYOUT_ENTRY: ConceptEntry = {
  roots: ["order", "ordena", "ordne", "anordn", "ordnen"],
  words: [],
};

/** Words that place items in a line, row, column or grid. */
export const SPATIAL_NOUN_ENTRY: ConceptEntry = {
  roots: ["row", "reihe", "fila", "hilera", "column", "spalte", "columna", "in a line", "en linea", "横", "縦", "一行", "並び"],
  words: [],
};

const JUDGEMENT_ENTRY: ConceptEntry = {
  roots: [
    "look", "cinemat", "reference", "better", "nicer", "beaut", "pretty", "polish", "improv", "enhanc", "vibe", "mood", "feel", "natural", "realist",
    "professional", "premium", "elegant", "stylish", "stylize", "style", "fix", "scene", "design", "classy", "nice", "balanced",
    "mejor", "profesional", "bonit", "estilo", "ambiente", "pulir", "besser", "verbess", "professionell", "schon", "stimm", "stil", "naturlich", "cineastisch",
    "雰囲気", "シネマティック", "綺麗", "きれい", "改善", "美し", "洗練", "自然", "プロっぽ", "プロの", "プロ品質", "かっこ", "見た目",
    "mieux", "amelior", "plus beau", "joli", "elegant", "professionnel", "soigne", "polie", "polir", "naturel", "realiste", "cinematograph", "atmosphere", "rendu", "ressenti", "classe", "propre", "equilibr", "harmonie", "reference", "maquette", "ressembl", "comme dans", "qualite", "haut de gamme", "luxe", "travaille", "retouch", "plus propre", "plus pro",
    "elegante", "cinematogr", "natural", "realist", "atmosfera", "vibra", "calidad", "lujo", "pulido", "refin", "limpio", "equilibr", "armon", "referencia", "maqueta", "se vea", "luzca", "aspecto", "apariencia", "hermos", "mejora", "retoca", "mas pro", "sensacion", "agradable",
    "hochwertig", "edel", "elegant", "stimmung", "atmosphare", "wirkt", "aussehen", "optik", "polier", "feinschliff", "aufwert", "realistisch", "sauber", "ausgewogen", "harmonisch", "referenz", "vorlage", "hubsch", "ansprechend", "anspruchsvoll", "filmisch", "kinoreif", "wertig", "professioneller",
    "おしゃれ", "オシャレ", "高級", "クオリティ", "品質", "質感", "整え", "整って", "映画的", "映画のよう", "リアル", "ナチュラル", "馴染", "調和", "見栄え", "印象", "ムード", "トーン", "ルック", "仕上げ", "クール", "スタイリッシュ", "エレガント", "プロっぽ", "プロフェッショナル", "プロ品質", "良くして", "良くなる", "カッコ", "格好", "センス",
    "更好", "美观", "好看", "漂亮", "高级", "质感", "氛围", "感觉", "风格", "专业", "精致", "精美", "优化", "改善", "提升", "润色", "自然", "真实", "电影感", "电影般", "电影质感", "仿照", "模仿", "效果图", "样稿", "平衡", "协调", "整体", "舒服", "大气", "顺眼", "看起来", "看上去", "美化", "更有",
  ],
  words: [],
};

const PURPOSE_ENTRY: ConceptEntry = {
  roots: ["so that", "so the", "damit", "ために", "para que", "pour que", "afin que", "afin de", "ようにして", "ための", "为了", "以便", "为的是"],
  words: ["so", "damit"],
};

export const NAME_ENTRY: ConceptEntry = {
  roots: ["rename", "renomm", "umbenenn", "benenn", "nenn", "renombr", "nombr", "nomm", "appell", "llam", "name", "名前", "名を", "改名", "etiquet", "intitul", "nombra", "titul", "重命名", "命名", "名字", "名称", "叫做", "取名", "リネーム", "名称", "名づけ"],
  words: ["call", "label"],
};

const COMP_ENTRY: ConceptEntry = {
  roots: ["composition", "komposition", "composicion", "コンポジション", "コンポ", "コンプ"],
  words: ["comp", "comps"],
};

const PARENT_ENTRY: ConceptEntry = {
  roots: ["parent", "unparent", "eltern", "親", "emparent", "hijo de", "hija de", "hacer hijo", "child of", "unterordn", "lier a", "lie a", "の子", "子にし", "rattach", "enfant de", "vincula a", "kind von", "untergeordnet", "verknupf", "父级", "父层", "子级", "父子", "设为子级", "绑定到", "链接到", "ペアレント", "親子", "つなげ"],
  words: [],
};

export const MARKER_ENTRY: ConceptEntry = { roots: ["marker", "markier", "marcador", "マーカー"], words: [] };

const FOLDER_ENTRY: ConceptEntry = { roots: ["folder", "ordner", "carpeta", "dossier", "フォルダ"], words: [] };

/** The words that open the reason for a clause (`so`, `damit`, `para`); what follows only explains why the edit is made. */
export const PURPOSE_OPENERS: ReadonlyArray<string> = ["so", "damit", "para", "pour", "afin"];

/** The phrases that say where a layer starts: a start or in point given as a time or a frame. */
export const START_ROOTS: ReadonlyArray<string> = [
  "starts at", "start at", "starts on", "start on", "begins at", "begin at", "begins on", "begin on", "in point", "startet bei", "start bei", "beginnt bei", "beginn bei", "empieza en", "comienza en", "arranca en", "inicia en", "commence a", "debute a", "demarre a", "から始ま", "で始ま", "入点",
];

const TIMING_ENTRY: ConceptEntry = {
  roots: ["trim", "trimm", "offset", "kurz", "recort", "out point", "end at", "in at", "in on", "in bei", "runs", "lasts", "dauert", "dura", "dure", "lauft", "トリム", ...START_ROOTS, "raccourc", "rogn", "couper", "point d entree", "point de sortie", "commence a", "debute a", "demarre a", "acort", "alarg", "punto de entrada", "punto de salida", "verlang", "startpunkt", "endpunkt", "setzt ein bei", "fangt an bei", "イン点", "アウト点", "開始", "終了", "から始ま", "で始ま", "入点", "出点", "裁剪", "修剪", "剪短", "缩短", "延长", "时长", "持续", "起始", "开始时间", "结束时间"],
  words: [],
};

const TEXT_ENTRY: ConceptEntry = {
  roots: ["テキスト", "字幕", "文本", "文字", "标题", "タイトル", "テロップ", "キャプション"],
  words: ["text", "texts", "texte", "subtitle", "subtitles", "caption", "captions", "untertitel", "texto", "textos", "subtitulo", "subtitulos"],
};

const ATTRIBUTE_ENTRY: ConceptEntry = {
  roots: ["lock", "unlock", "hide", "hidden", "visible", "visibility", "sperr", "gesperrt", "verrouill", "bloque", "ocult", "mute", "unmute", "stummschalt", "silenci", "ロック", "非表示", "masquer", "cacher", "invisible", "muet", "verrou", "candado", "visib", "oculta", "verbirg", "versteck", "sichtbar", "stumm", "ausgeblendet", "sperre", "表示", "隠", "ミュート", "ソロ", "シャイ", "锁定", "解锁", "隐藏", "显示", "静音", "独奏", "可见", "不可见"],
  words: ["shy", "solo", "unsolo"],
};

/** Every table concept with its entry, in the order the readings consult them. */
export const CONCEPT_ENTRIES: ReadonlyArray<readonly [GoalConcept, ConceptEntry]> = [
  ["motion", MOTION_ENTRY], ["sequence", SEQUENCE_ENTRY], ["counting", COUNTING_ENTRY], ["transform", TRANSFORM_ENTRY], ["look", LOOK_ENTRY],
  ["colour", COLOUR_ENTRY], ["layout", LAYOUT_ENTRY], ["judgement", JUDGEMENT_ENTRY], ["purpose", PURPOSE_ENTRY], ["name", NAME_ENTRY],
  ["comp", COMP_ENTRY], ["parent", PARENT_ENTRY], ["marker", MARKER_ENTRY], ["folder", FOLDER_ENTRY], ["timing", TIMING_ENTRY], ["text", TEXT_ENTRY],
  ["attribute", ATTRIBUTE_ENTRY],
];

/** The folded words that only make motion-free arrangements when they sit in a clause of their own: the move and rotate verbs. */
export const MOTION_VERB_ENTRY: ConceptEntry = {
  roots: ["move", "mover", "mueve", "moving", "bewegen", "beweg", "bewegt", "verschieb", "verschob", "rotat", "dreh", "gira", "girar", "spin", "移動", "回転", "動か", "deplac", "bouge", "tourn", "desplaz", "muev", "動く", "回す", "回し", "移动", "挪动", "旋转", "转动"],
  words: [],
};

/** The rename verbs: the words after one of them are a new name, not a request. */
export const RENAME_ENTRY: ConceptEntry = { roots: ["rename", "renomm", "umbenenn", "benenn", "renombr", "重命名", "リネーム"], words: [] };

/** The words that size a composition or a project, so that the size word names a setting. */
export const SETTINGS_CONTAINER_WORDS: ReadonlyArray<string> = ["comp", "composition", "komposition", "composicion", "project", "projekt", "proyecto", "projet", "コンポジション", "プロジェクト", "合成", "项目"];

/** The phrases that name a composition's work area. */
export const WORK_AREA_PHRASES: ReadonlyArray<string> = ["work area", "workarea", "work region", "area de trabajo", "arbeitsbereich", "zone de travail", "ワークエリア", "作業領域", "作業エリア", "工作区", "工作区域"];

/** The phrases that name a composition setting, not a motion: frame rate, duration, resolution and their translations. */
export const SETTINGS_PHRASES: ReadonlyArray<string> = [
  ...WORK_AREA_PHRASES, "duree",
  "frame rate", "framerate", "frames per second", "frame count", "number of frames", "frame size", "frames long", "frames total", "bild rate", "bildrate",
  "bilder pro sekunde", "anzahl der bilder", "fotogramas por segundo", "velocidad de fotogramas", "tasa de fotogramas", "numero de fotogramas", "resolucion",
  "resolution", "auflosung", "duracion", "duration", "dauer", "lange", "longitud", "bit depth", "fps", "px", "pixels", "images par seconde", "cadence d images", "frequence d images", "taille de l image", "bildfrequenz", "bildern pro sekunde", "フレームレート", "フレーム数", "解像度", "長さ", "尺", "帧率", "帧速率", "分辨率", "时长", "持续时间", "像素",
];

/** The size nouns that name a setting only when a container word is near them. */
export const SIZE_NOUNS: ReadonlyArray<string> = ["size", "groesse", "grosse", "tamano", "taille", "サイズ", "大小", "尺寸"];
