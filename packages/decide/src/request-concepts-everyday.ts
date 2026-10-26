// The everyday ways designers describe a feature by what it looks like rather than by its After Effects name, in six languages: random shaking, stamping a shape many times, sending things round another, sticking a graphic onto a moving thing, cutting footage through a shape, filling letters with footage, drawing a line from end to end, light and shadow, and pinning layers to a null.
import { withKana } from "./request-kana.js";
import { anyOf, near } from "./request-concepts.js";
import { unionRegex } from "./request-text.js";

const EDGE = "(?<![\\p{L}\\p{N}])";
const DET = "(?:the |a |an |that |this |those |these |his |her |their |its |my |your |our |one |each |every )?";

const NUM_EN = String.raw`(?:\d+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|a dozen|dozens?|several|many|multiple|a few|a bunch of|loads of)`;
const NUM_ES = String.raw`(?:\d+|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|cincuenta|varias|varios|muchas|muchos|una docena)`;
const NUM_DE = String.raw`(?:\d+|zwei|drei|vier|funf|sechs|sieben|acht|neun|zehn|elf|zwolf|funfzehn|zwanzig|dreissig|mehrere|viele|dutzend)`;
const NUM_FR = String.raw`(?:\d+|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|quinze|vingt|trente|cinquante|plusieurs|beaucoup|une douzaine)`;
const NUM_JA = String.raw`(?:\d+|[二三四五六七八九十百]+|何)`;
const NUM_ZH = String.raw`(?:\d+|[两二三四五六七八九十百]+|几|多)`;

const SHAPEY = String.raw`(?:shapes?|dots?|circles?|squares?|stars?|icons?|bars?|lines?|petals?|rays?|ticks?|bullets?|rings?|diamonds?|triangles?|rectangles?|spokes?|spikes?|tiles?|pills?|hearts?|arrows?|blobs?|polygons?|ellipses?|hexagons?|items?|elements?)`;
const PLACED_EN = String.raw`(?:across|along|around|round|in a (?:row|line|circle|ring|grid|pattern|fan|spiral|arc|column|diagonal|wave|zigzag|cluster)|in (?:rows|columns|a straight line|sequence|circles|rings)|evenly|spaced|at equal|over the (?:screen|frame|canvas)|down the|to the (?:right|left))`;
const PLACED_ES = String.raw`(?:en (?:un )?(?:circulo|fila|hilera|cuadricula|columna|abanico|espiral|linea|patron|serie|anillo|circunferencia)|a lo largo|alrededor|por toda|de forma uniforme|uniformemente|espaciad)`;
const PLACED_DE = String.raw`(?:im kreis|in einem kreis|in einer reihe|in reihe|im raster|in einem raster|im muster|in einem muster|entlang|gleichmassig|nebeneinander|kreisformig|im ring|in einem ring|uber den|quer uber)`;
const PLACED_FR = String.raw`(?:en cercle|en rond|en ligne|en rangee|en grille|en motif|en anneau|en eventail|en spirale|le long|tout autour|regulierement|a intervalles|sur tout)`;

/** The words for stamping or copying one shape a number of times across the frame or in a pattern, in six languages. */
export const STAMP_PATTERN_CONCEPT: RegExp = withKana(anyOf(
  String.raw`\b(?:stamp|clone|replicate|tile|multipl)\p{L}*\b[^.;]{0,50}\b${NUM_EN} (?:times|copies|instances|more)\b`,
  String.raw`\b(?:copy|copies|copied|duplicate|duplicates|duplicating)\b[^.;]{0,40}\b${NUM_EN} times\b[^.;]{0,40}\b${PLACED_EN}\b`,
  String.raw`\b${NUM_EN} (?:times|copies|clones|duplicates|instances|replicas|stamps)\b[^.;]{0,30}\b${PLACED_EN}\b`,
  String.raw`\b${NUM_EN} (?:copies|clones|replicas|instances|stamps) of ${DET}(?:\p{L}+ )?${SHAPEY}\b`,
  String.raw`${EDGE}(?:estamp|clon|replic|multiplic)\p{L}*[^.;]{0,50}\b${NUM_ES} veces`,
  String.raw`${EDGE}(?:copia|duplica|clona|replica)\p{L}*[^.;]{0,40}\b${NUM_ES} veces[^.;]{0,40}${PLACED_ES}`,
  String.raw`${EDGE}${NUM_ES} (?:veces|copias|clones|replicas)[^.;]{0,30}${PLACED_ES}`,
  String.raw`${EDGE}(?:stempel|klon|vervielfach)\p{L}*[^.;]{0,50}\b${NUM_DE} ?(?:mal|kopien)`,
  String.raw`${EDGE}(?:kopier|dupliz|klon)\p{L}*[^.;]{0,40}\b${NUM_DE} ?mal[^.;]{0,40}${PLACED_DE}`,
  String.raw`${EDGE}${NUM_DE} ?(?:mal|kopien|klone)[^.;]{0,30}${PLACED_DE}`,
  String.raw`${EDGE}(?:copi|clon|duplique|replique|tamponn|estamp)\p{L}*[^.;]{0,50}\b${NUM_FR} fois`,
  String.raw`${EDGE}${NUM_FR} (?:fois|copies|clones|exemplaires|repliques)[^.;]{0,30}${PLACED_FR}`,
  String.raw`${NUM_JA}(?:個|回|つ|枚|本)(?:ずつ)?(?:コピー|複製|複写|クローン|スタンプ)|(?:コピー|複製|複写|クローン|スタンプ|並べ)[^。]{0,10}${NUM_JA}(?:個|回|つ|枚|本)`,
  String.raw`(?:円形|円状|放射状|等間隔|グリッド|格子|横一列|一列|縦一列|扇状|ぐるっと|円周)に?[^。]{0,8}(?:コピー|複製|並べ|スタンプ|ずらっと)|(?:コピー|複製|スタンプ)[^。]{0,10}(?:円形|円状|放射状|等間隔|グリッド|一列|横に|縦に)`,
  String.raw`(?:复制|拷贝|克隆|盖章|复刻|排列|排成|摆成|排)[^,.。]{0,8}${NUM_ZH}(?:个|次|份|遍|枚)|${NUM_ZH}(?:个|次|份)(?:副本|拷贝|复制)`,
  String.raw`(?:沿着?圆|沿圆|圆形|环形|等间距|网格|横向|纵向|一排|一行|一列|放射状|扇形)[^,.。]{0,6}(?:排列|复制|摆放|排成|分布|摆成)|(?:复制|排列|摆放)[^,.。]{0,8}成(?:一圈|一排|一行|圆|环|网格)`,
));

