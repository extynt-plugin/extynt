// Request words for the properties of shape layers and text layers in every language: stroke weight, dashes, trim paths, rounded corners, repeaters, text spacing and size.
import type { ConceptRow } from "./resolution-concepts.js";

/** Rows for the stroke, fill, trim, corner and repeater properties of a shape, named by what the line or form looks like. */
export const SHAPE_WORDS: ReadonlyArray<ConceptRow> = [
  [
    "thickness, thicker, thinner, thick, thin, bold line, bolder line, heavier line, line weight, stroke weight, line width, linewidth, stroke width, strokewidth, line thickness, outline weight, outline width, width of the line, width of the stroke, " +
    "grosor, grueso, gruesa, mas grueso, mas fino, mas delgado, ancho del trazo, ancho de linea, grosor del trazo, strichstarke, strichdicke, liniendicke, linienstarke, dicker, dunner, konturstarke, breite der kontur, " +
    "epaisseur, epais, epaisse, plus epais, plus fin, plus mince, largeur du trait, largeur du contour, epaisseur du trait, " +
    "線の太さ, 線幅, 線の幅, 太さ, 太く, 細く, 太い線, 細い線, 线宽, 线条粗细, 描边宽度, 描边粗细, 粗细, 加粗, 变粗, 变细, 细一点, 粗一点",
    "width weight thickness",
    5,
  ],
  [
    "dashed, dashes, dash, dotted, dots, broken line, line of dashes, stitched, stitching, perforated, marching ants, gestrichelt, strichelung, punktiert, gepunktet, strichlinie, punteado, punteada, discontinua, discontinuo, trazos, rayas, " +
    "pointille, pointilles, tirets, trait discontinu, ligne brisee, 点線, 破線, 点々, ダッシュ, 虚线, 点线, 虚线框, 间断",
    "dash dashes",
    5,
  ],
  [
    "gap, gaps, gap between the dashes, space between the dashes, spacing of the dashes, dash gap, luecke, lucke, abstand der striche, lucke zwischen, hueco, espacio entre los trazos, espacio entre rayas, intervalle entre les tirets, " +
    "ecart des tirets, 間隔, 隙間, 间隙, 缺口",
    "gap",
    5,
  ],
  [
    "start of the line, where the line starts, where it starts, where it begins, starting point of the line, start of the stroke, start of the path, begin drawing from, draw from, trim start, line start, anfang der linie, wo die linie beginnt, " +
    "comienzo de la linea, inicio del trazo, donde empieza, debut du trait, debut de la ligne, ou commence, 線の始点, 始点, 開始位置, 开始位置, 起点, 描边起点, 起始",
    "start",
    5,
  ],
  [
    "end of the line, where the line ends, where it ends, where it stops, end of the stroke, end of the path, stop drawing at, stop drawing, finish drawing, end the line, draw only up to,  draw until, trim end, line end, ende der linie, wo die linie endet, final de la linea, fin del trazo, " +
    "donde termina, donde acaba, fin du trait, fin de la ligne, ou finit, ou se termine, 線の終点, 終点, 終了位置, 结束位置, 终点, 描边终点",
    "end",
    5,
  ],
  [
    "offset the line, slide the line along, slide along the path, shift along the path, crawl along the path, make the line travel, travelling line, travel along the path, versatz der linie, entlang des pfads schieben, " +
    "desplazar a lo largo, desplaza la linea, decalage de la ligne, decaler le long du trace, 線をずらす, パスに沿って動かす, 沿路径移动, 沿着路径滑动, 偏移",
    "offset",
    3,
  ],
  [
    "pill shape, rounded corners, round corners, round the corners, rounded, roundness, round it off, smooth the corners, soften the corners, soften corners, less sharp corners, no sharp corners, corner radius, cornerradius, radius of the corners, " +
    "abgerundet, abgerundete ecken, ecken abrunden, runde ecken, eckenradius, eckenrundung, rundung, esquinas redondeadas, redondea las esquinas, redondear esquinas, bordes redondeados, radio de las esquinas, " +
    "coins arrondis, arrondir les coins, arrondi, arrondis,  angles arrondis, rayon des coins, rayon d angle, 角丸, 角を丸く, 角を丸める, 丸み, 丸角, 圆角, 倒圆角, 圆角半径, 圆润, 变圆",
    "roundness radius corner",
    5,
  ],
  [
    "copies, how many copies, number of copies, copy count, repeat it, repeat the shape, repeat the element, duplicates, duplicate count, how many of them, how many times it repeats, array of, grid of, kopien, anzahl der kopien, " +
    "wiederholungen, kopienanzahl, copias, numero de copias, cantidad de copias, repeticiones, nombre de copies, nombre de repetitions, copies du motif, コピー数, コピーの数, 複製数, 繰り返しの数, 副本数, 复制数量, 重复次数, 副本",
    "copies count number",
    5,
  ],
  [
    "stroke color, stroke colour, outline colour, outline color, line colour, line color, border colour, border color, colour of the line, color of the line, colour of the outline, color of the outline, contour color, farbe der kontur, farbe der linie, " +
    "color del trazo, color del contorno, color de la linea, couleur du trait, couleur du contour, couleur de la ligne, 線の色, 輪郭の色, 線色, 描边颜色, 描边色, 线条颜色, 轮廓颜色, " +
    "edge color, rim color, color of the edge, color of the rim, color of the border, color of the path, color del borde, color del canto, linienfarbe, randfarbe, konturfarbe, strichfarbe, farbe des randes, farbe vom rand, couleur du bord, couleur de la bordure, couleur du pourtour, " +
    "縁の色, フチの色, 縁取りの色, 枠の色, 边缘颜色, 边缘的颜色, 边框颜色, 外框颜色, 边线颜色, 描边的颜色",
    "stroke&color",
    5,
  ],
  [
    "fill color, fill colour, fill with, colour it in, color it in, colour of the shape, color of the shape, paint it, paint the shape, inside colour, inside color, flaechenfarbe, flachenfarbe, fullfarbe, fullung, farbe der flache, " +
    "color de relleno, relleno, rellena, couleur de remplissage, remplissage, remplir de, 塗りの色, 塗り, 塗りつぶし, 填充颜色, 填充色, 填充, " +
    "paint it, paint in, pintalo, pintala, pintar de, pinta de, color del interior, color de dentro, color por dentro, farbe es, farbe sie, einfarben, anmalen, ausmalen, innenfarbe, farbe innen, farbe im inneren, farbe der innenflache, " +
    "peins le, peins la, peindre en, peinture, colorie en, couleur de l interieur, couleur interieure, couleur du fond, couleur de dedans, 塗って, 塗る, 塗り潰, 中の色, 内側の色, 中身の色, 涂成, 涂上, 涂色, 上色, 里面的颜色, 内部颜色, 内部的颜色, 里面颜色, 内侧颜色",
    "fill&color",
    5,
  ],
  [
    "line cap, rounded ends, round ends, square ends, butt ends, ends of the line, endkappen, linienenden, extremos redondeados, extremos de la linea, extremites arrondies, bouts du trait, 線端, 線の端, 端点形状, 线端, 端点",
    "cap",
    5,
  ],
  [
    "line join, joins, mitre, miter, sharp joins, pointy joins, ecken der linie, verbindung der linien, union de lineas, jonction des traits, 角の形状, 結合部, 线段连接, 连接",
    "join",
    5,
  ],
];

