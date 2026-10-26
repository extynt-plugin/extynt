// Request words for the common controls of the bundled effects in every language: blur, glow, shadow, gradient ramp, wipe and the colour correction controls.
import type { ConceptRow } from "./resolution-concepts.js";

/** Rows for the amount, direction, length, radius, intensity, threshold, distance, softness and angle controls of blur, glow and shadow effects. */
export const EFFECT_AMOUNT_WORDS: ReadonlyArray<ConceptRow> = [
  [
    "blur amount, amount of blur, how much blur, blur radius, radius of the blur, blur size, size of the blur, strength of the blur, defocus it more, soften the focus, bluriness, blurryness, burriness, " +
    "staerke der unschaerfe, starke der unschaerfe, weichzeichnungsstarke, unscharferadius, weichzeichnerradius, mehr weichzeichnen, cantidad de desenfoque, radio de desenfoque, intensidad del desenfoque, mas desenfocado, " +
    "quantite de flou, intensite du flou, rayon du flou, plus flou, flou plus fort, force du flou, ぼかしの量, ぼかし量, ブラーの量, ぼかし半径, ぼかしの半径, ぼかしの強さ, ブラーの強さ, もっとぼかし, 模糊量, 模糊程度, 模糊半径, 模糊强度, 模糊度, 更模糊",
    "blurriness radius amount",
    3,
  ],
  [
    "direction of the blur, blur direction, blur angle, angle of the blur, which way the blur goes, which way it blurs, motion direction, direction of the motion, blur diagonally, tilt the blur, rotate the blur, richtung der unschaerfe, " +
    "unscharferichtung, richtung der bewegungsunschaerfe, direccion del desenfoque, angulo del desenfoque, direction du flou, angle du flou, sens du flou, ぼかしの方向, ぼかしの角度, ブラーの方向, ブラーの角度, 模糊方向, 模糊角度, 运动方向",
    "direction angle",
    4,
  ],
  [
    "blur length, length of the blur, how long the streaks, longer streaks, shorter streaks, smear length, longer smear, how far it smears, longer motion trail, laenge der unschaerfe, lange der unschaerfe, streifenlange, " +
    "longitud del desenfoque, longitud de la estela, longueur du flou, longueur de la trainee, ぼかしの長さ, ブラーの長さ, 流れの長さ, 模糊长度, 拖尾长度, 拖影长度",
    "length",
    4,
  ],
  [
    "glow radius, radius of the glow, glow size, size of the glow, glow spread, spread of the glow, bloom size, bloom radius, halo size, size of the halo, how far the glow reaches, how far the glow spreads, how far the light bleeds, glow reach, " +
    "wider glow, bigger glow, tighter glow, smaller glow, leuchtradius, glowradius, radius des glows, grosse des glows, grosse des leuchtens, ausbreitung des leuchtens, radio del brillo, radio del resplandor, radio del glow, " +
    "tamano del resplandor, tamano del brillo, rayon de la lueur, rayon du glow, taille de la lueur, taille du halo, グローの半径, グロー半径, グローの大きさ, 光の広がり, 光のにじみ, 発光の範囲, 辉光半径, 发光半径, 发光范围, 光晕大小, 辉光大小, 光晕范围",
    "radius",
    4,
  ],
  [
    "glow intensity, intensity of the glow, glow strength, strength of the glow, glow power, glow brightness, how bright the glow, hotter glow, stronger glow, more bloom, bloom amount, bloom intensity, glow amount, how much it glows, " +
    "how intense the glow, glow-intensitat, glow intensitat, leuchtstarke, leuchtintensitat, starke des glows, intensitat des leuchtens, intensidad del brillo, intensidad del resplandor, intensidad del glow, fuerza del glow, " +
    "intensite de la lueur, intensite du glow, force de la lueur, force du glow, グローの強さ, グロー強度, 発光の強さ, 発光の強度, 辉光强度, 发光强度, 发光亮度, 光晕强度, 辉光亮度",
    "intensity",
    4,
  ],
  [
    "glow threshold, threshold of the glow, only the brightest, what glows, which parts glow, what starts to glow, where it begins to glow, glow cutoff, glow cut off, schwellenwert des glows, glow schwelle, schwelle, leuchtschwelle, " +
    "umbral del brillo, umbral del resplandor, umbral del glow, seuil de la lueur, seuil du glow, seuil de luminosite, seuil, グローしきい値, グローのしきい値, 発光のしきい値, 辉光阈值, 发光阈值, 阈值, 亮度阈值",
    "threshold",
    4,
  ],
  [
    "shadow distance, distance of the shadow, shadow offset, offset of the shadow, how far the shadow is, how far the shadow falls, how far the shadow sits, shadow gap, lift the shadow, drop it further, closer shadow, nearer shadow, " +
    "schattenabstand, abstand des schattens, schattenversatz, schatten weiter weg, schatten naher, distancia de la sombra, separacion de la sombra, desplazamiento de la sombra, sombra mas lejos, sombra mas cerca, " +
    "distance de l ombre, decalage de l ombre, ombre plus loin, ombre plus proche, 影の距離, 影のオフセット, 影の位置, 影を離す, 影を近づけ, 阴影距离, 阴影偏移, 投影距离, 阴影远一点, 阴影近一点",
    "distance offset",
    4,
  ],
  [
    "shadow softness, softness of the shadow, how soft the shadow, soft shadow, blur of the shadow, shadow spread, penumbra, shadow feather, feather the shadow, fuzzy shadow, " +
    "schattenweichheit, weichheit des schattens, weicher schatten, harter schatten, schattenunschaerfe, schatten weichzeichnen, suavidad de la sombra, sombra suave, sombra dura, sombra difuminada, difuminar la sombra, " +
    "douceur de l ombre, ombre douce, ombre dure, ombre floue, flou de l ombre, adoucir l ombre, 影のぼかし, 影の柔らかさ, 影のやわらかさ, 影のぼかし量, 阴影柔和度, 阴影模糊, 阴影羽化, 柔和度, 软阴影, 硬阴影",
    "softness",
    4,
  ],
  [
    "shadow direction, direction of the shadow, shadow angle, angle of the shadow, light angle, where the shadow falls, which way the shadow falls, which way the shadow goes, shadow falls to the, shadow points, schattenrichtung, " +
    "richtung des schattens, schattenwinkel, direccion de la sombra, angulo de la sombra, hacia donde cae la sombra, direction de l ombre, angle de l ombre, ou tombe l ombre, 影の方向, 影の角度, 影の向き, 阴影方向, 阴影角度, 投影方向, 光源角度, 光线角度",
    "direction angle",
    4,
  ],
  [
    "shadow opacity, opacity of the shadow, how dark is the shadow, how dark the shadow is, how faint the shadow, darker shadow, lighter shadow, fainter shadow, shadow visibility, shadow density, schattendeckkraft, deckkraft des schattens, " +
    "dunklerer schatten, hellerer schatten, opacidad de la sombra, sombra mas oscura, sombra mas clara, opacite de l ombre, ombre plus foncee, ombre plus claire, 影の不透明度, 影の濃さ, 影の濃度, 阴影不透明度, 阴影浓度, 阴影深浅, 阴影淡一点",
    "opacity",
    4,
  ],
  [
    "shadow color, shadow colour, colour the shadow, color the shadow, tint the shadow, shadow tint, schattenfarbe, farbe des schattens, schatten einfarben, color de la sombra, colorear la sombra, couleur de l ombre, colorer l ombre, " +
    "影の色, 影に色, 阴影颜色, 阴影色, 投影颜色, 给阴影上色",
    "color",
    4,
  ],
  [
    "颜色, 色彩, 换颜色, 改颜色, 变色, 着色, 色味, 色合い",
    "color",
    3,
  ],
];

