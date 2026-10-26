// Plain designer wording for the blur, sharpen, glow, stylize, noise and grain effects: the verbs, nouns and adjectives a working motion designer uses where the effect's own name never appears.
import type { ConceptRow } from "./resolution-concepts.js";

const PIXEL_BLOCK_WORDS = "censor it with blocks, censor with blocks, censor block, censor blocks, censor the face, censor the logo, pixel block over, pixel blocks over, blocks of pixels, big pixel blocks, big pixel effect, big pixels on, chunky blocks, chunky squares, chunky block look, chunky pixel look, blocky look, blocky image, make it blocky, make it chunky, make it low res, low res look, low res effect, retro low res, retro blocky, 8 bit blocks, blocks of colour, blocks of color, big square pixels, square pixels, pixelate the face, pixelate the logo, dot art, dot art look, make it dot art, pixelar en bloques, bloques grandes, pixeles grandes, efecto de bloques, censurar con bloques, den hintergrund grob verpixeln, grobe klotze, blockig machen, blockeffekt, verpixelter look, ドット絵風, ドット絵, 粗いピクセル, 低解像度, ブロック状にする";

const LOOK_AGAINST_PIXEL_MOTION = "censor, censored, censoring, censors, blocky, chunky, pixelate, pixelated, pixelation, pixelise, pixelize, low res, mosaic, blocks of colour, blocks of color, censor block, censor blocks, censor the face, chunky blocks, big pixel blocks, verpixelt, verpixeln, pixelar, pixelado";
const MOTION_AGAINST_MOSAIC = "motion blur, motion, movement, moving, fast move, fast moving, streak, streaks, motion smear, speed streak, bewegung, bewegt, bewegen, movimiento, movimiento rapido, en movimiento, movimento";
/** Concept rows from everyday phrasing to the bundled blur, stylize, noise and grain effects; a target written with "=" names that effect exactly. */
export const PLAIN_LOOK_WORDS: ReadonlyArray<ConceptRow> = [
  ["fuzz it, fuzz out, fuzz it out, soft blur, smudge out, blur it out, blur out, blur the background, blur background, blur the backdrop, make it blurry, desenfoca el fondo, fondo borroso, hintergrund verwischen, hintergrund unscharf", "=gaussian_blur", 3.5],
  ["speed streak, speed streaks, speed blur, sideways blur, smear sideways, smear it sideways, smear across, whoosh blur, blur in one direction, bewegungsrichtung, richtungsunscharfe, bewegungsunscharfe, desenfoque de movimiento, desenfoque direccional, flou directionnel", "=directional_blur", 4],
  ["blur using another layer, blur by another layer, blur by a map, blur map, blur controlled by a layer, blur according to a layer, variable blur, depth map blur, blur with a map", "=compound_blur", 4],
  ["smooth skin, skin smoothing, smooth the skin, retouch skin, airbrush skin, beauty blur, edge preserving blur, blur but keep the edges, glatte haut, suavizar piel", "=bilateral_blur", 4],
  ["afilar, aguzar, mas nitido, nachscharfen, nachschärfen, crisp up, plus net, accentuer, pull the detail out, bring out the detail", "=sharpen", 3],
  ["soft halo, light halo, halo around, light bleed, bleeding light, glowing edges, leuchteffekt, brillo suave, halo de luz, lumiere diffuse", "=glow", 3],
  ["blocky pixels, chunky pixels, big pixels, low res, low resolution, lo fi pixels, pixel art, retro pixels, 16 bit, 8 bit look, pixelig, verpixelt, verpixeln, pixeliger, pixelado, pixelada, pixelise, pixelate, pixelat", "=mosaic", 3.5],
  ["turn it into an outline, turn it into outlines, turn into outlines, outlines only, outline version, edge detect, edge detection, trace the edges, edges only, contour lines, kontur, contornos", "=find_edges", 3.5],
  ["ragged, ragged edges, rough edges, rough up, rough up the edges, grungy edges, distressed edges, burnt edges, burnt paper, torn edges, jagged edges, worn edges, zerfetzt, zerfranst, bordes rotos, bordes desgastados", "=roughen_edges", 3.5],
  ["paint it solid, paint the layer solid, make it solid, solid black, solid white, solid red, solid blue, solid green, solid colour, solid color, flat fill, colour it in", "=fill", 3.5],
  ["smoky, smoky texture, wispy, fog drifting, drifting fog, rolling fog, billowing, organic texture, organic noise, cloudy texture, smoke texture, nebulous, rauchig, nebel, humo, niebla", "=fractal_noise", 4],
  ["sepia tone, old photo tone, vintage tint, monochrome blue, monochrome red, monochrome green, single colour wash, one colour look, warm monochrome, two tone look", "=tint", 3.5],
  ["tv static, tv snow, snow on a tv, white noise, digital noise, analog noise, noise overlay, speckle, speckled, flimmern, nieve de tv", "=noise", 3.5],
  ["add some grain, some grain, a little grain, grainy look, gritty film, film look grain, filmkorn, granulado, 35mm look, 16mm look, analog film look, korn hinzufugen, mas grano", "=add_grain", 4],
  ["denoise, de noise, noise reduction, clean up the noise, remove noise, get rid of grain, rauschen entfernen, quitar ruido, reduce grain", "=remove_grain", 4],
  ["remove dust, dust spots, specks, remove specks, clean up specks, scratches, remove scratches, fix scratches, despeckle, sensor dust, staub entfernen, quitar polvo, scratch, scratched, old film scratches, film scratches, scratches from old film, scratches from film, aranazos, arañazos, quita los aranazos, rayones, kratzer, kratzer entfernen, kratzer weg, kratzern, rayures, enleve les rayures, retire les rayures, 傷を取, 傷を消, 傷を除去, フィルムの傷, 古いフィルムの傷, 划痕, 刮痕, 去除划痕, 去掉划痕, 去除刮痕, 去掉刮痕, 去掉灰尘, 去除灰尘", "=dust_scratches", 4],
  ["median filter, median blur, flatten into blobs, flat painted blobs, paint smoothing, smooth flat areas, smoothed paint look, mediano", "=median", 4],
  ["scatter the pixels, scattered pixels, break up the pixels, disperse, dispersion, dispersal, jitter the pixels, spread the pixels out, pixel scatter", "=scatter", 3],
  ["painterly, painterly look, oil painting, oil paint, painted look, impressionist, like a painting, hand painted look, malerisch, pintura al oleo, looks painted, look painted, painted with brush strokes, painted by hand, brushwork, brush work, hand painted, pincelada, pinceladas, a pinceladas, pintado a mano, parece pintado, aspecto pintado, efecto pintura, como un cuadro, como una pintura, pinselstrich, pinselstriche, pinselstrichen, pinselduktus, wie gemalt, wie ein gemalde, wie von hand gemalt, malerischer look, coup de pinceau, coups de pinceau, rendu peint, aspect peint, effet peinture, comme une peinture, comme un tableau, 筆で描いた, 筆のタッチ, 筆跡, 絵筆, ブラシストローク, 絵の具, 絵画のよう, 絵画っぽ, 笔触, 画笔, 毛笔, 笔刷, 绘画效果, 绘画风格, 油画效果, 像油画, 像画一样, 手绘效果", "=brush_strokes", 3.5],
  ["canvas texture, paper texture, apply a texture, add a texture, texture from another layer, textured surface, fabric texture, concrete texture, grunge texture, textura de lienzo, leinwandstruktur", "=texturize", 3.5],
  ["smear a patch, smudge, smudge it, smudge the pixels, drag the pixels like paint, finger paint, smear the area", "=smear", 4],
  ["toon shading, comic look, comic style, flat cel look, anime look, cell shading, celshade, cartoonify, cartoonise, cartoonize, dibujo animado, zeichentrick", "=cartoon", 3.5],
  ["raised relief, relief look, stamped, stamped into, stamped into the surface, debossed, letterpress, carved, engraved, praegung, prägung, en relieve", "=emboss", 3.5],
  ["flashing light, flashing lights, strobe flash, white flash, flash frame, blinking light, disco flash, destello rapido, blitzlicht", "=strobe_light", 3.5],
  ["repeat the image, repeat it, copies in a grid, grid of copies, repeat in a grid, repeated copies, endless repeat, repetir imagen, wiederholen", "=motion_tile tile", 3.5],
  ["kaleidoscopic pattern, mandala, symmetrical pattern, psychedelic pattern, kaleido, kaleidoscopio", "kaleida", 4],
  ["frosted glass, frosted glass look, glass refraction, glass distortion, glassy refraction, through glass, shower glass, ice look, cristal esmerilado, milchglas", "=glass", 4],
  ["honeycomb, honeycomb texture, voronoi, cellular texture, cells texture, hexagon pattern, reptile skin, panal, wabenmuster", "=cell_pattern", 4],
  ["checker pattern, checker, chequered, checkered, chess board, chessboard, alternating squares, damero, schachbrett", "=checkerboard", 4],
  ["ring shape, ring outline, ring shape outline, draw a ring, a plain ring, round ring, a solid disc", "=circle", 3.5],
  ["outline the path, stroke the path, trace the mask, stroke along, along a mask path, line along the path, path outline, draw along the path", "=stroke", 4],
  ["expanding rings, expanding sonar rings, sonar, sonar rings, sonar ping, radar ping, signal rings, broadcast waves, concentric rings expanding, concentric waves", "=radio_waves", 4],
  ["marching ants, chasing lights, running lights, light chaser, dashes moving along, dashed line travelling, animated dashes, marquee lights", "=vegas", 4],
  ["music bars, sound bars, eq bars, beat bars, music visualiser, music visualizer, bars dancing to the music, level meters, barras de musica", "=audio_spectrum", 4],
  ["laser beam, laser line, shooting beam, ray of light line, shoot a line of light, light ray line", "=beam", 4],
  [PIXEL_BLOCK_WORDS, "=mosaic", 6],
  [LOOK_AGAINST_PIXEL_MOTION, "=ADBE_Pixel_Motion_Blur", -3],
  [MOTION_AGAINST_MOSAIC, "=mosaic", -3],
];