/** Rows for the character, paragraph and animator properties of a text layer, named by the look of the type. */
export const TEXT_WORDS: ReadonlyArray<ConceptRow> = [
  [
    "letterspacing, spacing of the letters, spacing between the letters, space the characters, space out the type, airy type, tight type, tighter letters, looser letters, " +
    "tight tracking, loose tracking, wide tracking, track out, tracked out, character spacing, sperren, gesperrt, spationierung, espaciado entre letras, espaciado de caracteres, separa mas, separar mas, separa mas las letras, letras mas separadas, mas separacion entre las letras, mas espacio entre las letras,  " +
    "interletraje, interlettrage, espacement des lettres, espacement des caracteres, crenage, 文字の間隔, 文字間隔, 文字送り, 字間を広げ, 字間を詰め, 字間を空け, 字距, 字间距, 字符间距, 文字间距, 间距, 拉开字距, 收紧字距",
    "tracking",
    5,
  ],
  [
    "line spacing, line height, lineheight, leading, space between lines, spacing between lines, spacing of the lines, gap between the lines, lines closer together, lines further apart, tighter lines, looser lines, paragraph spacing, " +
    "zeilenabstand, zeilenhohe, durchschuss, abstand zwischen den zeilen, interlineado, espacio entre lineas, espaciado de lineas, interligne, espacement des lignes, hauteur de ligne, 行間, 行送り, 行の間隔, 行间距, 行距, 行高",
    "leading line spacing",
    5,
  ],
  [
    "font size, text size, type size, size of the text, size of the type, size of the font, size of the letters, larger font, smaller font, point size, pt size, " +
    "schriftgrosse, schriftgroesse, textgrosse, tamano de fuente, tamano del texto, tamano de letra, taille de police, taille du taille de la police, " +
    "文字サイズ, 文字の大きさ, フォントサイズ, 字号, 字体大小, 文字大小",
    "size font",
    5,
  ],
  [
    "what it says, what the text says, change the wording, change the words, change the title, change the headline, new wording, new headline, new title, edit the text, edit the copy, rewrite the text, replace the words, swap the text, " +
    "swap the words, cambia el texto, cambia el titulo, cambiar el texto, cambia las palabras, edita el texto, corrige el texto, " +
    "text andern, text aendern, andere den text, den text anpassen, neuer text, anderen titel, neue uberschrift, change le modifie le change le titre, nouveau remplace le corrige la faute, " +
    "テキストを変更, テキストを変えて, テキストを書き換え, 文字を変更, 文言を変更, 文言変更, タイトルを変更, 誤字, 改文字, 改文案, 修改文字, 修改文案, 修改文本, 更换文字, 换文字, 文本内容, 文字内容, 改标题, 错别字",
    "source text",
    5,
  ],
  [
    "baseline shift, raise the text, lower the text, raise the letters, lower the letters, superscript, subscript, hochgestellt, tiefgestellt, linea base, desplazamiento de linea base, decalage de la ligne de base, " +
    "ベースラインシフト, 上付き, 下付き, 基线偏移, 上标, 下标",
    "baseline",
    5,
  ],
  [
    "skew the text, slant the text, italic angle, lean the text, oblique, faux italic, slanted letters, schrag stellen, kursiv neigen, inclinar el texto, cursiva falsa, pencher le 文字を傾け, 斜体, 斜め, 文字倾斜, 倾斜文字, 斜切",
    "skew",
    5,
  ],
];
