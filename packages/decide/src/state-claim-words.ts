// State-claim phrases outside English: Spanish, German, French, Japanese and Chinese ways to say what the project looks like right now, as folded patterns (lower case, no accents, ß as ss).

const ES_ACTIONS = "\\b(?:deshice|deshicimos|borre|borramos|perdi|rompi|me pase|nos pasamos|(?:he|hemos|has|han) (?:borrado|quitado|roto|cambiado|movido|perdido|eliminado|olvidado)|borraste|quitaste|rompiste|cambiaste|moviste|eliminaste|olvidaste)\\b";

const ES_NEGATIVE = "\\bno (?:se (?:ve|ven|aplica|aplican|mueve|mueven|nota|muestra|aplico|movio)|aparece|aparecen|funciona|funcionan|sale|salen|hace nada|cambia|cambio|pasa nada|paso nada|esta|estan|hay|existe|queda|quedo|es (?:un|una|el|la|redond\\w*|circular))\\b";

const ES_STATE = "\\b(?:ya|todavia|aun) (?:esta|estan|es|son|tiene|tienen|hay|era|estaba)\\b|\\bsigue (?:sin|siendo|estando|igual|mal|parpadeando|saltando|cortando|apareciendo)\\b|\\b(?:esta|estan|queda|quedo|se ve|se ven|parece|salio|se quedo|se puso|va) (?:\\w+ )?(?:mal|rot[oa]s?|cortad\\w*|borros\\w*|vaci[oa]|negr[oa]|fuera|demasiado|muy|desplazad\\w*|desalinead\\w*|descentrad\\w*|torcid\\w*|pixelad\\w*|lent[oa]|rapid[oa]|tarde|solapad\\w*|desaparecid\\w*|perdid\\w*|al reves|invertid\\w*)\\b";

const ES_EVENTS = "\\b(?:desaparecio|desaparecieron|se perdio|se borro|se fue|se corta|se cortan|se solapan|se superponen|parpadea|tiembla|falta|faltan)\\b|\\b(?:empieza|comienza|arranca|termina|acaba|dura) (?:a las|a los|en|a) \\d";

const DE_ACTIONS = "\\bich habe (?:es |ihn |sie |das |die |den )?(?:ruckgangig|geloscht|verloren|kaputt|versehentlich|zu weit)\\b|\\b(?:du hast|ihr habt|sie haben) (?:\\w+ ){0,3}(?:geloscht|entfernt|verschoben|verandert|kaputt|vergessen|ruckgangig|weggemacht|verloren|uberschrieben)\\b|\\bzu weit (?:zuruck|ruckgangig)\\b";

const DE_STATE = "\\b(?:ist|sind|war|waren|bleibt|bleiben|wirkt|wirken|liegt|liegen|steht|stehen|wird|werden) (?:\\w+ )?(?:nicht|nirgends|kein\\w*|weg|leer|falsch|kaputt|verschwunden|abgeschnitten|ausserhalb|zu \\w+|schon|bereits|immer noch|noch|doppelt|versetzt|verschoben|verzerrt|unscharf|verpixelt|ruckelig|schief|uberlappt|uberlagert)\\b";

const DE_EVENTS = "\\b(?:funktioniert|klappt|greift|wirkt|passiert|erscheint|reagiert) (?:\\w+ )?nicht\\b|\\bnichts (?:passiert|geschieht|ist zu sehen)\\b|\\bnicht (?:zu sehen|sichtbar|mehr da|vorhanden|angekommen|ubernommen)\\b|\\b(?:fehlt|fehlen|verschwunden|verschwand|abgeschnitten)\\b|\\b(?:ruckelt|flackert|springt|zittert|wackelt|hakt|stockt) (?:immer|standig|dauernd|manchmal|am ende|noch)\\b|\\b(?:startet|beginnt|endet|dauert|setzt ein) (?:erst )?(?:bei|um|nach) \\d";

const FR_SUBJECT = "(?:il|elle|ils|elles|ca|cela|ce|on|(?:le|la|les|l'|mon|ma|mes|ton|ta|ses|son)\\s?\\w+(?: \\w+)?)";

const FR_ACTIONS = "\\bj'?ai (?:annule|supprime|efface|perdu|casse|deplace|change|enleve|retire)\\b|\\b(?:tu as|vous avez) (?:\\w+ ){0,3}(?:supprime|efface|casse|change|deplace|oublie|enleve|retire|annule|perdu|modifie)\\b|\\btrop loin\\b";

