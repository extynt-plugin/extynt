// The words that name the simple request features, in English, Spanish, German, French, Japanese and Simplified Chinese: effects, controllers, camera, markers, 3D and Essential Graphics.
import { phraseRegex, unionRegex } from "./request-text.js";

export const BLUR_WORDS = [
  "blur", "gaussian", "defocus", "soften", "soft focus", "out of focus", "unfocus", "fuzzy", "bokeh", "depth of field", "=dof", "tilt shift", "frosted glass",
  "desenfoq", "desenfoc", "difumin", "borros", "emborron", "profundidad de campo", "fuera de foco", "enfoque suave",
  "unscharf", "weichzeichn", "verwisch", "defokus", "verschwommen", "scharfentiefe", "tiefenscharfe",
  "flou", "floute", "defocalis", "profondeur de champ", "hors focus", "estomp", "gaussien",
  "ぼか", "ぼんやり", "ぼやっと", "ボケ", "ボカ", "ブラー", "ガウス", "ぼやけ", "ぼやか", "ピンボケ", "ピンぼけ", "被写界深度", "ピントを外",
  "模糊", "虚化", "虚一点", "虚一些", "糊一点", "高斯", "失焦", "散焦", "景深", "柔化", "朦胧",
];

export const MOTION_BLUR_WORDS = [
  "motion blur", "motion-blur", "desenfoque de movimiento", "desenfoque de mov", "difuminado de movimiento", "bewegungsunscharfe", "bewegungsweichzeichn",
  "flou de mouvement", "flou cinetique", "モーションブラー", "モーションボカシ", "モーションぼかし", "运动模糊", "动态模糊",
];

export const GLOW_WORDS = [
  "glow", "bloom", "halo", "luminous", "radiance", "light bleed",
  "resplandor", "resplandec", "=brille", "=brilla", "luz suave", "luz difusa", "light spill", "soft light around", "diffuse light",
  "leucht", "gluh", "lichthof", "lichtschein", "weiches licht", "sanftes licht",
  "lueur", "rayonn", "luminesc", "lumiere douce", "lumiere diffuse",
  "グロー", "グロウ", "発光", "やわらかい光", "柔らかい光", "光をまと", "光をまとわ", "光彩", "光る", "光らせ", "光って", "輝かせ", "ブルーム", "ハロ",
  "发光", "辉光", "光晕", "泛光", "光芒", "发亮", "柔和的光", "一圈光", "柔光",
];

export const DROP_SHADOW_WORDS = [
  "drop shadow", "dropshadow", "shadow", "sombra", "sombreado", "schatten", "schlagschatten", "ombre", "ombrage",
  "ドロップシャドウ", "シャドウ", "陰影", "落ち影", "影を", "影が", "影に", "影の", "影付", "影つ",
  "阴影", "影子", "投射阴影", "投影",
];

export const WIGGLE_WORDS = [
  "wiggl", "jiggl", "wobbl", "jitter", "vibrat", "tremor", "tremble", "quiver", "shiver", "screen shake", "random shake", "randomly move", "random motion",
  "random movement", "random jitter", "handheld feel", "handheld look", "handheld shake", "hand held shake",
  "tembl", "vibrar", "=vibra", "vibracion", "sacud", "temblor", "movimiento aleatorio", "aleatori",
  "wackel", "zitter", "schuttel", "vibrier", "beben", "zufallsbewegung", "zufallige bewegung", "verwackel",
  "vibrer", "=vibre", "secou", "aleatoire", "tremblot",
  "ウィグル", "揺らし", "揺らす", "ゆらす", "震え", "ふるえ", "ガタガタ", "ランダムに動", "ランダムな動き", "ランダムに揺", "シェイク", "揺れをつけ", "揺れを入れ", "揺れを加え", "手持ち",
  "抖动", "晃动", "摇晃", "震动", "颤抖", "手持镜头", "手持感", "随机抖动", "随机运动", "随机晃动",
];

export const WIGGLE_FIXING = unionRegex([
  /\b(?:stabili[sz]\w*|steadi\w*|smooth\w* out|fix\w*|remov\w*|reduc\w*|get rid of|calm\w*|tam(?:e|ing)|kill\w*)\b[^.;]{0,30}\b(?:shak\p{L}*|jitter\p{L}*|wobbl\p{L}*|vibrat\p{L}*|trembl\p{L}*)/giu,
  /(?:estabiliz|elimin|quita|reduc|corrig|arregl)\p{L}*[^.;]{0,30}(?:temblor|tembl|sacud|vibra)\p{L}*/giu,
  /(?:stabilisier|entfern|reduzier|beheb|korrigier)\p{L}*[^.;]{0,30}(?:wackel|zitter|verwackel|schuttel)\p{L}*/giu,
  /(?:stabilis|supprim|reduis|corrig)\p{L}*[^.;]{0,30}(?:trembl|secou|vibr)\p{L}*/giu,
  /手ブレ|ブレ補正|揺れを(?:抑|消|なくし|取)|(?:稳定|去除|消除|减少|修复|解决)[^.。;]{0,14}(?:抖动|晃动|震动|颤抖)|(?:抖动|晃动|震动|颤抖)得?(?:太|很|特别|有点|非常|好)|防抖/giu,
  /(?:ガタガタ|揺れ|ブレ)(?:が|は)?(?:ひどい|酷い|大きい|激しい)|(?:wackelt|zittert|tiembla|tremble)\p{L}* (?:zu |demasiado|trop)/giu,
]);

