// Plain designer wording for distortion, transition, time, perspective and particle effects: how a working motion designer asks for them without using the effect's own name.
import type { ConceptRow } from "./resolution-concepts.js";

const RADIAL_BLUR_WORDS = "zoom burst, zoom bursts, zoom burst blur, zoom blur burst, burst blur, burst smear, hyperspace, hyperspace streak, hyperspace streaks, hyperspace blur, warp speed, warp speed smear, warp speed streak, warp speed blur, punch in blur, punch in smear, punch blur, radial smear, radial streak, streak from the centre, streak from the center, streaks from the middle, streak out from the middle, streak outward from the centre, pull from the centre, pull from the center, pull from the middle, smear from the centre, smear from the center, smear from the middle, blur from the centre, blur from the center, blur out from the middle, spin blur around the centre, spin blur around the center, blur spinning around the centre, blur spinning around the center, spinning smear around a point, whirl blur, zoom smear, zoom streaks out, zoom blur from the centre, zoom blur from the center, zoomblur, desenfoque radial, desenfoque de zoom, desenfoque desde el centro, zoom desde el centro, zoom unscharfe, zoomunscharfe, unscharfe aus der mitte, radialer weichzeichner, ズームブラー, 放射状ブラー, 中心からぼかし, 中心から伸ばす";

/** Concept rows from everyday phrasing to the bundled distort, transition, time, perspective and simulation effects; a target written with "=" names that effect exactly. */
export const PLAIN_SHAPE_WORDS: ReadonlyArray<ConceptRow> = [
  ["warp it organically, organic warp, organic distortion, jelly, jello wobble, rubbery, flowing warp, haze wobble, ondulacion organica, organisch verzerren", "=turbulent_displace", 4],
  ["ondulacion, ondulacion horizontal, bewegt wie eine fahne, flaggenwelle, wellig, wellenform, sine wave, ola horizontal", "=wave_warp", 4],
  ["fisheye bulge, bulge the middle, puff out the centre, puff out the center, bubble out, bloat, pop out the middle, push out the centre, convex", "=bulge", 4],
  ["wrap it like a ball, wrap around a ball, wrap onto a ball, make it a ball, ball shape, turn it into a ball, orb, sphere look, round it out", "=spherize", 4],
  ["onto a globe, onto a sphere, 3d sphere, rotating sphere, spinning globe, planet, map it onto a globe", "=sphere", 4],
  ["wrap it around a cylinder, roll it into a tube, tube, cylinder, wrap around a can, label on a can", "=cylinder", 4],
  ["remolino, torbellino, tourbillon, spin the centre, spin into a vortex, swirl the middle, twist the middle, whirlpool", "=twirl", 3.5],
  ["bend it by dragging a grid, drag the mesh, mesh points, rubber sheet, grid warp, bend with a grid", "=mesh_warp", 4],
  ["bend it into a tunnel, tunnel effect, turn it into a ring, wrap into a circle, circular wrap, polar warp", "=polar_coordinates", 4],
  ["remove camera shake, remove the shake, smooth out the shake, steady the shot, steady the footage, smooth the handheld, handheld jitter, shaky footage, camera tembleque, verwackelt", "=warp_stabilizer stabilizer", 4],
  ["fix rolling shutter, rolling shutter, jello footage, jello effect, fix the jello, fix jello", "=rolling_shutter_repair", 5],
  ["convex lens, convex lens look, lens warp, glass lens look, round lens, big round lens", "=lens", 4],
  ["fix the lens distortion, remove lens distortion, undistort, lens correction, correct the fisheye, defish, de fish", "=optics_compensation", 4],
  ["offset the image, shift the image over, wrap it around and shift, scroll the image sideways, nudge the content, wraparound shift, shift and wrap, endless scroll, seamless scroll", "=offset", 4],
  ["peel the page, peel back, peel off, page flip, flip the page, turn the page over, book page, curl the corner, peeling corner, page peel, curled page", "=page_turn", 4],
  ["open up from a circle, circle opening up, opening up from the middle, open up like an iris, round reveal, grow from a circle", "=iris_wipe", 4],
  ["sweeping clock reveal, clock hand reveal, sweep around, sweeping reveal, rotating wipe, spin wipe, radial sweep, pie chart reveal, circular sweep", "=radial_wipe", 4],
  ["disintegrate into blocks, break into squares, pixel dissolve, blocky dissolve, fade out in blocks, random blocks fade", "=block_dissolve", 4],
  ["motion trails, trails behind, leave a trail, light trails, ghost trail, trailing copies, visual echo, frame echo, estela, rastro, nachzieheffekt", "=echo", 4],
  ["flat poster colours, poster colours, reduce the colours, reduce the colour levels, fewer colours, limited palette, limited colour palette, banded colours, screen print look, posterisieren", "=posterize", 3.5],
  ["black and white threshold, hard black and white, pure black and white, stark black and white, no greys, only black and white, high contrast cutout, two tone cutout, binary", "=threshold", 4],
  ["time warp slowdown, slow it down, slow down the footage, ease the speed, speed it up, speed up the footage, fast forward, retime the clip, slow mo, ralentizar, camara lenta, zeitlupe", "=timewarp", 4],
  ["stop motion look, stop motion, choppy, choppy low frame rate, low frame rate, lower frame rate, step the frame rate, drop the frame rate, on twos, on threes, jerky motion, stutter, cut the fps, 12 fps", "=posterize_time", 4],
  ["sparks flying, sparks shooting, confetti burst, floating particles, drifting particles, fireflies, embers floating, pixie dust, dust motes floating, shower of sparks", "=particle_world", 4],
  ["bevel the text, bevel text, bevel the logo, bevel the title, bevel the shape, bevel the letters, bevel the type, chiselled letters, raised letters, 3d raised edge, bevel the alpha", "=bevel_alpha", 4],
  ["relampago, blitz, eclair, bolt of lightning, lightning bolt", "=lightning", 3],
  ["nevar, nevando, schneien, neige, falling snow", "snowfall", 3],
  ["llover, lloviendo, regnet, regnerisch, pluie", "rainfall", 3],
  ["burbuja, seifenblasen, blasen, bulles, soap bubbles", "bubbles", 3],
  [RADIAL_BLUR_WORDS, "=ADBE_Radial_Blur", 5],
];
