// State claims that report the user's own edit ("I already moved it", "ya borre", "j'ai deja supprime") or where something is now: patterns in all six languages over folded text.

const EN_EDIT_VERBS = "(?:deleted|removed|moved|fixed|changed|renamed|trimmed|shortened|extended|lengthened|replaced|adjusted|tweaked|dragged|swapped|hid|hidden|locked|unlocked|grouped|parented|unparented|disabled|enabled|muted|nudged|reordered|duplicated|copied|offset|reset|turned (?:it |them )?(?:off|on)|pulled|pushed|lowered|raised|shifted|updated|corrected|sorted|merged|split|deactivated|retimed|resized|rotated|scaled|re-?did|redid)";

const EN_OWN_EDIT = `(?<!\\b(?:if|whether|when|before|after|until|once|unless|did|have|had|should|would|could|can|do|does|that|so|because)\\s)\\bi(?:'ve|'d| have| had)? (?:(?:already|just|now|also|finally|manually|only|then) )*${EN_EDIT_VERBS}\\b|\\b(?:already|just) ${EN_EDIT_VERBS}\\b`;

const EN_NOW_AT = "\\b(?:is|are) (?:now|currently|already) (?:at|on|in|set|sitting|located|positioned|\\d)|\\b(?:is|are) (?:at|on|in|set to|positioned at|located at|sitting at) [^,.;?!]{0,24}\\bnow\\b";

const ES_EDIT_STEMS = "(?:mov|borr|arregl|elimin|cambi|quit|recort|renombr|ajust|desactiv|coloqu|dupliqu|agrup|bloque|ocult|corregi|cort|alargu|acort|reemplac|sustitu|apag|encend|ret|baj|sub|empuj|desplac|reorden|cop|pus|deshic|restaur|alin|centr)";

const ES_OWN_EDIT = `\\b(?:ya|acabo de|recien|tambien|luego|despues) (?:\\w+ ){0,2}?${ES_EDIT_STEMS}(?:e|i|o|ar|er|ir|ado|ido)\\b|\\b(?:he|hemos|habia|habiamos) (?:ya |tambien |acabado de )?\\w+(?:ado|ido|to|cho)\\b|\\bacabo de \\w+(?:ar|er|ir)\\b`;

const ES_NOW_AT = "\\b(?:esta|estan|queda|quedan|se encuentra|sigue|ahora) (?:\\w+ ){0,2}?(?:en|a|sobre)\\b[^.;?!]{0,28}\\bahora\\b|\\bahora (?:esta|estan|es|son|queda|quedan|se encuentra)\\b";

const DE_EDIT_PARTICIPLES = "(?:geloscht|entfernt|verschoben|verandert|geandert|korrigiert|umbenannt|gekurzt|verlangert|ersetzt|angepasst|gesetzt|zuruckgesetzt|gesperrt|versteckt|gruppiert|dupliziert|deaktiviert|aktiviert|rausgenommen|weggemacht|repariert|gefixt|getauscht|verlegt|abgeschnitten|hinzugefugt|eingestellt|geschoben|zuruckgeschoben|vorgeschoben|gezogen|kopiert|gedreht|skaliert|neu angeordnet|ausgeblendet|eingeblendet|gekappt|verkurzt|ausgetauscht|aufgeraumt|beschnitten)";

const DE_OWN_EDIT = `\\b(?:ich )?(?:habe|hab|hatte)\\b[^,.;?!]{0,40}?\\b${DE_EDIT_PARTICIPLES}\\b|\\b${DE_EDIT_PARTICIPLES}\\b[^,.;?!]{0,12}\\b(?:habe|hab) ich\\b`;

const DE_NOW_AT = "\\b(?:ist|sind|liegt|liegen|steht|stehen|befindet sich|befinden sich|sitzt|sitzen) (?:\\w+ ){0,2}?(?:jetzt|nun|inzwischen)\\b|\\b(?:jetzt|nun) (?:ist|sind|liegt|liegen|steht|stehen|sitzt|sitzen)\\b";

