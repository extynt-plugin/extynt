// The words for text, link and gradient features in languages beyond the first five: a text animator, a picture seen through letters, letter spacing, a link to a null, a gradient and a comp cut to another shape, in Spanish, German, French, Japanese and Chinese.
import { withKana } from "./request-kana.js";
import { unionRegex } from "./request-text.js";

const CLAUSE = "[^.;!?。！？]";
const EDGE = "(?<![\\p{L}\\p{N}])";

function near(first: string, second: string, gap: number): RegExp {
  const between = `${CLAUSE}{0,${gap}}`;
  return new RegExp(`(?:${first})${between}(?:${second})|(?:${second})${between}(?:${first})`, "giu");
}

function anyOf(...sources: ReadonlyArray<string>): RegExp {
  return new RegExp(sources.join("|"), "giu");
}

const TYPING_MORE = [
  "cada letra|cada caracter|palabra por palabra|palabra a palabra|por palabras?|letra a letra|letra tras letra|una letra tras otra|de letra en letra|caracter tras caracter|tipo maquina|escritura progresiva|selector de (?:rango|intervalo)",
  "jed\\p{L}* (?:buchstabe|zeichen)\\p{L}*|buchstabe fur buchstabe|buchstabenweise|wort fur wort|wortweise|pro wort|tippt sich|tippeffekt|auswahlbereich|schreibmaschineneffekt",
  "mot par mot|lettre apres lettre|une lettre apres l'autre|une lettre apres l autre|chaque lettre|effet de frappe|effet frappe|selecteur de (?:plage|portee)|animateurs? de caracteres",
  "ひと文字ずつ|[1１一]文字ずつ|単語ずつ|単語ごと|[1１一]語ずつ|タイピング|タイプライタ|セレクター",
  "每个(?:字|字母|字符)|逐字|逐词|逐个字|逐字母|逐字符|按字符|按字母|按单词|打字机|打字效果|范围选择器|偏移选择器|字符偏移|一个字一个字|一个一个字|文字一个接一个",
].join("|");
const LETTER_ZH = "文字|字母|字符|单词|每个字|文本";
const SEQUENCE_ZH = "一个一个|逐个|依次|挨个|一个接一个|逐一|逐步|错开|交错|依序";

/** The words for animation that runs on single characters or words, in Spanish, German, French, Japanese and Chinese. */
export const TEXT_ANIMATOR_MORE: RegExp = withKana(unionRegex([anyOf(TYPING_MORE), near(LETTER_ZH, SEQUENCE_ZH, 10)]));

const TEXT_NOUN = "(?:texto|letras|titulo|palabra|text|buchstaben|titel|schrift|wort|lettres|texte|titre|mot|文字|テキスト|タイトル|文本|字形|文字内部|字母)";
const MEDIA_NOUN = "(?:logo|marca|marque|ロゴ|标志|徽标|video|imagen|foto|footage|textura|bild|film|material|aufnahme|image|photo|texture|映像|動画|画像|写真|素材|视频|影片|图片|照片)";
const INSIDE = "(?:dentro de(?:l)?|a traves de(?:l)?|adentro|innerhalb|durch|nur in|dans|a travers|en dedans|の中|の形|の内側|でくり抜|で切り抜|型に|里面|里|内部|之中|透过|穿过|镂空)";
const MATTE_AS = "(?:como|als|comme|として|做|当|作为)[^.;]{0,6}(?:mate|maske|matte|cache|masque|マット|マスク|遮罩|蒙版)";

/** The words for a picture seen through text, in Spanish, German, French, Japanese and Chinese: a picture beside a word for inside the letters, or the text as a matte. */
export const TEXT_MATTE_MORE: RegExp = withKana(unionRegex([
  near(MEDIA_NOUN, `${INSIDE}[^.;]{0,6}${TEXT_NOUN}`, 25),
  near(MEDIA_NOUN, `${TEXT_NOUN}[^.;]{0,3}${INSIDE}`, 25),
  new RegExp(`${TEXT_NOUN}${CLAUSE}{0,4}${MATTE_AS}`, "giu"),
  /文字でマスク|文字型|テキストでマスク|文字の形に|字形里|镂空文字|文字做遮罩|文字当遮罩|只在文字/giu,
]));

/** The words for letter spacing and kerning in the other languages: spacing between letters, characters or glyphs, and kerning or tracking of type. */
export const LETTER_SPACING_MORE: RegExp = withKana(anyOf(
  "espacio entre (?:las |los )?(?:letras|caracteres)|espacement des lettres|l'espace entre (?:les )?(?:lettres|caracteres)|字与字(?:之间)?的?(?:间距|距离)|字之间的?间距|interletraje|espaciado (?:de|entre) (?:los )?(?:caracteres|letras)|espacio entre caracteres|crenage|unterschneidung|spationierung|abstand zwischen (?:den )?(?:buchstaben|zeichen)",
  "espacement entre (?:les )?(?:lettres|caracteres)|ecart entre (?:les )?lettres|文字の間隔|文字の詰め|字詰め|文字を(?:広げ|詰め)|文字ツメ|字间距|字距|文字间距|字符间距|字间",
));