const FR_NEGATIVE = `\\b${FR_SUBJECT} (?:ne|n')\\s?(?:est|sont|etait|marche|fonctionne|bouge|bougent|change|changent|reagit|se voit|se voient|s'affiche|s'affichent|s'applique|s'appliquent|s'anime|apparait|apparaissent|se passe) ?(?:pas|plus|jamais)\\b|\\brien ne (?:se passe|bouge|change|marche|s'affiche)\\b|\\bil n'y a (?:pas|plus|aucun|aucune)\\b|\\bn'y a (?:pas|plus)\\b`;

const FR_STATE = "\\b(?:est|sont|semble|semblent|reste|restent|etait|etaient) (?:\\w+ )?(?:deja|encore|toujours|trop|coupe\\w*|vide\\w*|casse\\w*|decale\\w*|flou\\w*|pixelis\\w*|invisible|cache\\w*|faux|fausse|disparu\\w*|hors cadre|en dehors|mal|decentre\\w*|de travers)\\b|\\b(?:a disparu|ont disparu|disparu|manque|manquent|clignote|saccade|deborde|depasse|se chevauchent|se chevauche|se superposent)\\b|\\b(?:commence|demarre|finit|se termine|dure) (?:a|apres|vers) \\d";

const JA_UNLESS_REQUEST = "(?!よう|ほう|方が|ほしい)";

const JA_STATE = `(?:見えな(?:い|く|かっ)|見えません|表示されな(?:い|く)|表示されません|表示されていない|動かな(?:い|く)|動きません|動いていない|効かな(?:い|く)|効いていない|効きません|反映されな(?:い|く)|反映されていない|適用されな(?:い|く)|適用されていない|出てこな(?:い|く)|足りな(?:い|く)|入っていない|入ってない|ついていない|付いていない|できていない|なっていない|なってない)${JA_UNLESS_REQUEST}`;

const JA_EVENTS = "消えた|消えて(?:い|し|る|ま)|消えちゃ|なくなっ|無くなっ|ずれて|ズレて|はみ出|切れて|途切れ|ちらつ|カクカク|カクつ|重なって|おかしい|変になっ|壊れて|壊れた|壊れちゃ|なっている|なってる|になっている|になってる|[ぁ-んァ-ヶ一-龥]{1,4}(?:すぎる|すぎて|すぎだ|すぎです|過ぎる|過ぎて)";

const JA_ACTIONS = "戻しすぎ|取り消しすぎ|やりすぎ|消しすぎ|消してしまっ|消しちゃ|壊してしまっ|壊しちゃ|間違えて(?:消|変)|勝手に(?:消|変|動)|あなたが(?:消|変|動|壊)|君が(?:消|変|動|壊)|さっき(?:の)?(?:変更|操作)で|(?:もう|すでに|既に)[^、。]{0,12}(?:になっ|です|だ|ある|あります|入って|付いて|ついて|設定され)|まだ[^、。]{0,10}(?:ない|ません|いる|います|ある|です)";

const ZH_UNLESS_REQUEST = "(?<!不要|别|避免|不想|不能|别让|不要让|别太|不要太)";

const ZH_STATE = `${ZH_UNLESS_REQUEST}(?:看不见|看不到|不显示|没有显示|没显示|显示不出|动不了|不起作用|没效果|没有效果|没反应|没有反应|没有生效|没生效|不生效|没有变化|没变化|不见了|消失了|没了|少了|缺少|缺了|空了|被删|被移|被裁|被切|被挡|被遮|超出|出界|跑出|偏了|偏移|错位|重叠了|重叠在|卡顿|卡了|不对|有问题|出错|错了|变成了|已经|仍然|依然|仍旧|太(?:慢|快|暗|亮|大|小|长|短|宽|窄|细|粗|糊|近|远|低|高|多|少|淡|浓|硬|软)|过(?:慢|快|暗|亮|大|小)|太[一-龥]{1,2}了)`;

const ZH_ACTIONS = "撤销[^，。]{0,3}(?:过头|太多|多了)|撤销了|我删了|我把[^，。]{0,8}(?:删|撤销)|你(?:删|改|移|弄坏|搞坏|漏|忘|把[^，。]{0,6}(?:删|改|移|弄坏))|不是[^，。]{0,6}(?:圆|直|居中)";

/** Patterns that find a statement about the project's present state in Spanish, German, French, Japanese or Chinese. */
export const STATE_CLAIMS_OTHER: ReadonlyArray<RegExp> = [
  ES_ACTIONS, ES_NEGATIVE, ES_STATE, ES_EVENTS, DE_ACTIONS, DE_STATE, DE_EVENTS, FR_ACTIONS, FR_NEGATIVE, FR_STATE,
  JA_STATE, JA_EVENTS, JA_ACTIONS, ZH_STATE, ZH_ACTIONS,
].map((source) => new RegExp(source, "u"));
