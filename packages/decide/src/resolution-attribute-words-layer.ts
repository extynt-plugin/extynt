// Request words for the transform properties of a layer in every language: fading, size, placement, turning and the pivot, with the everyday and misspelt forms.
import type { ConceptRow } from "./resolution-concepts.js";

/** Rows for opacity, scale, position, rotation and the anchor point, beyond the base transform table. */
export const LAYER_WORDS: ReadonlyArray<ConceptRow> = [
  [
    "fade in, fade away, fade up, fade down, make it appear, make it vanish, make it disappear, bring it in, bring it on, show it, ghost it, half visible, a bit see through, more visible, less visible, " +
    "opac, opacty, opasity, opacitiy, transparancy, tranparency, tranparent, alpha, einblenden, durchsichtiger, transparenter, sichtbar, unsichtbar, verblassen, aparecer, que aparezca, atenuar, " +
    "fundido de entrada, fundido de salida, mas transparente, menos transparente, faire apparaitre, apparaitre, faire disparaitre, rendre visible, plus transparent, moins transparent, " +
    "fondu entrant, fondu sortant, フェードイン, フェードアウト, 薄くして, 見えるように, 見えなくして, 濃く, 隠す, 表示して, 非表示, 淡入, 淡出, 渐显, 渐隐, 变透明, 隐藏, 显示出来, 消失, 显现, 虚一点, 淡一点",
    "opacity",
    4,
  ],
  [
    "biger, biggr, smaler, smalller, scal, sclae, rescale, upscale, downscale, blow up, shrink it, enlarge it, make it bigger, make it smaller, make it larger, make it tiny, make it huge, grow it, bump up the size, size it up, " +
    "size it down, zoom in on it, scale to fit, fill the frame, exactly twice, tamano, mas grande, mas pequeno, agrandar, achicar, encoger, escalar, hazlo mas grande, hazlo mas pequeno, grosser machen, kleiner machen, vergrossern, verkleinern, " +
    "skalieren, groesse, grosse, plus grand, plus petit, grossir, rapetisser, redimensionner, taille, fais le plus grand, fais le plus petit, サイズ, サイズを変更, 倍にする, 放大, 缩小, 大一点, 小一点, 变大, 变小, 缩放, 比例, 放大一点, 缩小一点",
    "scale",
    4,
  ],
  [
    "flip it horizontally, flip it vertically, flip horizontally, flip vertically, flip it over, mirror it, mirrored, mirror image, espejo, voltear, voltea, spiegeln, spiegelverkehrt, horizontal spiegeln, miroir, retourner, inverser horizontalement, " +
    "左右反転, 上下反転, 反転して, 镜像, 翻转, 水平翻转, 垂直翻转",
    "scale",
    4,
  ],
  [
    "pos, possition, postion, postition, positon, put it at, put it in, place it, set it at, shift it, scoot, slide it over, move it over, move it up, move it down, move it left, move it right, bring it to the left, bring it to the right, " +
    "muevelo, desplazalo, colocalo, ponlo en, ponlo a la izquierda, ponlo a la derecha, mas arriba, mas abajo, bewege es, setz es, platziere es, " +
    "deplace, deplacer, bouger, decaler, glisser, mets le a gauche, mets le a droite, plus haut, plus bas, en haut, en bas, positionne, 動かして, 移動して, 位置を変更, 左に寄せ, 右に寄せ, 上に上げ, 下に下げ, 中央に置い, 真ん中に, " +
    "移动, 往左, 往右, 向左, 向右, 往上, 往下, 挪, 平移, 滑动, 放到左边, 放到右边, 放到中间, 居中, 右上角, 左下角, 左上角, 右下角, 挪一点, 往旁边",
    "position",
    4,
  ],
  [
    "rotaion, rotatoin, roation, spinn, spin it, spin it around, turn it, turn it around, turn it over, tilt it, lean it, angle it, straighten it, level it out, wonky, off kilter, a full turn, a full rotation, one full turn, " +
    "half a turn, quarter turn, anticlockwise, counterclockwise, rotalo, inclinar, inclinalo, enderezar, sentido horario, sentido antihorario, dreh es, rotieren, kippen, " +
    "neigen, gerade ausrichten, im uhrzeigersinn, gegen den uhrzeigersinn, tourner, tourne le, faire tourner, incliner, pencher, redresser, sens horaire, sens antihoraire, 回す, 傾ける, 時計回り, 反時計回り, " +
    "旋转, 转动, 转一圈, 转起来, 倾斜, 歪, 摆正, 扶正, 顺时针, 逆时针, 自转, 转个",
    "rotation",
    4,
  ],
  [
    "anchorpoint, anchor pt, pivit, pivott, rotation centre, rotation center, centre of rotation, center of rotation, scale centre, scale center, pivot from the corner, rotate around the corner, rotate from the middle, scale from the middle, " +
    "scale from the corner, move the pivot, move the origin, drehpunkt, eje de giro, punto de giro, eje, pivote, centre de rotation, point pivot, centre de l echelle, 軸, 回転軸, 回転の中心, " +
    "锚点, 中心点, 旋转中心, 轴心, 轴心点, 缩放中心, 变换中心",
    "anchor",
    5,
  ],
];