const GROUP_VERB = "(?:fass|agrup|reagrup|regroup|zusammenfass|bundel|gruppier|group|bundle|tie|gather|put|move)\\p{L}*";
const ONE_CONTROLLER = "(?:one|a single|a|un solo|un|el mismo|einem einzigen|einem|ein|un seul|le meme|1つの|ひとつの|一つの|一个|同一个)[ ]?(?:controller|controlador|controleur|nulo|null|nul|calque nul|コントローラー|ヌル|控制器|空对象)";
const NULL_NATIVE = "(?:nulo|nula|null\\p{L}*|calque nul|objet nul|controlador|controller)";
const LINK_NATIVE = "(?:vincul|enlaz|ata|une|conect|ancla|lig|lie|relie|attach|accroch|rattach|connect|verbind|verknupf|anbind|hang|bind)\\p{L}*";

/** The words that hook a layer to a null or controller in the other languages: a link verb beside the null, and the Japanese and Chinese words for it. */
export const LINK_TO_NULL_MORE: RegExp = unionRegex([
  withKana(near(`${EDGE}${GROUP_VERB}|まとめ|归到|归入|挂到|放到`, ONE_CONTROLLER, 40)),
  /\bnulls?\b[^.;]{0,25}\b(?:in charge of|controls?|controlling|drives?|driving|runs?|steers?|operates?)\b[^.;]{0,30}\b(?:layers?|logos?|titles?|shapes?|them|all|everything)\b/giu,
  new RegExp(`${EDGE}${LINK_NATIVE}[^.;]{0,40}${NULL_NATIVE}|${EDGE}${NULL_NATIVE}[^.;]{0,40}${LINK_NATIVE}`, "giu"),
  withKana(near("ヌル|コントローラー|コントロールレイヤー", "リンク|紐づ|ひもづ|紐付|つなげ|繋げ|くっつけ|従わ|追従|連動|付けて", 14)),
  near("空对象|控制器|控制层|控制图层", "链接|绑定|连接|跟随|关联|挂|父级|绑到", 14),
]);

const COLOUR = "(?:red|orange|yellow|green|blue|pink|purple|violet|teal|cyan|magenta|white|black|gold|rojo|naranja|amarillo|verde|azul|rosa|morado|violeta|blanco|negro|dorado|rot|gelb|grun|blau|lila|weiss|schwarz|bleu|rose|jaune|vert|rouge|blanc|noir|赤|青|黄|緑|ピンク|紫|橙|オレンジ|白|黒|红|蓝|绿|粉|黑)";
const COLOUR_TO = `${COLOUR}[- ]?(?:to|a|al|zu|au|du|de|から|到|至|转|转为)[- ]?${COLOUR}`;
const FADE_WORD = "(?:fade|blend|transition|fundido|degrad|verlauf|fondu|degrade|フェード|グラデ|过渡|渐变|渐隐|变化)";

/** The words for a gradient fill in the other languages: a colour transition, a gradient, and the Chinese and Japanese names for it. */
export const GRADIENT_MORE: RegExp = withKana(unionRegex([near(COLOUR_TO, FADE_WORD, 24), anyOf("farbubergang\\p{L}*", "グラディエント", "渐变色?", "transicion de color", "transition de couleur")]));

const ASPECT_NATIVE = "(?:cuadrad\\p{L}*|vertical\\p{L}*|horizontal\\p{L}*|apaisad\\p{L}*|quadratisch\\p{L}*|hochformat|querformat|carre\\p{L}*|portrait|paysage|正方形|スクエア|縦型|縦長|横型|竖版|竖屏|横版|横屏|方形|\\d{1,2} ?[:x/] ?\\d{1,2})";
const VERSION_NATIVE = "(?:version\\p{L}*|variante\\p{L}*|corte|formato|fassung|ausfuhrung|format|バージョン|バリエーション|版|版本|格式)";
const COMPOSITION_NATIVE = "(?:comps?|composicion\\p{L}*|composition\\p{L}*|compos?|komposition\\p{L}*|コンポ\\p{L}*|合成)";

/** The words for a comp reformatted as a version in another shape, in Spanish, German, French, Japanese and Chinese. */
export const ASPECT_VARIANT_MORE: RegExp = withKana(near(`${ASPECT_NATIVE}${CLAUSE}{0,6}${VERSION_NATIVE}|${VERSION_NATIVE}${CLAUSE}{0,6}${ASPECT_NATIVE}`, COMPOSITION_NATIVE, 30));
