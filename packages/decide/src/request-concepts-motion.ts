// The words for features described by their motion in languages beyond the first five: a stroke that draws on, a layer in orbit, a camera move, steadying and pinning footage, in Spanish, German, French, Japanese and Chinese.
import { withKana } from "./request-kana.js";
import { unionRegex } from "./request-text.js";

const CLAUSE = "[^.;!?。！？]";

function near(first: string, second: string, gap: number): RegExp {
  const between = `${CLAUSE}{0,${gap}}`;
  return new RegExp(`(?:${first})${between}(?:${second})|(?:${second})${between}(?:${first})`, "giu");
}

function anyOf(...sources: ReadonlyArray<string>): RegExp {
  return new RegExp(sources.join("|"), "giu");
}

const EDGE = "(?<![\\p{L}\\p{N}])";
const STROKE_ES = `${EDGE}(?:trazos?|trazados?|lineas?|contornos?|siluetas?|bordes?|rastros?)(?![\\p{L}])`;
const STROKE_DE = `${EDGE}(?:linien?|kontur\\p{L}*|strich\\p{L}*|pfad\\p{L}*|umriss\\p{L}*|schriftzug\\p{L}*|spur\\p{L}*)`;
const STROKE_FR = `${EDGE}(?:traits?|traces?|contours?|lignes?|silhouettes?|trajets?)(?![\\p{L}])`;
const STROKE_JA = "線|輪郭|ストローク|パス|軌跡|ライン|アウトライン|縁";
const STROKE_ZH = "线条|直线|曲线|描边|轮廓|路径|笔画|边框|轨迹|下划线|线段";
const GROW_ES = "(?:crec|aparec|extend|extiend|revel|descubr|se dibuj|se traz|se escrib)\\p{L}*";
const GROW_DE = "(?:sich (?:\\p{L}+ ){0,6}zeichn|wachs|erscheint|entsteht|baut sich|zeichn\\p{L}* sich|einzeichn|ausfahr|aufbau|zieht sich|entfalt)\\p{L}*";
const GROW_FR = "(?:s'(?:ecrit|trace|anime|allonge|etire|affiche|dessine)|apparai|pouss|grandi|se (?:dessin|trac|prolong|devoil|revel))\\p{L}*";
const GROW_JA = "伸び|伸ばし|出現|現れ|浮かび上が|描いて|描き始め|なぞ|走ら|生え|成長|表示され|描画され";
const GROW_ZH = "逐渐画出|慢慢画|画出来|描出来|绘制出来|逐步绘制|逐渐绘制|画出|描绘出|写出来|写出|生长|延伸|显现|逐渐出现|慢慢出现|逐渐显示|自己画|自动绘制|依次画|一笔一画|从左到右|逐渐描";

const PACE_ES = "(?:dibuj|traz|escrib|revel)\\p{L}*[^.;!?]{0,30}(?:poco a poco|progresiv\\p{L}*|gradual\\p{L}*|de izquierda a derecha|trazo a trazo|punto a punto)";
const PACE_DE = "(?:zeichn|schreib|zieh|bau)\\p{L}*[^.;!?]{0,30}(?:nach und nach|schrittweise|allmahlich|strich fur strich|von links nach rechts)";
const PACE_FR = "(?:dessin|trac|ecri)\\p{L}*[^.;!?]{0,30}(?:progressi\\p{L}*|petit a petit|peu a peu|de gauche a droite|trait par trait)";
const PACE_JA = "(?:描|書|現れ|伸び)[^。]{0,12}(?:徐々に|だんだん|少しずつ|左から右|順番に)|(?:徐々に|だんだん|少しずつ|順番に)[^。]{0,12}(?:描|書)";
const PACE_ZH = "(?:画|描|绘制|写|出现|显现)[^,.。]{0,10}(?:逐渐|慢慢|逐步|从左到右|一点点|依次)|(?:一点点|逐渐|慢慢|逐步)[^,.。]{0,6}(?:画|描|绘制|写)";