/** Rows for the start, end, shape, scatter and blend controls of a gradient ramp and for the completion, angle and feather controls of a wipe. */
export const EFFECT_RAMP_WORDS: ReadonlyArray<ConceptRow> = [
  [
    "gradient start, start of the gradient, where the gradient starts, where the gradient begins, top of the gradient, gradient start point, gradient from, first point of the gradient, ramp start, start point, startpunkt, " +
    "start des verlaufs, verlaufsstart, anfang des verlaufs, inicio del degradado, comienzo del degradado, punto inicial, debut du degrade, point de depart du degrade, point de depart, " +
    "グラデーションの開始, グラデーションの始点, ランプの開始, 開始位置, 渐变起点, 渐变开始, 渐变起始点, 起始点",
    "start =start_of_ramp",
    5,
  ],
  [
    "gradient end, end of the gradient, where the gradient ends, where the gradient stops, bottom of the gradient, gradient end point, gradient to, last point of the gradient, ramp end, end point, endpunkt, ende des verlaufs, " +
    "verlaufsende, final del degradado, punto final, fin du degrade, point d arrivee du degrade, point d arrivee, グラデーションの終了, グラデーションの終点, ランプの終了, 渐变终点, 渐变结束, 渐变结束点, 终止点",
    "end =end_of_ramp",
    5,
  ],
  [
    "start colour, start color, colour at the start, color at the start, top colour, top color, first gradient colour, first gradient color, colour of the start, startfarbe, anfangsfarbe, farbe am anfang, color inicial, " +
    "color de inicio, couleur de depart, couleur de debut, 開始色, 開始カラー, 起始颜色, 起始色, 开始颜色",
    "start color =start_color",
    5,
  ],
  [
    "end colour, end color, colour at the end, color at the end, bottom colour, bottom color, last gradient colour, last gradient color, endfarbe, zielfarbe, farbe am ende, color final, color de fin, couleur d arrivee, couleur de fin, " +
    "終了色, 終了カラー, 终止颜色, 结束颜色, 结束色, 终点颜色",
    "end color =end_color",
    5,
  ],
  [
    "gradient shape, shape of the gradient, gradient type, type of gradient, linear or radial, radial gradient, linear gradient, switch to radial, make it radial, make it linear, circular gradient, verlaufsform, verlaufstyp, " +
    "forma del degradado, tipo de degradado, forme du degrade, type de degrade, グラデーションの形状, グラデーションの種類, ランプシェイプ, 渐变类型, 渐变形状, 线性渐变, 径向渐变",
    "shape type =ramp_shape",
    5,
  ],
  [
    "scatter, dither, dithering, banding, kill the banding, remove banding, smooth out the banding, noise in the gradient, grain in the gradient, break up the gradient, streuung, tramado, dispersion, grain du degrade, " +
    "ディザ, スキャッター, 散布, ランプのスキャッター, 抖动, 渐变散射, 散射, 去色带",
    "scatter =ramp_scatter",
    5,
  ],
  [
    "blend with original, blend with the original, mix with the original, mix with original, how much of the original, original showing through, let the original through, mit original mischen, mezclar con el original, " +
    "melanger avec l original, 元画像とブレンド, 元の画像と混ぜる, 与原始图像混合, 与原图混合, 混合原图",
    "blend =blend_with_original",
    5,
  ],
  [
    "wipe progress, progress of the wipe, how far the wipe has gone, how much has wiped, how much is wiped, wipe percentage, percent wiped, transition completion, completion of the transition, how much of the transition, wipe position, " +
    "progress of the reveal, uebergangsfortschritt, ubergangsfortschritt, fortschritt der ueberblendung, fortschritt des wischens, finalizacion de la transicion, progreso del barrido, avance del barrido, avancement de la transition, " +
    "achevement de la transition, progression du balayage, avancement du balayage, 変換終了, ワイプの進行, ワイプの進み, ワイプの量, 过渡完成, 过渡完成度, 擦除进度, 擦除程度, 擦除百分比",
    "completion",
    5,
  ],
  [
    "wipe angle, angle of the wipe, wipe direction, direction of the wipe, which way it wipes, which way the wipe goes, wipe the other way, reverse the wipe direction, wischwinkel, wischrichtung, richtung des wischens, angulo del barrido, " +
    "direccion del barrido, angle du balayage, sens du balayage, direction du balayage, ワイプ角度, ワイプの角度, ワイプの方向, 擦除角度, 擦除方向, 过渡方向, 过渡角度",
    "angle",
    5,
  ],
  [
    "wipe feather, feather the wipe, feather of the wipe, soft wipe edge, hard wipe edge, soft edge on the wipe, softness of the wipe, wipe edge, edge of the wipe, kante des wischers, weiche wischkante, weiche kante beim wischen, " +
    "borde suave del barrido, borde del barrido, suavizar el barrido, bord adouci du balayage, bord du balayage, adoucir le balayage, ワイプのぼかし, ワイプの境界, 擦除羽化, 过渡羽化, 擦除边缘, 擦除柔和度",
    "feather",
    5,
  ],
];

