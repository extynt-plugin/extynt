// Request words for looks described by a mood, a metaphor or an artistic style ("hazy", "sketchy line art", "old film"), each mapped to the After Effects effect that produces it.
import type { ConceptRow } from "./resolution-concepts.js";

/** Concept rows from figurative look language, in several languages, to the bundled effect that makes the look; a target written with "=" names that effect exactly. */
export const FIGURATIVE_WORDS: ReadonlyArray<ConceptRow> = [
  ["hazy, haze, dreamy, dreamlike, dream like, dream sequence, soft focus, out of focus, frosted, milky, veiled, vaporous, ethereal, nebuloso, vaporoso, enfoque suave, traumhaft, vertraumt, dunstig, diesig, flou artistique, brumeux, 夢のような, 幻想的, ふんわり, ソフトフォーカス, かすん, 霞, 朦朧, 梦幻, 몽환", "=gaussian_blur", 3],
  ["dreamy, dreamlike, ethereal, heavenly, angelic, radiant, soft glow, lovely glow, etereo, celestial, traumhaft, strahlend, 幻想的, 夢のような, 梦幻", "=glow", 2],
  ["radiate light, emit light, gives off light, shining, glowy, neon, neon sign, neon lights, luminous, radiant, lit up, light bloom, aura, laser, lightsaber, incandescent, fluorescent, leuchtreklame, neonlicht, leuchtend, brillante, luminoso, resplandeciente, lumineux, rayonnant, ネオン, 光る, 蛍光, 霓虹, 发光, 네온", "=glow glow", 3.5],
  ["sketch, sketchy, sketched, line art, lineart, line drawing, pencil, pen and ink, ink drawing, outlines only, edge detect, edge detection, detect the edges, trace the edges, find the edges, contour, boceto, bosquejo, dibujo a lapiz, dibujo lineal, contorno, skizze, zeichnung, umriss, kontur, strichzeichnung, croquis, esquisse, dessin au trait, スケッチ, 線画, 輪郭, 鉛筆, 素描, 草图, 线稿, 스케치, 선화", "=find_edges", 4],
  ["cycle the colors, cycle colors, color cycle, color cycling, colors cycle, cycle through colors, around the wheel, color wheel, rainbow, psychedelic, trippy, iridescent, holographic, prismatic, thermal, heat map, false color, gradient map, ciclo de color, ciclar colores, arcoiris, arco iris, psicodelico, regenbogen, farbzyklus, farbrad, psychedelisch, arc en ciel, cycle de couleurs, 虹, レインボー, サイケ, 色を循環, 色相環, 彩虹, 무지개", "=colorama", 3.8],
  ["cycle the colors, color cycle, color cycling, around the wheel, color wheel, hue cycle, hue rotation, rotate the hue, rotate the colors, shift the colors, color shift, desplazar el color, farben verschieben, décaler les couleurs, 色相環, 色をずら", "=hue_saturation", 3.2],
  ["old film, vintage film, aged film, film look, film stock, 8mm, 16mm, super 8, retro film, analog look, old footage, aged footage, old movie, silent movie, silent film, home movie, pelicula antigua, pelicula vieja, cine antiguo, alter film, alte filme, filmkorn, vieux film, film ancien, 古いフィルム, 昔の映画, フィルム風, 古い映像, 老电影, 老胶片, 옛날 영화", "=add_grain", 3.5],
  ["black and white, black n white, b&w, bw, monochrome, monocromo, monochrom, grayscale, greyscale, film noir, noir, blanco y negro, schwarzweiss, noir et blanc, 白黒, モノクロ, 黑白, 흑백", "=black_white", 4],
  ["melt, melting, melted, molten, liquid, liquefy, drip, dripping, goo, gooey, wet paint, smudge the pixels, push the pixels, derretir, derretido, fundir, schmelzen, geschmolzen, fondre, fondu, 溶ける, 溶けた, とろける, 融化, 녹", "=liquify", 4],
  ["ripple, ripples, rippling, pond, water drop, raindrop on water, concentric, shockwave, water surface, puddle, ondas en el agua, ondas en agua, ondas del agua, wasserwellen, ondas de agua, ondulaciones, rizos, ondulation, 波紋, さざ波, 水面, 涟漪", "=ripple ripple", 4],
  ["wobble, wobbly, heat haze, heat shimmer, shimmer, mirage, hot air, underwater, water distortion, glassy distortion, organic warp, tembloroso, ondulante, wackeln, flimmern, trouble, 陽炎, ゆらゆら, ゆらめき, 揺らぐ, 摇晃", "=turbulent_displace", 4],
  ["flag, flag waving, waving flag, banner, flutter, cloth in the wind, billow, sway, ondeando, bandera, fahne, flagge, drapeau, 旗, はためく, なびく, 飘扬", "=wave_warp", 4],
  ["static, tv static, white noise, interference, speckle, snow on the tv, ruido de tv, fernsehrauschen, neige, 砂嵐, ザラザラ", "=noise", 3],
  ["posterize, posterise, posterized, poster look, limited palette, reduce the colors, flat colors, banding, posterizar, plakatiert, 階調, ポスタリゼーション", "=posterize", 4],
  ["fisheye, fish eye, barrel distortion, lens distortion, wide angle, gopro, peephole, ojo de pez, objektivverzerrung, fisheye objektiv, 魚眼, フィッシュアイ, 鱼眼", "=optics_compensation", 4],
  ["oil paint, oil painting, painterly, watercolor, paint strokes, brush strokes, brushed, impressionist, painted look, pintura al oleo, acuarela, olgemalde, aquarell, peinture, 油絵, 水彩, 絵画風, 油画", "=brush_strokes", 4],
  ["lift the shadows, open the shadows, open up the shadows, recover the shadows, recover highlights, bring back the highlights, shadow detail, highlight detail, tame the highlights, backlit, backlight fix, recuperar sombras, schatten aufhellen, deboucher les ombres, 暗部を持ち上げ, シャドウを明るく", "=shadow_highlight", 4],
  ["remove noise, denoise, noise reduction, reduce the noise, reduce noise, clean up the grain, remove the grain, clean up noise, reducir ruido, rauschen entfernen, reduire le bruit, ノイズ除去, ノイズを減らす, 降噪", "=remove_grain", 4],
  ["despeckle, remove dust, remove specks, remove scratches, dust and scratches, clean up scratches, eliminar polvo, staub entfernen, ゴミ取り", "=dust_scratches", 4],
  ["distressed, grunge, grungy, torn paper, ragged edges, rough edges, eroded, worn edges, ink bleed, burnt edges, desgastado, zerrissen, ausgefranst, abime, ボロボロ, 擦り切れ, 粗糙", "=roughen_edges", 4],
  ["paper texture, canvas texture, textured surface, rough surface, texture overlay, textura de papel, papiertextur, テクスチャ, 質感", "=texturize", 3],
  ["warm, warmer, cool tone, cooler, warm tone, golden hour, color cast, sunset tone, sepia tone, calido, mas calido, warme farben, wärmer, kuhler, chaud, 暖かい色, 暖色, 寒色", "=photo_filter", 3],
  ["pop, vivid, vibrant, punchy colors, make the colors pop, colores vivos, lebendige farben, couleurs vives, 鮮やか, 発色, 鲜艳", "=vibrance", 3],
  ["clouds drifting, fog bank, fire effect, on fire, flames, burning, plasma, lava, nebula, fuego, llamas, flammen, 炎, 云雾", "=fractal_noise", 3],
  ["miniature, tilt shift, diorama, toy like, tiltshift, modellbau, maqueta, ミニチュア, 模型風", "=camera_lens_blur", 4],
];