const MOTION_VERBS = String.raw`(?:rotat|revolv|spin|travel|mov|fly|flies|orbit|swirl|circl|glid|drift|float|swim|animate|loop|go|goes|going|run|race)\p{L}*`;

/** The words for copies laid out in a circle or ring and not moving round it: the arrangement of a pattern is no orbit, in six languages. */
export const STATIC_RING_ARRANGEMENT: RegExp = withKana(anyOf(
  String.raw`\b(?:arrang|plac|put|lay|distribut|spac|position|spread|align|stamp|cop|clon|duplicat|replicat)\p{L}*\b(?:(?!\b${MOTION_VERBS}\b)[^.;]){0,50}\b(?:in|into|on|along|as) an? (?:circle|ring|circular|radial|wreath|halo|loop)\b`,
  String.raw`\b${NUM_EN} (?:times|copies|clones|instances|dots|shapes|petals|rays|ticks|circles|squares|stars)\b(?:(?!\b${MOTION_VERBS}\b)[^.;]){0,30}\b(?:in|into|on|along) an? (?:circle|ring|circular|radial)\b`,
  String.raw`${EDGE}(?:coloca|pon|dispon|distribu|reparte|copia|duplica|clona)\p{L}*(?:(?!\b(?:gir|rot|vuel|orbit|mov)\p{L}*)[^.;]){0,50}\ben (?:un )?(?:circulo|anillo|circunferencia)`,
  String.raw`${EDGE}\d+ (?:veces|fois)(?:(?!\b(?:gir|rot|vuel|orbit|mov|tourn|gravit|circul|bouge|deplac)\p{L}*)[^.;]){0,30}\ben (?:un |une )?(?:circulo|anillo|circunferencia|cercle|rond|anneau)`,
  String.raw`${EDGE}(?:ordne|platzier|verteil|leg|stell|kopier|dupliz)\p{L}*(?:(?!\b(?:dreh|kreis|rotier|beweg|fliegt)\p{L}*)[^.;]){0,50}\b(?:im|in einem) (?:kreis|ring)`,
  String.raw`${EDGE}(?:dispose|place|repartis|copie|duplique|mets|met)\p{L}*(?:(?!\b(?:tourn|gravit|circul|bouge|deplac)\p{L}*)[^.;]){0,50}\ben (?:cercle|rond|anneau)`,
  String.raw`(?:円形|円状|円周上|輪の形)に?(?:並べ|配置|複製|コピー|敷き詰め|スタンプ)`,
  String.raw`(?:沿着?圆|圆形|环形|成一圈)[^,.。]{0,6}(?:排列|复制|摆放|排成|分布|摆成)|(?:排列|复制|摆放|排成)[^,.。]{0,6}成(?:一圈|圆|环)`,
));