const FR_EDIT_PARTICIPLES = "(?:supprime|efface|deplace|change|enleve|retire|corrige|renomme|raccourci|allonge|recule|avance|remplace|ajuste|groupe|duplique|desactive|active|verrouille|masque|cache|reduit|coupe|decale|mis|remis|fixe|repare|replace|modifie|rallonge|decalee?|copie|tourne|aligne|centre|ordonne|trie|rogne|ecarte|rapproche|remonte|descendu|monte)";

const FR_OWN_EDIT = `\\bj'?ai (?:(?:deja|juste|bien|enfin|aussi|manuellement|tout de suite) )*${FR_EDIT_PARTICIPLES}\\b|\\bje viens de \\w+(?:er|ir|re)\\b|\\bje l'?ai (?:deja |juste )?${FR_EDIT_PARTICIPLES}\\b|\\bdeja (?:\\w+ ){0,3}?${FR_EDIT_PARTICIPLES}\\b`;

const FR_NOW_AT = "\\b(?:est|sont|se trouve|se trouvent|reste|restent) (?:\\w+ ){0,3}?(?:maintenant|desormais|a present)\\b|\\b(?:maintenant|desormais|a present),? (?:il |elle |ils |elles )?(?:est|sont|se trouve|se trouvent)\\b|\\b(?:est|sont) [^,.;?!]{0,24}\\bmaintenant\\b";

const JA_EDIT_STEMS = "(?:動かし|移動し|消し|削除し|直し|修正し|変更し|短縮し|延長し|変え|戻し|外し|付け|つけ|入れ|置い|下げ|上げ|リネームし|グループ化し|ロックし|隠し|コピーし|複製し|置き換え|差し替え|調整し|整え|カットし|トリムし|縮め|伸ばし|揃え|ずらし|設定し|切っ|切り詰め|やり直し|削っ|離し|引っ張っ|ドラッグし|リセットし|入れ替え|並べ替え|いじっ|いじり)";

const JA_PAST_END = "(?:ておいた|ておきました|といた|てある|てあります|てしまった|てしまいました|ちゃった|ました(?!か)|た(?!ら|い|く|り|め|方|ほう|か(?!ら)|\\?|？|ばかり))";

const JA_OWN_EDIT = `${JA_EDIT_STEMS}${JA_PAST_END}`;

const JA_NOW_AT = "(?:は|が|も)今(?!すぐ|から|度|回)[^、。？?]{0,18}?(?:にある|にあります|にいる|にいます|になっている|になってる|になっています|です|だ|に来て|で止まって|に位置)";

const ZH_NOT_INTENT = "(?!想|要|需|希望|打算|准备|得|应该|可以|能|会|该|愿|计划)";

const ZH_EDIT_CHARS = "(?:删|移|改|调|修|缩短|延长|重命名|隐藏|锁定|拉|推|复制|替换|裁|剪|设置|放|拖|关掉|撤销|还原|分组|调整|对齐|居中|换|挪|拽|撤回|恢复|重置|加|减)";

const ZH_OWN_EDIT = `我(?:已经|已|刚刚|刚|都|早就|早已|又|先|自己)?${ZH_NOT_INTENT}[^，。？?！!]{0,14}?${ZH_EDIT_CHARS}[^，。？?！!]{0,12}了`;

const ZH_NOW_AT = "现在(?:已经)?(?:在|是|位于|处于|到了|停在|变成|跑到|移到)(?!是时候)|目前(?:在|是|位于|处于|停在)|已经(?:在|是|位于|处于|停在)[^，。？?]{0,12}(?:了|上)";

/** Patterns that find a report of the user's own edit, or of where something is now, in any of the six languages. */
export const STATE_CLAIMS_EDITS: ReadonlyArray<RegExp> = [
  EN_OWN_EDIT, EN_NOW_AT, ES_OWN_EDIT, ES_NOW_AT, DE_OWN_EDIT, DE_NOW_AT, FR_OWN_EDIT, FR_NOW_AT, JA_OWN_EDIT, JA_NOW_AT, ZH_OWN_EDIT, ZH_NOW_AT,
].map((source) => new RegExp(source, "u"));
