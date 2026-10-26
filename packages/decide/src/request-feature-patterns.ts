// The patterns that name the compound request features in six languages: reading or editing keyframes, tracking and stabilizing, mattes, and a duplicated composition.
import { withKana } from "./request-kana.js";
import { phraseRegex, unionRegex } from "./request-text.js";

const KEYFRAME_NOUN = "(?:keyframe\\p{L}*|key frames?|keys|schlusselbild\\p{L}*|fotogramas? clave|images? cles?)";
const KEYFRAME_READ = "(?:read\\p{L}*|inspect\\p{L}*|list\\p{L}*|show|see|print|dump|display|check|get|lies?|lees?|zeig\\p{L}*|muestr\\p{L}*|lista\\p{L}*|lee|leer|revis\\p{L}*|montre\\p{L}*|affich\\p{L}*|lis)";
const KEYFRAME_EDIT = [
  "delete\\p{L}*|remov\\p{L}*|shift\\p{L}*|retim\\p{L}*|re-time|stretch\\p{L}*|slid\\p{L}*|offset\\p{L}*|copy|copies|paste\\p{L}*|move\\p{L}*|nudg\\p{L}*|delay\\p{L}*|push\\p{L}*|pull\\p{L}*",
  "advanc\\p{L}*|speed\\p{L}*|slow\\p{L}*|squash\\p{L}*|compress\\p{L}*|expand\\p{L}*|revers\\p{L}*|flip\\p{L}*|tweak\\p{L}*|adjust\\p{L}*|edit\\p{L}*|duplicat\\p{L}*|clear\\p{L}*",
  "verschieb\\p{L}*|verzoger\\p{L}*|kopier\\p{L}*|losch\\p{L}*|entfern\\p{L}*|versetz\\p{L}*|streck\\p{L}*|anpass\\p{L}*|bearbeit\\p{L}*|andere\\p{L}*|verlanger\\p{L}*|verkurz\\p{L}*|stauch\\p{L}*|umkehr\\p{L}*",
  "desplaz\\p{L}*|mueve|mover|copia\\p{L}*|borra\\p{L}*|elimina\\p{L}*|retras\\p{L}*|adelant\\p{L}*|ajust\\p{L}*|edit\\p{L}*|cambi\\p{L}*|acort\\p{L}*|alarg\\p{L}*|invert\\p{L}*|duplic\\p{L}*",
  "decal\\p{L}*|deplac\\p{L}*|supprim\\p{L}*|copi\\p{L}*|coll\\p{L}*|retard\\p{L}*|avanc\\p{L}*|etir\\p{L}*|modifi\\p{L}*|invers\\p{L}*|dupliqu\\p{L}*",
].join("|");
const KEYFRAME_EDIT_JA = "(?:移動|ずら|削除|消|コピー|伸縮|遅ら|早め|前倒|詰め|縮め|伸ばし|調整|編集|修正|貼り付|ペースト|反転|複製|スライド|オフセット|読み|確認|一覧|見せ|教え|表示|リスト|チェック|整理|リタイム)";
const KEYFRAME_EDIT_ZH = "(?:移动|平移|整体移|删除|删掉|复制|粘贴|延迟|推迟|提前|拉长|拉伸|缩短|压缩|调整|编辑|修改|反转|错开|偏移|读取|查看|列出|显示|检查|整理|重新计时|对齐|往后|往前)";

/** The words for reading or editing keyframes that already exist: a read or edit verb beside the keyframe noun, in any of the six languages. */
export const KEYFRAME_EDIT_PATTERN: RegExp = unionRegex([
  new RegExp(`\\b(?:${KEYFRAME_READ}|${KEYFRAME_EDIT})\\b[^.;]{0,30}\\b${KEYFRAME_NOUN}\\b|\\b${KEYFRAME_NOUN}\\b[^.;]{0,30}\\b(?:${KEYFRAME_EDIT})\\b`, "giu"),
  withKana(new RegExp(`${KEYFRAME_EDIT_JA}[^。]{0,12}キーフレーム|キーフレーム[^。]{0,12}${KEYFRAME_EDIT_JA}`, "giu")),
  new RegExp(`${KEYFRAME_EDIT_ZH}[^。]{0,12}关键帧|关键帧[^。]{0,12}${KEYFRAME_EDIT_ZH}`, "giu"),
]);