const AROUND = String.raw`(?:around|round)(?! (?:its|their|his|her|itself|themselves|once|twice|and|in place|on|before|as|while|at|for|fast|slowly|quickly|the (?:anchor|center|centre|axis|y|x|z|corner|bend|block|clock|house|world|screen|frame|comp|composition|canvas|scene|stage|room|page|layout|timeline)|an? (?:axis|anchor|corner|bend|second))\b)`;
const SEND_MOTION = String.raw`(?:send|sends|sending|sent|swing|swings|swinging|whip|whips|whirl|whirls|fling|flings|race|races|racing|run|runs|running|walk|walks|zip|zips|dance|dances|dancing|carry|carries|chase|chases|lap|laps|buzz|buzzes|sail|sails|skate|skates|slide|slides|hover|hovers|prowl|prowls|patrol|patrols|circulate|circulates|go|goes|going|went|come|comes)`;
const FIGURE_AROUND_ES = String.raw`(?:alrededor|en torno)(?! (?:de |del )?(?:la |el |las |los |su |sus )?(?:pantalla|cuadro|escena|lienzo|ancla|composicion|comp|punto de anclaje|eje|si mism|esquina))`;
const FIGURE_AROUND_FR = String.raw`autour(?! (?:de |du |des )?(?:lui|elle|eux|soi|son |sa |ses |leur|l.ecran|l.image|la composition|la comp|la scene|l.axe|l.ancre|le point d.ancrage|d.elle|d.eux))`;

/** The words for sending things round another thing, in six languages: a send, run or go verb with round or around, and the other languages' equivalents. */
export const SEND_ROUND_CONCEPT: RegExp = withKana(anyOf(
  String.raw`\b${SEND_MOTION}(?: [a-z']+){0,3} ${AROUND}`,
  String.raw`${EDGE}(?:manda|envia|mandar|enviar|haz|hacer|lleva|llevar|pasea|corre|vuela|vuelan|mueve|mover|desplaza|recorre|rodea|rodean|rodear)\p{L}*[^.;]{0,20}${FIGURE_AROUND_ES}`,
  String.raw`${EDGE}(?:schick|send|lass|flieg|fahr|beweg|lauf|renn|wander|schweb|tanz|schwirr|jag)\p{L}*[^.;]{0,35}\bum(?! (?:die eigene|sich|den anker|die achse|seine|ihre|die mitte der ebene))\b[^.;]{0,30}\bherum`,
  String.raw`${EDGE}(?:envoie|envoyer|fais|faire|fait|promene|balade|lance|lancer|deplace|deplacer|court|cours|vole|volent|passe|danse|virevolte|file)\p{L}*[^.;]{0,30}\b${FIGURE_AROUND_FR}`,
  String.raw`(?:周り|まわり|周囲|周辺)[をに][^。]{0,6}(?:飛|動|走|巡|漂|舞|移動|ぐる|旋回|周回|回ら|周遊)|の(?:周り|まわり|周囲)[^。]{0,6}(?:飛び回|動き回|走り回|回らせ|巡らせ|回して)`,
  String.raw`(?:绕着?|围着|围绕着?|环绕着?)[^,.。]{0,10}(?:飞|转|跑|移动|运动|旋转|公转|绕|走|游|移)|(?:在|于)[^,.。]{0,8}(?:周围|四周|周边)(?:飞|转|绕|移动|运动|旋转|跑|游)|绕(?!自己|自身)[^,.。]{0,6}一圈`,
));

const MOVING_ADJ = String.raw`(?:moving|walking|running|flying|driving|passing|swaying|dancing|turning|travell?ing|rolling|swinging|bobbing|spinning|rotating|drifting|speaking|talking|handheld)`;
const CARRIER_NOUN = String.raw`(?:head|speaker|presenter|hand|hands|body|eyes?|mouth|face|finger|shoulder|wrist|arm|person|people|man|woman|child|kid|dancer|runner|skater|cyclist|biker|driver|athlete|player|walker|car|truck|bus|van|train|plane|bike|bicycle|boat|ship|drone|helicopter|rocket|bird|dog|cat|horse|animal|fish|butterfly|ball|balloon|kite|wheel|object|subject|target|vehicle)`;
const STICK_VERBS = String.raw`(?:stick|attach|glue|pin|lock|latch|mount|anchor|fasten|tape|hook|track|ride|stay|keep|cling|hug|follow|tag along|stuck|pinned|attached|glued|locked)\p{L}*`;
const STICK_VERBS_ES = String.raw`(?:pega|pegar|pegado|pegada|pegala|pegalo|adhiere|fija|fijar|ancla|clava|engancha|acopla|sujeta|mantiene|mantener|acompan|sigue|seguir|siga|rastrea|trackea)\p{L}*`;
const CARRIER_ES = String.raw`(?:persona|coche|auto|vehiculo|camion|bus|autobus|tren|avion|pajaro|perro|gato|corredor|bailarin|bailarina|nino|nina|hombre|mujer|mano|cabeza|cara|rostro|cuerpo|ojos?|boca|dedo|objeto|sujeto|pelota|balon|bicicleta|moto|barco|dron|animal|jugador|presentador|orador|hablante)(?! nul)`;
const STICK_VERBS_DE = String.raw`(?:kleb|heft|pinn|fixier|anker|befestig|haft|bind|verbind|folg|verfolg|begleit|bleib|track)\p{L}*`;
const CARRIER_DE = String.raw`(?<!\p{L})(?:person|mensch|auto|fahrzeug|lkw|bus|zug|flugzeug|vogel|hund|katze|laufer|tanzer|tanzerin|kind|mann|frau|hand|kopf|gesicht|korper|auge|augen|mund|finger|objekt|ball|fahrrad|boot|drohne|tier|spieler|sprecher|moderator)(?!\p{L}*null)`;
const STICK_VERBS_FR = String.raw`(?:colle|coller|collee|accroche|accrocher|fixe|fixer|ancre|rattache|attache|attacher|epingle|suit|suivre|suivent|suive|accompagne|accompagner|reste|rester|garde|garder|verrouille|track)\p{L}*`;
const CARRIER_FR = String.raw`(?:personne|voiture|vehicule|camion|bus|train|avion|oiseau|chien|chat|coureur|danseur|danseuse|enfant|homme|femme|main|tete|visage|corps|oeil|yeux|bouche|doigt|objet|sujet|balle|ballon|velo|bateau|drone|animal|joueur|presentateur|orateur)(?! nul)`;
const CARRIER_JA = "人|車|物体|オブジェクト|被写体|顔|頭|手|体|犬|猫|鳥|ボール|バス|電車|飛行機|自転車|ダンサー|ランナー|選手|ドローン|動くもの|動く物|動く被写体";
const STICK_JA = "貼り付け|貼付|くっつけ|くっつ|張り付|貼って|固定|吸着|ついて|付いて|追従|追いかけ|追って|合わせ|乗せ|載せ";
const CARRIER_ZH = "车|汽车|球|鸟|狗|猫|飞机|火车|自行车|动物|无人机|舞者|运动员|行人|主体|物体|人物|演讲者|主持人";