export const REPEATER_WORDS = [
  "repeat", "repeater", "grid of", "row of", "ring of", "array of", "radial array",
  "repetidor", "repet", "repetic", "repite", "cuadricula de", "matriz de",
  "wiederhol", "vervielfach", "evenly spaced", "equally spaced", "equidistant", "mismo espacio", "mismo espaciado", "espaciado uniforme", "gleichem abstand", "gleichen abstand", "in einer reihe", "en fila", "en hilera", "meme espacement", "meme ecart", "regulierement espace", "raster aus", "muster aus",
  "repeteur", "grille de", "rangee de",
  "リピート", "リピーター", "等間隔", "繰り返", "複製して並べ", "敷き詰め", "グリッド状",
  "中继器", "等间距", "重复", "阵列", "复制多个",
];

export const REPEATER_LOOPING = unionRegex([
  /\brepeat\p{L}* (?:(?:the|this|that|my|your|its) )?(?:animation|motion|loop|sequence|move|movement|cycle|effect|every|forever|endlessly|until|continuously|indefinitely)\b/giu,
  /\brepet\p{L}* (?:(?:la|el|l|le|les|las|los|esta|este|cette|cet|ce|die|den|das|diese) )?(?:animacion|movimiento|bucle|loop|secuencia|ciclo|animation|mouvement|boucle|sequence|cycle|siempre|para siempre|toujours|sans fin|sin fin)\b/giu,
  /\bwiederhol\p{L}* (?:(?:die|den|das|diese|dieser) )?(?:animation|bewegung|schleife|sequenz|ablauf|endlos|immer|dauerhaft|unendlich)\b/giu,
  /(?:アニメーション|アニメ|動き|モーション|ループ|再生|無限|ずっと|永遠|何度も)[^、。]{0,6}繰り返|繰り返し(?:再生|続|て再生|アニメ|ループ)|繰り返す動き|繰り返しの動き|無限に繰り返/gu,
  /(?:无限|不断|一直|永远|循环)重复|重复(?:播放|动画|循环)/gu,
]);

export const CAMERA_WORDS = ["camera", "camara", "kamera", "=cam", "=cams", "カメラ", "摄像机", "相机"];

export const NULL_WORDS = [
  "null", "nulo", "nula", "controleur", "=nul", "nullobjekt", "controller", "control layer", "controlador", "capa de control", "steuerungsebene", "steuerebene", "calque de controle",
  "ヌル", "コントローラー", "コントロールレイヤー", "空对象", "控制层", "控制图层", "控制器",
];

export const PARENT_WORDS = [
  "parent", "emparent", "padre de", "hijo de", "elternobjekt", "eltern", "ubergeord", "untergeord", "kind ebene",
  "ペアレント", "親子", "親レイヤー", "親に", "紐付け", "紐づ", "ひもづ", "父级", "父子", "子级", "子图层", "父图层",
];

export const MARKER_WORDS = [
  "marker", "cue point", "mark the beat", "mark each beat", "mark the beats", "marcador", "marca de tiempo", "marcas de tiempo", "puntos de referencia", "markierung", "zeitmarke", "sprungmarke", "ebenenmarker", "marqueur", "reperes",
  "マーカー", "标记点", "图层标记", "合成标记", "时间标记", "添加标记", "加标记", "打标记", "打点", "节拍标记", "打上标记", "做标记", "放置标记", "设置标记",
];

export const THREE_D_PATTERN = unionRegex([
  /\b3-?d\b|\bthree[- ]d\b/giu,
  phraseRegex([
    "three dimensional", "tridimension", "dreidimension", "trois dimensions", "z space", "3次元", "三次元", "立体", "三维", "3维",
  ]),
]);

export const ESSENTIAL_GRAPHICS_PATTERN = unionRegex([
  /\bessential (graphics|propert(y|ies)|panel)\b|\bmogrt\b/giu,
  phraseRegex([
    "motion graphics template", "graficos esenciales", "grafico esencial", "propiedad esencial", "propiedades esenciales", "wesentliche grafik", "wesentliche eigenschaft",
    "elements graphiques essentiels", "graphiques essentiels", "proprietes essentielles", "propriete essentielle",
    "エッセンシャルグラフィックス", "エッセンシャルプロパティ", "モーショングラフィックステンプレート", "基本图形", "基本属性", "动态图形模板",
  ]),
]);
