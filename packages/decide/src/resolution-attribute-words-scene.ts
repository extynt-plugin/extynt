// Request words for the properties of cameras, lights, 3D materials, masks, time remapping and audio in every language.
import type { ConceptRow } from "./resolution-concepts.js";

/** Rows for the camera options, named by what the shot does. */
export const CAMERA_WORDS: ReadonlyArray<ConceptRow> = [
  [
    "zoom in, zoom out, zoom the camera, camera zoom, push in, push the camera in, pull out, tighter shot, closer shot, tighter framing, wider shot, wider framing, field of view, fov, focal length, longer lens, wider lens, telephoto, " +
    "closer, nearer, bring the camera closer, get closer, magnify the shot, brennweite, bildwinkel, naher heran, ranzoomen, reinzoomen, rauszoomen, aufziehen, distancia focal, acercar, acerca la camara, alejar, aleja la camara, " +
    "campo de vision, focale, rapprocher la camera, rapproche, zoomer, dezoomer, champ de vision, ズームイン, ズームアウト, ズーム, 画角, 寄る, 寄って, 引いて, 引き, 缩放, 拉近, 推近, 拉远, 视角, 视野",
    "zoom",
    4,
  ],
  [
    "focus, fokus, enfoque, mise au point, ピント, フォーカス, 对焦, focus distance, focus plane, plane of focus, focal plane, focal distance, where the focus is, where it is in focus, point of focus, focus point, pull focus, rack focus, shift focus, move the focus, focus on the back, focus on the front, " +
    "focus further, focus closer, fokusabstand, fokusebene, schaerfeebene, scharfeebene, schaerfepunkt, scharfe verlagern, distancia de enfoque, plano focal, plano de enfoque, punto de enfoque, desplaza el enfoque, " +
    "distance de mise au point, plan de mise au point, point de mise au point, plan focal, ピント位置, ピントの位置, フォーカス距離, 焦点距離, ピント送り, ピントを送る, 对焦距离, 焦距, 对焦位置, 对焦点, 移焦, 拉焦",
    "=focus_distance",
    7,
  ],
  [
    "aperture, f stop, fstop, f number, lens opening, wide open, stop down, blende, offnung der blende, apertura, abertura, diafragma, ouverture, ouverture du diaphragme, diaphragme, 絞り, 絞り値, アパーチャ, 光圈, 光圈大小",
    "aperture",
    5,
  ],
  [
    "blur level, level of blur, defocus, defocus amount, out of focus amount, how out of focus, how defocused, bokeh amount, amount of bokeh, more bokeh, less bokeh, softer background, blurrier background, blur the background, " +
    "background blur, foreground blur, creamy background, unschaerfegrad, grad der unschaerfe, hintergrund weichzeichnen, mehr bokeh, nivel de desenfoque, desenfoca el fondo, fondo mas borroso, niveau de flou, flou d arriere plan, " +
    "flou de l arriere plan, plus de bokeh, ブレのレベル, ボケの量, ボケ具合, 背景をぼかす, 背景のボケ, 模糊层次, 模糊程度, 虚化, 背景虚化, 虚化程度",
    "=blur_level",
    7,
  ],
  [
    "point of interest, aim the camera, point the camera, point it at, lookat, look at target, where the camera looks, where it looks, what the camera looks at, camera target, target of the camera, track the target, " +
    "face the camera at, blickpunkt, zielpunkt, interessenspunkt, kamera ausrichten, kamera auf, kamera richten, richte die kamera, kamera zielt auf,  punto de interes, apunta la camara, apuntar la camara, hacia donde mira, point d interet, vise avec la camera, pointer la camera, " +
    "oriente la camera, 目標点, 注視点, カメラの向き, カメラを向ける, 向けて, 向ける, 向け直,  目标点, 兴趣点, 兴趣中心, 摄像机朝向, 镜头朝向, 对准",
    "=point_of_interest",
    7,
  ],
  [
    "depth of field, dof, shallow depth, shallow focus, deep focus, background out of focus, cinematic blur, tiefenscharfe, schaerfentiefe, tiefenunscharfe, profundidad de campo, profondeur de champ, 被写界深度, 景深, 景深开关",
    "=depth_of_field",
    7,
  ],
  [
    "orbit, orbit around, circle around, swing around, move the camera around, move the camera, dolly, truck, pan the camera, camera position, where the camera is, reposition the camera, umkreisen, kamerafahrt, kamera bewegen, " +
    "orbitar, mover la camara, mueve la camara, travelling, deplacer la camera, deplace la camera, カメラを動かす, カメラ位置, 回り込む, 摄像机位置, 移动摄像机, 环绕, 绕着",
    "position",
    3,
  ],
];