/** The words for sticking or tracking a graphic onto something that moves in the shot, in six languages: a stick, glue, pin or ride verb beside a person, vehicle, animal or body part. */
export const STICK_TO_MOVING_CONCEPT: RegExp = withKana(anyOf(
  String.raw`\b${STICK_VERBS}\b[^.;]{0,45}\b(?:onto|on to|on|to|with|along with|alongside|against|over|behind|beside|next to|along)\b ${DET}(?:${MOVING_ADJ} ){0,2}${CARRIER_NOUN}\b`,
  String.raw`\b${STICK_VERBS}\b[^.;]{0,45}\b(?:to|onto|on|with|along with|against) ${DET}${MOVING_ADJ} (?:\p{L}+ )?\p{L}+`,
  String.raw`${EDGE}${STICK_VERBS_ES}[^.;]{0,45}\b(?:a|al|a la|sobre|en|con|encima de)\b ${DET}(?:\p{L}+ )?${CARRIER_ES}`,
  String.raw`${EDGE}${STICK_VERBS_ES}[^.;]{0,45}(?:que se (?:mueve|desplaza|mueven)|en movimiento|que camina|que corre|que pasa|que vuela)`,
  String.raw`${EDGE}${STICK_VERBS_DE}[^.;]{0,45}\b(?:an|auf|mit|zu|am|vom|dem|der|den)\b[^.;]{0,15}${CARRIER_DE}`,
  String.raw`${EDGE}(?:mitbeweg|mitlauf|mitfahr|mitwander)\p{L}*|${EDGE}(?:bewegten|sich bewegend)\p{L}* (?:objekt|auto|person|hand|kopf)\p{L}*`,
  String.raw`${EDGE}${STICK_VERBS_FR}[^.;]{0,45}\b(?:a|au|aux|sur|avec|derriere)\b[^.;]{0,15}${CARRIER_FR}`,
  String.raw`${EDGE}${STICK_VERBS_FR}[^.;]{0,45}(?:en mouvement|qui bouge|qui se deplace|qui marche|qui court|qui passe)`,
  String.raw`(?:${CARRIER_JA})(?:に|へ|の動きに)[^。]{0,12}(?:${STICK_JA})`,
  String.raw`(?:贴|粘|钉|绑|挂|黏|附着?|吸附|锁定)[^,.。]{0,8}(?:${CARRIER_ZH})|随着?[^,.。]{0,6}(?:移动|运动|走|跑)的(?:${CARRIER_ZH})`,
));

const MEDIA = String.raw`(?:footage|video|clip|photo|image|picture|shot|plate|texture|artwork|movie|film)`;
const FORM = String.raw`(?:\p{L}+ ){0,2}(?:shape|circle|square|rectangle|star|triangle|heart|hexagon|oval|ellipse|diamond|blob|silhouette|outline|cutout|window|polygon|pill|capsule|ring|arrow|banner|stripe|ribbon)`;
const MEDIA_ES = String.raw`(?:video|imagen|foto|metraje|clip|material|textura|plano)`;
const FORM_ES = String.raw`(?:forma|circulo|cuadrado|rectangulo|estrella|triangulo|corazon|hexagono|ovalo|elipse|rombo|silueta|contorno|ventana|poligono|pildora|anillo|flecha)`;
const MEDIA_DE = String.raw`(?:video|bild|foto|footage|clip|material|textur|aufnahme)`;
const FORM_DE = String.raw`(?:form|kreis|quadrat|rechteck|stern|dreieck|herz|sechseck|oval|ellipse|raute|silhouette|kontur|fenster|polygon|ring|pfeil)`;
const MEDIA_FR = String.raw`(?:video|image|photo|plan|clip|footage|texture|rushs?)`;
const FORM_FR = String.raw`(?:forme|cercle|carre|rectangle|etoile|triangle|coeur|hexagone|ovale|ellipse|losange|silhouette|contour|fenetre|polygone|anneau|fleche)`;
const FORM_JA = "円|丸|四角|星|ハート|シェイプ|形|三角|楕円|ひし形|六角形";
const FORM_ZH = "圆形|圆|方形|形状|星形|心形|三角形|椭圆|菱形|六边形|轮廓";

