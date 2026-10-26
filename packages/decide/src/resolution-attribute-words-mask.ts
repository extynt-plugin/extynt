// Request words for growing or shrinking the area a mask lets through, in every language: the cutout, the hole, the mask edge pushed outward or pulled inward.
import type { ConceptRow } from "./resolution-concepts.js";
import { across } from "./resolution-word-pairs.js";

const MASK_NOUNS =
  "mask, cutout, cut out, hole, mask edge, mask outline, mask boundary, edge of the mask, " +
  "mascara, recorte, agujero, hueco, borde de la mascara, contorno de la mascara, borde del recorte, " +
  "maske, ausschnitt, loch, maskenkante, maskenrand, rand der maske, kante der maske, " +
  "masque, decoupe, trou, bord du masque, contour du masque, bord de la decoupe, " +
  "マスク, 切り抜き, 穴, マスクの縁, マスクのエッジ, 蒙版, 抠出的部分, 抠图, 洞, 镂空, 遮罩, 蒙版边缘, 蒙版的边缘";

const GROWING =
  "grow, shrink, expand, contract, inflate, deflate, choke, spread, push, pull, push out, pull in, widen, narrow, enlarge, reduce, swell, dilate, erode, tighten, loosen, outward, inward, bigger, smaller, larger, " +
  "agranda, agrandar, encoge, encoger, amplia, ampliar, expande, expandir, contrae, contraer, reduce, reducir, achica, achicar, empuja, empujar, infla, dilata, estrecha, ensancha, hacia afuera, hacia fuera, hacia dentro, hacia adentro, mas grande, mas pequena, " +
  "vergrossere, vergrossern, verkleinere, verkleinern, erweitere, erweitern, schrumpfe, schrumpfen, dehne, ausdehnen, aufblasen, schieb, schieben, zieh, ziehen, weiten, ausweiten, verenge, verengen, nach aussen, nach innen, schmaler, breiter, " +
  "agrandis, agrandir, retrecis, retrecir, rentre, rentrer, dilater, contracte, contracter, pousse, pousser, elargis, elargir, reduis, reduire, gonfle, gonfler, rapetisse, etends, etendre, resserre, vers l exterieur, vers l interieur, plus grand, plus petit, " +
  "広げ, 縮め, 拡張, 膨らま, 押し出し, 小さく, 大きく, 狭め, 拡大, 縮小, 引っ込め, 外側へ, 内側へ, 外へ, 内へ, " +
  "扩大, 缩小, 扩展, 收缩, 膨胀, 向外推, 往外推, 往里收, 往内收, 向内收, 扩张, 变大, 变小, 外扩, 内缩, 收紧";

/** The growing or shrinking of a mask's area, said of the mask, its cutout, its hole or its edge. */
export const MASK_WORDS: ReadonlyArray<ConceptRow> = [
  ["mask, cutout, hole, mascara, recorte, agujero, hueco, maske, ausschnitt, loch, masque, decoupe, trou", "mask", 1],
  [across(MASK_NOUNS, GROWING), "=mask_expansion", 7],
];