/** Rows for the light and material options, named by how the light or surface looks. */
export const LIGHT_WORDS: ReadonlyArray<ConceptRow> = [
  [
    "light intensity, intensity of the light, brightness of the light, power of the light, light power, lights brighter, brighter light, dimmer light, dim the light, turn the light up, turn the light down, stronger light, weaker light, " +
    "lichtstarke, lichtstaerke, helligkeit des lichts, licht heller, licht dunkler, intensidad de la luz, luz mas fuerte, luz mas tenue, intensite de la lumiere, intensite lumineuse, lumiere plus forte, lumiere plus faible, " +
    "光の強さ, ライトの強度, 照明の強さ, 光量, 灯光强度, 光照强度, 灯光亮度, 光强, 光线强度",
    "intensity",
    5,
  ],
  [
    "cone angle, beam angle, beam width, width of the beam, spot size, size of the spot, spotlight size, spotlight width, wider spotlight, narrower spotlight, wider beam, narrower beam, tighter beam, foco mas ancho, foco mas estrecho, foco mas abierto, foco mas cerrado, mas ancho el foco, haz mas ancho, haz mas estrecho, projecteur plus large, projecteur plus etroit, faisceau plus large, faisceau plus etroit, lichtkegel breiter, lichtkegel schmaler, breiterer kegel, schmalerer kegel,  tighten the spot, spread of the spotlight, " +
    "oeffnungswinkel, offnungswinkel, kegelwinkel, lichtkegel, scheinwerferkegel, angulo del cono, apertura del foco, haz de luz, angle du cone, faisceau, ouverture du projecteur, 円錐角度, 円錐の角度, スポットの大きさ, 光束, 锥形角度, 光锥, 光锥角度, 聚光灯范围",
    "=cone_angle",
    7,
  ],
  [
    "cone feather, soft edge of the spotlight, soft edge of the beam, soft spotlight edge, feather the spot, feather the beam, kegel weicher, foco mas suave, foco mas difuso, projecteur plus doux,  hard edged spotlight, spot edge, edge of the spot, beam edge, kegelweichzeichnung, kegel weich, weiche lichtkante, " +
    "borde del foco, borde suave del foco, suaviza el foco, bord du projecteur, bord du faisceau, 円錐のぼかし, スポットのぼかし, 光の縁, 锥形羽化, 光锥羽化, 光锥边缘",
    "=cone_feather",
    7,
  ],
  [
    "falloff, fall off, falls off, falling off, drops off, light falloff, fade with distance, fades with distance, light fades, light dies off, light reaches, make the light fall off,  how far the light reaches, how far the light goes, reach of the light, " +
    "lichtabfall, abfall, lichtreichweite, reichweite des lichts, caida de luz, caida de la luz, alcance de la luz, radio de la luz, attenuation, attenuation de la lumiere, portee de la lumiere, " +
    "減衰, 減衰距離, 光の届く範囲, 衰减, 衰减距离, 光照范围, 光的范围",
    "falloff",
    5,
  ],
  [
    "light radius, radius of the light, size of the light, lichtradius, radio de la luz, rayon de la lumiere, ライトの半径, 光の半径, 灯光半径, 光照半径",
    "radius",
    4,
  ],
  [
    "shadow darkness, how dark the shadows, darker shadows, lighter shadows, shadow strength, strength of the shadows, shadow density, density of the shadow, deeper shadows, schattendunkelheit, schattendichte, dunklere schatten, " +
    "oscuridad de la sombra, sombras mas oscuras, densite de l ombre, ombres plus sombres, ombres plus foncees, 影の濃さ, 影の暗さ, 影の濃度, 阴影暗度, 阴影浓度, 阴影深度",
    "=shadow_darkness",
    7,
  ],
  [
    "shadow diffusion, shadow softness, softer shadows, shadows softer, shadows more diffuse, shadows less harsh, shadows blurrier, softer shadow, soft shadows, soften the shadows, blur the shadows, diffuse the shadows, spread the shadows, fuzzy shadows, schattenweichheit, schattendiffusion, weichere schatten, sombras mas suaves, " +
    "difusion de sombra, difusion de la sombra, diffusion de l ombre, ombres plus douces, ombres adoucies, 影の拡散, 影をぼかす, 影を柔らかく, 阴影扩散, 阴影柔和, 柔化阴影",
    "=shadow_diffusion",
    7,
  ],
  [
    "casts shadows, cast shadows, casting shadows, throw shadows, throws shadows, give it a shadow, make it cast a shadow, turn shadows on, turn on shadows, enable shadows, switch on shadows, schatten werfen, wirft schatten, schatten aktivieren, " +
    "proyecta sombras, proyectar sombras, proyecta una sombra, lanzar sombras, projette des ombres, projeter des ombres, projette une ombre, 影を落とす, 影を落とし, 投影, 投射阴影, 投射影子, 投影阴影",
    "=casts_shadows",
    7,
  ],
  [
    "accepts shadows, accept shadows, receive shadows, receives shadows, catch shadows, catches shadows, shadows land on it, shadows fall on it, take shadows, schatten empfangen, nimmt schatten an, recibe sombras, acepta sombras, " +
    "recoit les ombres, accepte les ombres, 影を受ける, 影を受け取る, 接受阴影, 接收阴影",
    "=accepts_shadows",
    7,
  ],
  [
    "accepts lights, accept lights, receive light, receives light, reacts to light, react to lights, affected by lights, lit by lights, lights affect it, responds to lights, lights hit it, ignore the lights, ignores lights, ignored by lights, " +
    "licht empfangen, reagiert auf licht, nimmt licht an, recibe luz, acepta luces, reacciona a la luz, recoit la lumiere, accepte les lumieres, reagit a la lumiere, ライトを受ける, ライトの影響, 接受灯光, 受灯光影响, 接收光照",
    "=accepts_lights",
    7,
  ],
  [
    "shiny, shinier, shininess, glossy, glossier, gloss, make it shiny, make it glossy, less shiny, matte finish, polished, lacquered, wet look, wet looking, glanz, glanzend, glanzender, gloss level, brillo del material, brillante, " +
    "mas brillante, brillant, brillance, plus brillant, 光沢, つや, ツヤ, 艶, 光泽, 光泽度, 亮面, 哑光, 磨砂",
    "shininess",
    5,
  ],
  [
    "specular, specular highlights, specular highlight, highlights on the surface, glint, glints, sheen, reflections, reflective, reflectivity, mirror like, glanzlichter, glanzlicht, reflexion, reflektierend, reflejos especulares, reflejos, " +
    "reflets speculaires, reflets, speculaire, スペキュラ, 鏡面反射, 反射, 高光, 镜面, 镜面反射, 反光",
    "specular",
    5,
  ],
  [
    "metal, metallic, metal look, like metal, chrome, chrome look, brushed metal, metalloptik, metallisch, metalico, metalica, metallique, 金属, メタル, メタリック, 金属感, 金属质感",
    "metal",
    5,
  ],
  [
    "ambient, ambient light, ambient level, fill from the room, base lighting, shadow side brightness, umgebungslicht, ambiente, luz ambiental, lumiere ambiante, ambiance, 環境光, アンビエント, 环境光, 环境",
    "ambient",
    5,
  ],
  [
    "diffuse, difuso, diffus, diffuse light, diffuse response, matte response, how it takes the light, 拡散光, 拡散, 漫反射, 漫射",
    "diffuse",
    5,
  ],
  [
    "extrude, extrusion, extrusion depth, depth of the text, depth of the shape, thickness of the 3d, make it 3d thicker, bevel, bevelled, chamfer, tiefe der extrusion, extrusionstiefe, extrusion tiefe, profundidad de extrusion, extruir, " +
    "profondeur d extrusion, extruder, 押し出し, 押し出し深度, 奥行き, ベベル, 挤出, 挤出深度, 厚度, 倒角",
    "=extrusion_depth bevel",
    7,
  ],
];