/** The words for footage cut out through a shape, so the picture shows only inside it, in six languages. */
export const CUT_THROUGH_SHAPE_CONCEPT: RegExp = withKana(anyOf(
  String.raw`\b(?:cut|punch|knock|carve)\p{L}* (?:out )?${DET}(?:\p{L}+ ){0,2}${MEDIA}\b[^.;]{0,30}\b(?:through|with|using|by|via|in the shape of|into) ${DET}${FORM}\b`,
  String.raw`\b${MEDIA}\b[^.;]{0,30}\b(?:visible|shown|showing|appear\p{L}*|play\p{L}*|seen|revealed|reveal\p{L}*|cut out)\b[^.;]{0,20}\b(?:only )?(?:through|inside|within|in|via|by) ${DET}${FORM}\b`,
  String.raw`\b(?:show|reveal|display|play)\p{L}*\b[^.;]{0,30}${MEDIA}\b[^.;]{0,20}\b(?:only )?(?:through|inside|within) ${DET}${FORM}\b`,
  String.raw`${EDGE}(?:recort|corta|muestra|mostrar|revela)\p{L}*[^.;]{0,30}${MEDIA_ES}[^.;]{0,30}(?:con|a traves de|dentro de|usando|en) (?:un |una |el |la )?${FORM_ES}`,
  String.raw`${EDGE}${MEDIA_DE}[^.;]{0,30}(?:nur )?(?:innerhalb|durch|in) (?:eines |einer |einem |des |der |dem |die |das )?${FORM_DE}|${EDGE}(?:schneid|stanz|ausschneid|zeig)\p{L}*[^.;]{0,30}${MEDIA_DE}[^.;]{0,25}(?:mit|durch|in) (?:einer |einem |einen |der |dem |die |das )?${FORM_DE}`,
  String.raw`${EDGE}(?:decoup|affich|montr|recort|decoupe)\p{L}*[^.;]{0,30}${MEDIA_FR}[^.;]{0,30}(?:avec|dans|a travers|a l interieur d|en forme d)\p{L}* ?(?:un |une |le |la |l |du |de )?${FORM_FR}`,
  String.raw`(?:${FORM_JA})[^。]{0,10}(?:切り抜|くり抜|くりぬ|型抜)|(?:映像|動画|写真|画像|素材)[^。]{0,12}(?:${FORM_JA})(?:の中|の形|型)[^。]{0,6}(?:切り抜|くり抜|くりぬ|だけ|のみ|映|見せ)`,
  String.raw`(?:${FORM_ZH})[^,.。]{0,8}(?:抠出|抠|镂空|裁切|裁剪|剪出)|(?:视频|图片|画面|素材|照片)[^,.。]{0,10}(?:只|仅)?(?:在|通过|透过)[^,.。]{0,6}(?:${FORM_ZH})(?:里|中|内)?[^,.。]{0,4}(?:显示|露出|透出|播放)`,
));

const LETTERS_EN = String.raw`(?:letters?|lettering|words?|titles?|text|type|typography|characters?|glyphs?|headlines?|wordmarks?)`;