const FOLLOW_VERB = "(?:follow\\p{L}*|stick\\p{L}* to|lock\\p{L}* onto|lock\\p{L}* (?:\\p{L}+ ){0,3}(?:on)?to|pin\\p{L}* to|folg\\p{L}*|verfolg\\p{L}*|sigu\\p{L}*|rastre\\p{L}*|pegad\\p{L}*|peg(?:a|ar|alo|ala)|heft\\p{L}*|kleb\\p{L}*|suiv\\p{L}*|suis(?![a-z])|coll(?:e|er)|accroch\\p{L}*)";
const FOLLOW_TARGET = [
  "head|speaker|presenter|hand|body|eyes?|mouth|walking|objects?|subjects?|movement|moving|motion|car|vehicle|person|people|face|target|ball|player|footage|clip|shot|dancer|animal|points?",
  "kopf|sprecher|hand|korper|objekt\\p{L}*|bewegung\\p{L}*|auto|person\\p{L}*|gesicht|ziel|punkt\\p{L}*",
  "cabeza|presentador|orador|mano|cuerpo|objeto\\p{L}*|movimiento|coche|persona|cara|punto|toma|vehiculo",
  "tete|orateur|presentateur|main|corps|objet|sujet|mouvement|voiture|visage|cible|personne",
].join("|");
const STABILISE_LATIN = "(?:estabiliz|trackear|tracke|rastre|seguimiento de (?:movimiento|camara|puntos|objeto)|stabilisier|motion[- ]?tracking|kamera[- ]?tracking|bewegungsverfolg|stabilis|suivi de (?:mouvement|camera|points|objet)|tracker|camera tracker)\\p{L}*";
const TRACKING_ZH = "跟踪|追踪|防抖|去抖|稳定[^,.。]{0,4}(?:画面|镜头|素材|视频|影片)|(?:画面|镜头|素材|视频|影片)[^,.。]{0,6}(?:稳定|稳住)|变形稳定|反求|画面稳定|(?:贴|粘|钉)[^,.。]{0,6}(?:头|脸|手|人|身)|跟着(?:动|走|移动)|(?:跟随|跟着|贴合|吸附|锁定|固定)[^,.。]{0,8}(?:物体|目标|运动|移动|人物|汽车|车|脸|人脸|画面|素材|镜头)";
const TRACKING_JA = "トラッキング|追跡|追従|手ブレ補正|ブレ補正|スタビライズ|スタビライザー|ワープスタビ|モーショントラック|トラッカー|動きに合わせ|動きに追従|追いかけ";

/** The words for tracking footage or stabilizing it: a track or follow verb with a moving target, a stabilizer, a camera solve, in six languages; the letter spacing words come separately. */
export const TRACKING_PATTERN: RegExp = unionRegex([
  /\b(?:warp[- ]?stabili[sz]\w*|stabili[sz]e\b|3d (?:camera )?track\w*|camera track\w*|motion track\w*|track motion|track points?|create camera|tracking)\b/giu,
  new RegExp(`\\b${FOLLOW_VERB}\\b[^.;]{0,30}\\b(?:${FOLLOW_TARGET})\\b`, "giu"),
  new RegExp(`(?<![\\p{L}\\p{N}])${STABILISE_LATIN}`, "giu"),
  withKana(new RegExp(TRACKING_JA, "gu")),
  new RegExp(TRACKING_ZH, "gu"),
]);

/** The words for a matte named in another language: the track matte, alpha matte or luma matte, as each After Effects UI calls it. */
export const MATTE_WORDS: RegExp = phraseRegex([
  "matte", "matted", "=mate", "=mates", "spurmaske", "cache alpha", "cache de luminance", "cache luma", "cache de suivi", "cache de piste", "cache inverse",
  "トラックマット", "アルファマット", "ルミナンスマット", "輝度マット", "轨道遮罩", "遮罩", "alpha蒙版", "亮度蒙版",
]);

/** The finishes that make the word matte a surface rather than a track matte: matte black, a matte finish, mate black, matt finish. */
export const MATTE_FINISH: RegExp = unionRegex([
  /\bmatte (?:black|white|gr[ae]y|finish|paint|look|colou?r|texture|surface|plastic|paper|style|background|effect)\b/giu,
  /\b(?:acabado|pintura|color|efecto|fondo|textura|negro|blanco) mate\b|\bmate (?:negro|blanco|finish|acabado)\b/giu,
  /\bmatt(?:e|es|er|en|em)? (?:schwarz|weiss|finish|oberflache|lack|look|optik|farbe)\b/giu,
  /マット(?:な|仕上げ|質感|調|ブラック|加工)|哑光|亚光/gu,
]);

const COMPOSITION_NOUN = "(?:comps?|compos?|komp|compositions?|composiciones|composicion|kompositions?|kompositionen)(?![\\p{L}\\p{N}])";
const DUPLICATE_VERB = "(?<![\\p{L}\\p{N}])(?:duplic|dupliz|dupliqu|cop(?:y|i)|clon|klon|kopie|variant|version)\\p{L}*";

/** The words for a composition copied as another version: a duplicate, copy, clone or variant verb beside a composition noun in the Latin languages, and the Japanese and Chinese words for it. */
export const DUPLICATE_COMPOSITION_PATTERN: RegExp = unionRegex([
  new RegExp(`${DUPLICATE_VERB}[^.;]{0,30}${COMPOSITION_NOUN}|(?<![\\p{L}\\p{N}])${COMPOSITION_NOUN}[^.;]{0,30}${DUPLICATE_VERB}`, "giu"),
  withKana(new RegExp("コンポ\\p{L}*[^。]{0,8}(?:複製|コピー|複写|バリエーション|バージョン)|(?:複製|コピー)[^。]{0,8}コンポ", "giu")),
  /复制[^。,]{0,6}合成|合成[^。,]{0,6}(?:复制|副本|拷贝|变体)|(?:复制|拷贝|克隆)[^。,]{0,4}(?:一个|一份)?合成/gu,
]);