/** Rows for the mask, time remap and audio properties. */
export const SOURCE_WORDS: ReadonlyArray<ConceptRow> = [
  [
    "grow the mask, shrink the mask, expand the mask, contract the mask, mask expansion, expansion of the mask, spread the mask, choke the mask, choke the grow the shrink the erode the dilate the " +
    "make the mask bigger, make the mask smaller, mask bigger, mask smaller, mask larger, bigger mask, smaller mask, larger mask,  tighten the mask, loosen the mask, maske erweitern, maske verkleinern, maske vergroessern, maske vergrossern, maske groesser, maske kleiner, maske schrumpfen, maske aufblasen,  maskenausweitung, ampliar la mascara, reducir la mascara, reduce la mascara, amplia la mascara, expande la mascara, expandir la mascara, agranda la mascara, agrandar la mascara, achica la mascara, achicar la mascara, encoge la mascara, encoger la mascara, mascara mas grande, mascara mas pequena, mascara mas chica,  expansion de la mascara, agrandir le masque, agrandis le masque, reduire le masque, reduis le masque, masque plus grand, masque plus petit, elargir le masque, elargis le masque,  " +
    "dilater le masque, contracter le masque, マスクの拡張, マスクを広げる, マスクを縮める, マスクを大きく, マスクを小さく, マスクを大きめ, マスクを小さめ,  蒙版扩展, 扩展蒙版, 收缩蒙版, 扩大蒙版, 缩小蒙版, 蒙版变大, 蒙版变小, 蒙版大一点, 蒙版小一点",
    "=mask_expansion",
    7,
  ],
  [
    "mask shape, mask path, shape of the mask, reshape the mask, redraw the mask, move the mask points, edit the mask points, mask outline, mask vertices, adjust the mask, maskenpfad, maskenform, forma de la mascara, trazado de la mascara, " +
    "tracado du masque, forme du masque, masque path, マスクパス, マスクの形, マスクの形状, 蒙版路径, 蒙版形状, 蒙版轮廓",
    "=mask_path",
    7,
  ],
  [
    "time remap, time remapping, remap the time, retime, re time, retiming, speed ramp, speed up the clip, slow down the clip, slow motion, slowmo, slow mo, freeze frame, freeze the frame, hold a frame, play backwards, play it backwards, " +
    "reverse the footage, reverse the clip, scrub the footage, stretch the time, zeitumkehr, zeitremapping, zeit neu zuordnen, zeitlupe, standbild, ruckwarts abspielen, remapeo de tiempo, remapear el tiempo, camara lenta, cuadro congelado, " +
    "reproducir al reves, remappage temporel, ralenti, image figee, lecture a l envers, タイムリマップ, スローモーション, スロー, 静止フレーム, 逆再生, 时间重映射, 时间重置, 慢动作, 定格, 冻结帧, 倒放, 倒带",
    "remap",
    5,
  ],
  [
    "volume, music, sound, audio, voiceover, voice over, dialogue, musik, sonido, musica, son, 音楽, 音声, 音乐, 声音, louder, quieter, turn the volume, turn up the music, turn down the music, music down, bring the music down, bring down the music, bring the audio down, music up, bring the music up, sound down, sound up,  music louder, music quieter, music lower, mute, unmute, silence, silent, audio level, audio levels, sound level, sound levels, " +
    "duck the music, duck the audio, fade the music, fade the audio, fade the sound, fade out the sound, lauter, leiser, lautstarke, lautstaerke, stumm, stummschalten, audiopegel, tonpegel, volumen, mas alto, mas bajo, silenciar, " +
    "nivel de audio, nivel de sonido, volume sonore, plus fort, moins fort, couper le son, niveau audio, niveau sonore, sourdine, 音量, 音声レベル, オーディオレベル, ミュート, 無音, 音を大きく, 音を小さく, 音声, 音频电平, 音频级别, 静音, 音量大小, 声音大一点, 声音小一点, 调大音量, 调小音量",
    "=audio_levels",
    7,
  ],
];