const TRIM_NAMES = [
  "recortar trazados?|recorte de trazados?|animar (?:el )?(?:trazo|trazado)|animacion de(?:l)? (?:trazo|trazado)",
  "pfade? zusammenzieh\\p{L}*|pfad(?:e)? kurz\\p{L}*|pfadanimation|strichanimation|linienanimation",
  "decouper les traces?|decoupage de trace|animation (?:de |du )?(?:trait|trace|contour)|animer (?:le |la )?(?:trait|trace|contour)",
  "トリミング?パス|パスのトリミング|ストロークアニメ\\p{L}*|線アニメ\\p{L}*|手書き風|手書きアニメ\\p{L}*|ライティングアニメ\\p{L}*|線を描画|描画アニメ\\p{L}*|ドローオン",
  "修剪路径|描边动画|路径动画|手写动画|书写动画|线条动画|画线动画|线条生长|线条绘制",
].join("|");

/** The words for a stroke that draws itself on, in Spanish, German, French, Japanese and Chinese: the trim paths names, a stroke that grows or appears, a stroke drawn gradually. */
export const TRIM_PATH_MORE: RegExp = withKana(unionRegex([
  anyOf(TRIM_NAMES, PACE_ES, PACE_DE, PACE_FR, PACE_JA, PACE_ZH),
  near(STROKE_ES, GROW_ES, 60),
  near(STROKE_DE, GROW_DE, 60),
  near(STROKE_FR, GROW_FR, 60),
  near(`(?:${STROKE_JA})`, `(?:${GROW_JA})`, 14),
  near(`(?:${STROKE_ZH})`, `(?:${GROW_ZH})`, 14),
]));

const ORBIT_NOUN_DE = "(?:globus|erdkugel|welt|planet\\p{L}*|sonne|mond|stern\\p{L}*|erde|mitte|zentrum|punkt|kugel|kern|logo|kreis)";
const ORBIT_NOUN_FR = "(?:la |le |l'|un |une |son |sa )?(?:globe|planete|soleil|lune|etoile|terre|centre|point|logo|cercle|boule)";
const ORBIT_MORE = [
  "\\b(?:da|dan|dando|dar|giran?|girando) (?:vueltas?|vuelta) (?:a|al|alrededor|en torno)\\b", "\\b(?:gir|rot|vuel|mov|dar vueltas|da vueltas|dan vueltas)\\p{L}*[^.;]{0,15}alrededor d(?:e|el|e la) (?:la |el |los |las )?(?:planeta|sol|luna|estrella|tierra|centro|punto|logo|globo|mundo)", "\\ben torno a(?:l)? (?:la |el |los |las )?(?:planeta|sol|luna|estrella|tierra|centro|punto|logo)",
  `\\b(?:kreist|kreisen|dreht sich|drehen sich|rotiert|rotieren|fliegt|fliegen|bewegt sich|wandert|lauft|laufen|soll)\\p{L}*[^.;]{0,15} um (?:die |den |das |dem |der )?${ORBIT_NOUN_DE}`,
  `\\b(?:tourne|tournent|tournant|gravite|gravitent|circule|circulent|fait le tour)\\p{L}*[^.;]{0,10}(?:autour|de) (?:du )?${ORBIT_NOUN_FR}`, "\\bautour (?:de |du |d')?(?:la |le |l')?(?:planete|soleil|lune|etoile|terre)\\b",
  "周り[でを][^。]{0,8}回|周囲[でを]回|まわり[をでに]回|ぐるぐる回|を中心に回[るりっ]|ぐるりと回|旋回|円周上|回り込|周りをぐるぐる|周りを周",
  "环绕|公转|围绕|绕圈|围着[^,.。]{0,8}(?:转|旋转|飞|运动|绕)|绕着[^,.。]{0,6}(?:转|旋转|飞|运动)|圆周运动|轨道运动|沿着圆",
].join("|");

/** The words for a layer travelling around a centre, in Spanish, German, French, Japanese and Chinese. */
export const ORBIT_MORE_WORDS: RegExp = withKana(anyOf(ORBIT_MORE));