/** The words for letters filled with footage or a picture, in six languages: fill the text with a video, a picture placed in the letters, the letters showing a clip. */
export const FILL_LETTERS_CONCEPT: RegExp = withKana(anyOf(
  String.raw`\bfill\p{L}* ${DET}${LETTERS_EN}\b[^.;]{0,25}\b(?:with|using|by) ${DET}(?:\p{L}+ ){0,2}${MEDIA}\b`,
  String.raw`\b${LETTERS_EN}\b[^.;]{0,15}\b(?:filled|full|made|stuffed|packed) (?:with|of|by) ${DET}${MEDIA}\b`,
  String.raw`\b${MEDIA}\b[^.;]{0,15}\b(?:in|into|inside) ${DET}${LETTERS_EN}\b`,
  String.raw`\b${LETTERS_EN}\b[^.;]{0,20}\b(?:show|display|play|reveal)\p{L}* ${DET}${MEDIA}\b`,
  String.raw`\b${MEDIA}[- ](?:filled|inside|clipped|masked) ${LETTERS_EN}\b`,
  String.raw`${EDGE}rellen\p{L}* (?:las |el |los |la )?(?:letras|texto|titulo|palabra|tipografia)[^.;]{0,25}(?:con|de) (?:el |la |un |una )?${MEDIA_ES}`,
  String.raw`${EDGE}${MEDIA_ES}[^.;]{0,20}(?:dentro d|en el interior d|a traves d)\p{L}* (?:el |la |las |los )?(?:texto|letras|titulo|palabra)`,
  String.raw`${EDGE}(?:full|befull|ausfull)\p{L}*[^.;]{0,25}(?:buchstaben|text|schrift|titel|wort)[^.;]{0,25}${MEDIA_DE}|${EDGE}${MEDIA_DE}[^.;]{0,20}(?:im|in den|in dem|innerhalb|durch) (?:text|buchstaben|schrift|titel|wort)\p{L}*`,
  String.raw`${EDGE}(?:rempl|garni|remplis)\p{L}*[^.;]{0,25}(?:lettres|texte|titre|mot)[^.;]{0,25}${MEDIA_FR}|${EDGE}${MEDIA_FR}[^.;]{0,20}(?:dans|a l interieur d|a travers)\p{L}* ?(?:le |la |les |l |du |des )?(?:texte|lettres|titre|mot)`,
  String.raw`(?:文字|テキスト|タイトル|レタリング|フォント)(?:の形)?(?:に|を)?[^。]{0,10}(?:映像|動画|ビデオ|写真|画像)[^。]{0,6}(?:で|を)[^。]{0,6}(?:埋め|満た|塗|詰め|くり抜|切り抜|入れ|はめ|映)|(?:映像|動画|ビデオ|写真|画像)[^。]{0,10}(?:文字|テキスト|タイトル)[^。]{0,6}(?:の中|の内側|の形|で)[^。]{0,6}(?:見せ|映|埋め|くり抜|切り抜|透け)`,
  String.raw`用(?:视频|图片|图像|照片|素材|画面)(?:来)?(?:填充|填满|充满)[^,.。]{0,6}(?:文字|字|文本|标题)|(?:文字|文本|标题|字)[^,.。]{0,6}(?:里|中|内)[^,.。]{0,6}(?:显示|播放|放)[^,.。]{0,4}(?:视频|图片|画面|素材)|(?:视频|图片|画面|素材)[^,.。]{0,8}(?:填充|填入|放进|放入|显示在|透出)[^,.。]{0,6}(?:文字|字|文本|标题)`,
));

const LINE_EN = String.raw`(?:line|stroke|path|curve|outline|contour|border|trail|trace|arrow)s?`;
const START_TO_END_EN = String.raw`(?:from (?:the )?(?:start|beginning|one end|first point) to (?:the )?(?:end|finish|other end|last point)|start to (?:end|finish)|end to end|along (?:its|the) (?:path|length|line|outline|curve)|point to point|start(?:ing)? point to (?:the )?end(?:ing)? point)`;

/** The words for a line drawn out from its start to its end, or traced along its path, in six languages. */
export const DRAW_START_TO_END_CONCEPT: RegExp = withKana(anyOf(
  String.raw`\b(?:draw|trace|stroke|sketch)\p{L}*\b[^.;]{0,30}\b${START_TO_END_EN}`,
  String.raw`\b${LINE_EN}\b[^.;]{0,25}\b(?:${START_TO_END_EN}|grows? (?:from|along)|draws? (?:itself|from)|extends? (?:from|along))`,
  String.raw`\btrac(?:e|es|ing)\b[^.;]{0,15}\b(?:${LINE_EN}|shape|edge|silhouette)\b`,
  String.raw`\b(?:the |a )?${LINE_EN} (?:draws|traces|extends|travels|sweeps|unfurls|shoots) (?:out|across|along|from|on)\b`,
  String.raw`${EDGE}(?:dibuj|traz|recorr)\p{L}*[^.;]{0,30}(?:de principio a fin|de inicio a fin|de un extremo a otro|de punta a punta|desde el principio hasta el final|de izquierda a derecha)`,
  String.raw`${EDGE}(?:linea|trazo|contorno|camino)[^.;]{0,25}(?:de principio a fin|de inicio a fin|de punta a punta)`,
  String.raw`${EDGE}(?:zeichn|zieh|schreib|nachzeichn|nachfahr)\p{L}*[^.;]{0,30}(?:vom anfang bis (?:zum )?ende|von anfang bis ende|von start bis ende|vom start bis zum ende|von einem ende zum anderen|von links nach rechts)`,
  String.raw`${EDGE}(?:linie|strich|pfad|kontur)\p{L}*[^.;]{0,25}(?:vom anfang|von start|von anfang|von einem ende|entlang)`,
  String.raw`${EDGE}(?:dessin|trac|ecri)\p{L}*[^.;]{0,30}(?:du debut a la fin|de bout en bout|d.un bout a l.autre|de gauche a droite|depuis le debut jusqu)`,
  String.raw`${EDGE}(?:ligne|trait|chemin|contour|trace)[^.;]{0,25}(?:du debut a la fin|de bout en bout|d.un bout a l.autre)`,
  String.raw`(?:線|ライン|パス|輪郭|ストローク)[^。]{0,12}(?:始点から終点|端から端|最初から最後|始めから終わり)|(?:始点から終点|端から端|最初から最後)[^。]{0,12}(?:線|ライン|パス|輪郭)[^。]{0,8}(?:描|引|なぞ|辿|たど)|線を[^。]{0,10}(?:描き進|引いて行|描いていく|なぞっていく|たどっていく|辿っていく)`,
  String.raw`(?:从头到尾|从起点到终点|从始至终|由头至尾|从一端到另一端)[^,.。]{0,10}(?:画|描|绘|勾勒|走)|从(?:起点|头|开头|一端)(?:画|描|绘)到(?:终点|尾|结尾|另一端)|(?:画|描|绘制|勾勒)[^,.。]{0,10}(?:从头到尾|从起点到终点|从一端到另一端)|(?:线|线条|路径|轮廓)[^,.。]{0,10}(?:从头到尾|从起点到终点|从一端到另一端)`,
));

