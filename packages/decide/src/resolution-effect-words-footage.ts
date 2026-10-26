// Plain wording, in every language, for effects that fix or dress footage: rolling shutter jelly, handheld shake, a spectrum of bars, a frame counter, a keyed screen, a tiled grid, a sideways smear, a lens blur and a ball to wrap onto.
import type { ConceptRow } from "./resolution-concepts.js";
import { across, chain } from "./resolution-word-pairs.js";

const JELLY = "jelly, jello, wobble, gelatin, gelee, wackelpudding, gummi, ゼリー, ぷるぷる, 果冻";

const CLIP =
  "clip, footage, video, shot, phone camera, phone, camera, mobile, " +
  "clip, video, movil, camara, " +
  "clip, video, handy, kamera, " +
  "plan, video, telephone, camera, " +
  "クリップ, 動画, 映像, スマホ, " +
  "视频, 手机, 素材, 镜头, 拍摄";

const MENDING =
  "fix, remove, repair, get rid, " +
  "arregla, quita, corrige, " +
  "behebe, entferne, " +
  "corrige, enleve, " +
  "直, 取, 消, " +
  "修复, 去掉, 去除";

const REMOVING = "去掉, 去除";

const BARS =
  "bars, bar, columns, " +
  "barras, " +
  "balken, " +
  "barres, " +
  "棒, バー, " +
  "柱子, 柱";

const MUSIC =
  "song, music, audio, sound, track, beat, " +
  "cancion, musica, " +
  "song, lied, musik, " +
  "chanson, musique, " +
  "曲, 音楽, " +
  "歌曲, 音乐, 声音";

const SHAKE =
  "shake, shaky, jitter, tremor, " +
  "temblor, " +
  "wackel, zitter, " +
  "tremblement, " +
  "ブレ, 揺れ, 手ぶれ, " +
  "抖动, 抖";

const HANDHELD =
  "handheld, hand held, camera, " +
  "en mano, camara, " +
  "handkamera, kamera, " +
  "a main, camera, " +
  "手持ち, カメラ, " +
  "手持, 相机";

const STEADY =
  "stabiliz, stabilis, steady, " +
  "estabiliz, " +
  "stabilisier, " +
  "stabilis, " +
  "安定, " +
  "稳定";

const TAKE =
  "shot, footage, clip, video, take, " +
  "toma, plano, imagen, secuencia, " +
  "aufnahme, material, " +
  "sequence, images, " +
  "映像, 素材, " +
  "视频, 镜头";

const GRIDS =
  "grid, " +
  "cuadricula, rejilla, " +
  "raster, gitter, " +
  "grille, " +
  "グリッド, " +
  "网格, 格子";

const REPEATS =
  "copies, copy, repeat, tile, duplicate, " +
  "copias, repite, repit, " +
  "kopien, wiederhol, kachel, " +
  "repete, " +
  "並べ, " +
  "排, 复制, 平铺, 重复";

const DIMENSIONS = "2x2, 3x3, 4x4, 5x5, 6x6, 2x3, 3x2, 3x4, 4x3, 4x5, 5x4";

const SMEARS =
  "smear, streak, blur, stretch, " +
  "difumina, desenfoca, estira, " +
  "verwisch, unscharf, " +
  "etire, floute, " +
  "ブレ, " +
  "模糊, 拖";

const SIDEWAYS =
  "horizontally, horizontal, sideways, " +
  "en horizontal, horizontalmente, " +
  "horizontal, " +
  "horizontalement, " +
  "横, " +
  "水平, 横向";

const PANS =
  "pan, swipe, swish, whip, " +
  "barrido, " +
  "schwenk, " +
  "balayage, " +
  "サッと, " +
  "摇镜";

const LENSES =
  "lens, objective, " +
  "objetivo, " +
  "objektiv, " +
  "objectif, " +
  "レンズ, " +
  "镜头";

const DEFOCUS =
  "blur, defocus, out of focus, bokeh, " +
  "difumina, desenfoca, " +
  "unscharf, defokus, " +
  "floute, flou, " +
  "デフォーカス, ぼか, " +
  "虚焦, 虚化, 模糊";

const REACTS =
  "react, reacts, respond, dance, jump, jumping, pulse, bounce, " +
  "reaccion, bail, salt, " +
  "reagier, tanz, spring, " +
  "reagiss, danse, " +
  "反応, 動く, " +
  "跳动, 随";

const LIKE =
  "like, as, " +
  "como, " +
  "wie, " +
  "comme, " +
  "のように, みたいに, " +
  "像";

const WRAPS =
  "wrap, " +
  "envuelv, " +
  "wick, " +
  "enroule, " +
  "巻き付, " +
  "包, 裹";

const ONTO =
  "onto, around, on, " +
  "en, sobre, " +
  "auf, um, " +
  "sur, autour, " +
  "に, " +
  "到";

const BALLS =
  "ball, globe, sphere, orb, " +
  "bola, esfera, " +
  "kugel, " +
  "balle, boule, " +
  "ボール, 球体, " +
  "球";

/** Everyday ways to ask for Rolling Shutter Repair, Warp Stabilizer, Audio Spectrum, Timecode, Keylight, Motion Tile, Directional Blur, Camera Lens Blur and CC Sphere. */
export const FOOTAGE_WORDS: ReadonlyArray<ConceptRow> = [
  [`${across(JELLY, CLIP)}, ${across(JELLY, MENDING)}, ${chain(REMOVING, JELLY)}`, "shutter", 8],
  [across(BARS, MUSIC), "spectrum", 5],
  [`${across(SHAKE, HANDHELD)}, ${chain(REMOVING, SHAKE)}`, "stabilizer", 5],
  [across(STEADY, TAKE), "stabilizer", 5],
  ["timecode, time code, bildzahler, bildzaehler, frame counter, contador de fotogramas, compteur d images, フレームカウンター, 帧计数器, 时间码, タイムコード, codigo de tiempo, zeitcode", "timecode", 5],
  ["pantalla azul, pantalla verde, ecran bleu, ecran vert, fond bleu, fondo azul, fond vert, 蓝幕", "keylight", 5],
  [across(GRIDS, REPEATS), "tile&motion", 5],
  [across(REPEATS, DIMENSIONS), "tile&motion", 5],
  [across(SMEARS, SIDEWAYS), "directional", 5],
  [across(SMEARS, PANS), "directional", 5],
  [across(LENSES, DEFOCUS), "blur&camera&lens", 5],
  [`${chain(DEFOCUS, LIKE, LENSES)}, ${chain(LENSES, LIKE, DEFOCUS)}`, "blur&camera&lens", 5],
  [across(BARS, REACTS), "spectrum", 4],
  [[JELLY, BARS, BALLS, LENSES, SHAKE, GRIDS].join(", "), "footage", 1],
  [`${chain(WRAPS, ONTO, BALLS)}, ${chain(BALLS, ONTO, WRAPS)}`, "=cc_sphere", 6],
];