const CAMERA_NOUN_ZH = "摄像机|摄像头|相机";
const CAMERA_MOVE_ZH = "推进|推近|拉远|拉近|推拉|推|拉|移|摇|跟|升|降|环绕|靠近|远离|前进|后退|缓缓|飞|平移|变焦|运镜";
const CAMERA_NOUN_NATIVE = `${EDGE}(?:camera|camara|kamera|カメラ)`;
const CAMERA_MOVE_NATIVE = [
  "(?:movimient|recorrid|barrid|paneo|panoramic|travelling|giro|zoom|acercamiento|alejamiento)\\p{L}*",
  "(?:bewegung|fahrt|flug|schwenk|neig|zoom|annaher|entfern)\\p{L}*",
  "(?:panoram|pivot|tourne|glisse|monte|descend|survol|mouvement|travelling|zoom|rapproch)\\p{L}*",
  "ゆっくり|回り込|移動|上昇|下降|フォロー|ティルト|クレーン|ついて|寄せ|引きの|近づけ",
].join("|");

/** The words for a camera move, in Spanish, German, French, Japanese and Chinese: a camera beside a move noun, and the Chinese push and pull of the lens. */
export const CAMERA_MOVE_MORE: RegExp = unionRegex([
  withKana(near(CAMERA_NOUN_NATIVE, CAMERA_MOVE_NATIVE, 30)),
  near(`(?:${CAMERA_NOUN_ZH})`, `(?:${CAMERA_MOVE_ZH})`, 12),
  /\b(?:slid|mov|push|glid|dolly|dollies|fly|flies|bring|drift|pull)\p{L}* the camera\b[^.;]{0,25}\b(?:in|towards?|closer|into|forward|back|away|out)\b/giu,
  /\b(?:mueve|acerca|aleja|desliza|empuja|lleva|mover|acercar|alejar)\p{L}* (?:la )?camara\b/giu,
  /\b(?:schieb|beweg|fahr|zieh|flieg|bring|nimm)\p{L}* (?:die )?kamera\b/giu,
  /\b(?:rapproche|eloigne|recule|avance|deplace|pousse|fais avancer)\p{L}* (?:la )?camera\b/giu,
  /推镜头|拉镜头|运镜|摇镜头|缓推|缓拉|镜头(?:推|拉|移|摇|跟|升|降)/gu,
]);

const SHAKE_NATIVE = "(?:shak|jitter|wobbl|judder|tembl\\p{L}*|sacud\\p{L}*|temblor|wackel\\p{L}*|verwackel\\p{L}*|zitter\\p{L}*|secou\\p{L}*|trembl\\p{L}*)";
const FOOTAGE_NATIVE = "(?:footage|shot|plate|plano|toma|video|clip|metraje|grabacion|aufnahme|szene|einstellung|material|prise|sequence|images?|映像|動画|素材|ショット|カメラ|视频|素材|镜头|画面)";
const FIX_NATIVE = "(?:stop|fix|calm|tame|kill|lessen|remov|reduc|smooth|estabiliz|elimin|quita|reduc|corrig|arregl|stabilisier|entfern|reduzier|beheb|korrigier|stabilis|supprim|reduis|calme|lisse|suaviz|beruhig|glatt)\\p{L}*";

/** The words for steadying footage, in Spanish, German and French: a fix verb beside a shake word beside the shot, and a shaky shot. */
export const STEADY_MORE: RegExp = unionRegex([
  new RegExp(`${EDGE}${FIX_NATIVE}[^.;]{0,25}${SHAKE_NATIVE}[^.;]{0,25}${FOOTAGE_NATIVE}`, "giu"),
  new RegExp(`${EDGE}${FIX_NATIVE}[^.;]{0,15}${FOOTAGE_NATIVE}[^.;]{0,15}${SHAKE_NATIVE}`, "giu"),
  new RegExp(`${EDGE}${FOOTAGE_NATIVE}[^.;]{0,15}(?:shaky|jittery|wobbly|bumpy|tembloros|con tembl|verwackelt|wackelig|tremblant|qui trembl)\\p{L}*`, "giu"),
  withKana(/手ブレ|ブレを(?:抑|消|なくし|取|直)|ブレた(?:映像|動画|素材)|ブレ(?:て|ている)(?:映像|動画|素材)|揺れ(?:を|ている)(?:映像|動画|素材)|画面抖动|抖动的(?:视频|素材|镜头|画面)|视频抖动|镜头抖动|素材抖动/giu),
]);