const TRIM_NAMES_MORE = [
  String.raw`\btrim\p{L}* (?:the |a |its |that |this |my |your )?(?:stroke |outline |line |shape )?paths?\b`,
  String.raw`${EDGE}recort\p{L}* (?:el |los |la |las |un )?(?:trazados?|trazos?|caminos?)`,
  String.raw`${EDGE}(?:pfad|pfade|strich|linie)\p{L}* (?:kurz|trimm|beschneid|stutz|zusammenzieh)\p{L}*|${EDGE}(?:trimm|beschneid|stutz|kurz)\p{L}* (?:den |die |das )?(?:pfad|pfade|strich|linie)\p{L}*`,
  String.raw`${EDGE}(?:rogn|coup|raccourci|decoup|tronqu)\p{L}* (?:le |la |les |un |son |ce )?(?:trace|trait|chemin|contour)s?`,
  "パス[をの]?削|パスを短く|パスを縮め|パスをトリミング|パスをトリム|トリムパス|ストロークをトリム|線をトリム|パスを切",
  "修剪路径|裁剪路径|路径修剪|修剪描边|修剪线条|修剪笔画|截取路径|路径裁剪",
].join("|");

/** The words for the trim paths feature by its everyday verbs, in six languages: trim, shorten or cut a path or stroke. */
export const TRIM_PATH_EVERYDAY: RegExp = withKana(anyOf(TRIM_NAMES_MORE));

/** The words for light and shadow named together, which asks for a glow and a drop shadow, in six languages. */
export const LIGHT_AND_SHADOW_LATIN: RegExp = anyOf(
  String.raw`\blight(?:s|ing)? (?:and|&|\+|plus|with|n)\s*shadows?\b`,
  String.raw`\bshadows? (?:and|&|\+|plus|with)\s*(?:light|lights|glow)\b`,
  String.raw`${EDGE}luz(?:es)? (?:y|e) sombras?`,
  String.raw`${EDGE}sombras? (?:y|e) luz(?:es)?`,
  String.raw`${EDGE}licht (?:und|&) schatten`,
  String.raw`${EDGE}schatten (?:und|&) licht`,
  String.raw`${EDGE}lumieres? et ombres?`,
  String.raw`${EDGE}ombres? et lumieres?`,
);

/** The Japanese and Chinese words for light and shadow named together. */
export const LIGHT_AND_SHADOW_CJK: RegExp = anyOf("光と影|光と陰|光影|光和影|光与影|光线和阴影|光线与阴影|光和阴影");

const GROUP_PIN = String.raw`(?:pin|stick|glue|fasten|chain|strap|tether|anchor|attach|link|tie|connect|bind|hook|lock|parent|snap|clip|hang)\p{L}*`;
const NULLISH = String.raw`(?:nulls?|null objects?|controllers?|control layers?|master (?:layer|null|control))`;
const ALL_LAYERS = String.raw`(?:everything|all|every layer|each layer|the rest|the others|all of them|all the layers|all layers)`;
const LINK_ES = String.raw`(?:vincul|enlaz|ata|une|conect|ancla|pega|fija|engancha|sujeta|cuelga|agrup|junt|amarr|anex|adjunt)\p{L}*`;
const NULL_ES = String.raw`(?:nulo|nula|objeto nulo|capa nula|controlador|capa de control)`;
const LINK_DE = String.raw`(?:verbind|verknupf|anbind|hang|bind|kleb|pinn|fixier|befestig|knupf|koppel|schliess|anker)\p{L}*`;
const NULL_DE = String.raw`(?:nullobjekt\p{L}*|null\b|steuerebene|steuerung\p{L}*|controller)`;
const LINK_FR = String.raw`(?:lie|relie|attach|accroch|rattach|colle|epingle|fixe|suspend|branch|raccord|connect|ancr)\p{L}*`;
const NULL_FR = String.raw`(?:calque nul|objet nul|nul\b|controleur|calque de controle)`;