/** Rows for the hue, gamma, black, white, exposure and temperature controls of colour correction effects. */
export const EFFECT_COLOUR_WORDS: ReadonlyArray<ConceptRow> = [
  [
    "hue shift, rotate the hue, turn the hue, spin the colours, spin the colors, cycle the colours, cycle the colors, around the colour wheel, farbton verschieben, farbton drehen, desplazar el tono, cambia el tono, " +
    "decaler la teinte, change la teinte, teinte, 色相をずらす, 色相を回す, 色相を変える, 色相偏移, 色相旋转, 改变色相, 调整色相",
    "hue =master_hue",
    5,
  ],
  [
    "saturation, more vivid, more colour, more color, less colour, less color, bring down the colour, bring down the color, mute the colours, mute the colors, richer colours, " +
    "richer colors, punchy colours, punchy colors, drain the colour, drain the color, grayscale, greyscale, black and white, b&w, bw, monochrome, farbsattigung, mehr farbe, weniger farbe, entsattigen, farben dampfen, saturacion, " +
    "mas color, menos color, desaturar, blanco y negro, plus de couleur, moins de couleur, desaturer, noir et blanc, 彩度を下げ, 彩度を上げ, 鮮やかさ, モノクロ, 白黒, 饱和度, 更鲜艳, 更艳, 褪色, 去色, 黑白, 灰一点",
    "saturation =master_saturation",
    5,
  ],
  [
    "lightness, brightness, brightness of the image, lighter overall, darker overall, lift the image, darken the image, brighten the image, lighten the image, helligkeit, heller machen, dunkler machen, luminosidad, mas luminoso, " +
    "aclarar la imagen, oscurecer la imagen, luminosite, eclaircir, assombrir, plus lumineux, 明度, 明るさを上げ, 明るさを下げ, 暗くする, 明るくする, 亮度, 提亮, 变亮, 变暗, 调亮, 调暗",
    "lightness brightness =master_lightness",
    4,
  ],
  [
    "contrast, flat look, crush the contrast, boost the contrast, kontrast erhohen, kontrast senken, mehr kontrast, weniger kontrast, mas contraste, menos contraste, plus de contraste, " +
    "moins de contraste, コントラストを上げ, コントラストを下げ, コントラスト強め, 对比度, 反差, 增加对比, 降低对比, 对比强一点",
    "contrast",
    4,
  ],
  [
    "gamma, midtones, mid tones, mids, midtone, the middle tones, mitteltone, medios tonos, tonos medios, tons moyens, ガンマ, 中間調, 中間のトーン, 伽马, 中间调, 中间色调",
    "gamma",
    4,
  ],
  [
    "crush the blacks, lift the blacks, deepen the blacks, raise the blacks, lower the blacks, black level, schwarzpunkt, schwarzwert, tiefen absenken, punto negro, nivel de negro, negros, point noir, niveau de noir, noirs, " +
    "黒レベル, ブラックポイント, 黒を締める, 黒を持ち上げ, 黑场, 黑色阶, 黑电平, 压黑, 提黑",
    "black =input_black",
    5,
  ],
  [
    "clip the whites, lift the whites, push the whites, pull down the whites, white level, weisspunkt, weisswert, lichter anheben, punto blanco, nivel de blanco, blancos, point blanc, niveau de blanc, blancs, " +
    "白レベル, ホワイトポイント, 白を伸ばす, 白を抑える, 白场, 白色阶, 白电平, 提白, 压白",
    "white =input_white",
    5,
  ],
  [
    "exposure, overexposed, underexposed, overexpose, underexpose, expose more, expose less, f stops up, f stops down, stops brighter, belichtung, uberbelichtet, unterbelichtet, exposicion, sobreexpuesto, subexpuesto, exposition, " +
    "surexpose, sous expose, 露出, 露光, 露出オーバー, 露出アンダー, 曝光, 曝光度, 过曝, 欠曝",
    "exposure",
    4,
  ],
  [
    "warmth, warmer, warm up, cooler, cool down, colder, make it warm, make it cool, make it cold, kelvin, white balance, color temperature, colour temperature, temperature, warmer tones, cooler tones, " +
    "farbtemperatur, warmer machen, kalter machen, warmere farben, kaltere farben, weissabgleich, temperatura de color, mas calido, mas frio, calido, calidez, balance de blancos, temperature de couleur, plus chaud, plus froid, " +
    "balance des blancs, 色温度, 色温, 暖かく, 冷たく, 暖色, 寒色, ホワイトバランス, 暖一点, 冷一点, 偏暖, 偏冷, 更暖, 更冷, 白平衡",
    "temperature",
    4,
  ],
  [
    "vibrance, vibrant, natural saturation, protect the skin tones, dynamische sattigung, vibrancia, vibrance, 自然な彩度, 自然饱和度, 鲜明度",
    "vibrance",
    4,
  ],
];