/** The words that pin, attach or tie layers to a null or controller, which makes the parent link, in six languages: a pin, glue, hang or tie verb beside the null, and a null that carries everything. */
export const ATTACH_TO_NULL_CONCEPT: RegExp = withKana(anyOf(
  String.raw`\b${GROUP_PIN}\b[^.;]{0,50}\b(?:to|onto|on to|under|into|beneath|below|with|at)\b (?:a |an |the |one |my |that |this |its )?(?:single |same |one |new |empty |invisible |hidden )?${NULLISH}\b`,
  String.raw`\bnulls?\b[^.;]{0,30}\b(?:moves?|carries|carry|drags?|pulls?|takes?|brings?|steers?|leads?|holds?|guides?|owns?|rules?|governs?|handles?|drives?) (?:all |every |each |the rest|everything|the others|the other|them|these|those|the lot|the whole|the layers|the logos)`,
  String.raw`\b${ALL_LAYERS}\b[^.;]{0,25}\b(?:follow|follows|following|obey|obeys|ride|rides|hang|hangs|parent\p{L}*|hook\p{L}*|attach\p{L}*|stick\p{L}*|pin\p{L}*)\b[^.;]{0,20}\b(?:null|controller)`,
  String.raw`\bnulls?\b[^.;]{0,15}\b(?:as|is|becomes?) (?:the |their |a |its )?(?:parent|boss|master|leader|driver|root|base)`,
  String.raw`${EDGE}${LINK_ES}[^.;]{0,50}\b${NULL_ES}|${EDGE}${NULL_ES}[^.;]{0,50}\b${LINK_ES}`,
  String.raw`${EDGE}${LINK_DE}[^.;]{0,50}\b${NULL_DE}|${EDGE}${NULL_DE}[^.;]{0,50}\b${LINK_DE}`,
  String.raw`${EDGE}${LINK_FR}[^.;]{0,50}\b${NULL_FR}|${EDGE}${NULL_FR}[^.;]{0,50}\b${LINK_FR}`,
));

/** The Japanese and Chinese words that hook layers to a null: the null beside a parent, attach or follow word. */
export const ATTACH_TO_NULL_CJK: RegExp = unionRegex([
  withKana(near("ヌル|コントローラー|コントロールレイヤー", "まとめて動|ぶら下げ|ぶらさげ|くっつ|貼り付|固定|接続|繋が|つなが|紐づけ|ひも付|ひもづ|親子|親に|ペアレント|従わせ|従う|子に|子レイヤー|子供", 16)),
  near("空对象|控制器|控制层|控制图层", "父子|绑|粘|贴|固定|吸附|带动|控制|驱动|统一|跟着|归|拴|吊|附加|附着|子级|子层|子图层|作为父", 14),
]);

/** The words for random shaking in everyday terms, in six languages: shake, jolt, rattle or twitch, and a move or shake that is random. */
export const WIGGLE_EVERYDAY: RegExp = withKana(anyOf(
  String.raw`\brandom(?:ly)?\b[^.;]{0,15}\b(?:mov|shak|jitter|drift|wander|offset|position|rotat|nudg|jump|shift|sway|wobbl)\p{L}*`,
  String.raw`\b(?:mov|shak|jitter|drift|wander|nudg|jump|shift|sway|wobbl|bounc)\p{L}*\b[^.;]{0,15}\b(?:randomly|at random|in random|erratically|unpredictably|chaotically|haphazardly)\b`,
  String.raw`\b(?:make|makes|let|lets|have|get)\b[^.;]{0,25}\b(?:shake|shaking|jolt|rattle|rattling|twitch|twitching|flutter|fluttering)\b`,
  String.raw`${EDGE}(?:agit|tiembl|traquete)\p{L}*|${EDGE}al azar|${EDGE}(?:mueve|mover|mueva|muevan|desplaza)\p{L}*[^.;]{0,15}(?:aleatori|al azar)`,
  String.raw`${EDGE}(?:ruttel|wackel|zappel)\p{L}*|${EDGE}zufallig\p{L}*[^.;]{0,15}(?:beweg|wackel|zitter|verschieb|schwank|beb)`,
  String.raw`${EDGE}(?:agit|secou)\p{L}*|${EDGE}(?:bouge|deplace|secoue|tremble|vibre|anime|agite)\p{L}*[^.;]{0,15}(?:au hasard|aleatoirement|de facon aleatoire|n.importe comment)`,
  "ブルブル|ぶるぶる|プルプル|ぷるぷる|小刻み|ブレさせ|ぶれさせ|ランダムに(?:ずら|位置|回転|揺|震|動)|不規則に(?:動|揺|震)|ガタつ|震わせ|震わ|ゆらゆら|ふらふら",
  "随机(?:移动|摇|位移|晃|抖)|乱晃|乱抖|颤动|轻微(?:抖|晃)|抖一抖|抖一下|晃一晃|晃一下|晃来晃去|哆嗦|发抖|不规则地?(?:动|抖|晃)|来回(?:抖|晃)|抖起来|晃起来|震起来",
));
