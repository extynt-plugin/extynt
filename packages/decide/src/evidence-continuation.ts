// Continuation reading: what a message sent to a stopped job means, from the go-ahead words that re-authorise it, any no-change clause, and whatever else the message adds.
import { foldText, wordsOf } from "./evidence-words.js";

type ContinuationReading = "resume" | "amend-and-resume" | "new-request";

const GO_AHEAD_PHRASES: ReadonlyArray<string> = [
  "continue", "resume", "carry on", "keep going", "go on", "keep on", "proceed", "go ahead", "go for it", "do it", "press on", "keep at it",
  "continua", "sigue", "adelante", "hazlo", "dale", "fortfahren", "fahr fort", "fahr weiter", "mach weiter", "mach weiter so", "mach so weiter", "weiter so",
  "weitermachen", "weiter machen", "bleib dran", "weiter", "continua asi", "sigue asi", "sigue con eso", "asi sigue", "continue comme ca",
  "continue ainsi", "vas y", "allez y", "poursuis", "poursuivre", "続けて", "つづけて", "続行", "続けろ", "進めて", "進めろ",
  "進んで", "最後まで", "その調子で", "その調子", "頑張って",
  "pick up where you left off", "pick it back up", "finish it", "finish up", "finish the job", "get on with it", "keep it up", "carry it on", "back to it", "let s go", "go on then", "continue please",
  "continue on", "go ahead and finish", "where you left off", "where you stopped", "donde lo dejaste", "donde te quedaste", "wo du aufgehort hast", "wo du warst", "ou tu en etais", "ou tu t etais arrete", "ou tu etais", "finish what you started", "finish the rest",
  "continuar", "continua con", "sigue adelante", "prosigue", "retoma", "reanuda", "sigamos", "seguimos", "venga", "vamos", "termina", "acaba", "sigue con", "sigue haciendo", "ahi va", "dale que si",
  "setz fort", "fortsetzen", "setz es fort", "mach es fertig", "mach das fertig", "zu ende", "bring es zu ende", "leg los", "los geht", "weitermachen", "fuhr es aus", "mach schon",
  "continuez", "continuons", "reprends", "reprenez", "reprendre", "on continue", "on y va", "vas y", "va y", "fais le", "faites le", "termine", "finis", "poursuivez", "continue le", "continue comme",
  "続けてください", "続けてね", "再開", "続き", "どんどん", "続行して", "引き続き", "やって", "進めてください", "最後までやって", "やり遂げて", "続けよう", "つづけよう", "再会", "続行してください",
  "继续", "接着", "接着做", "继续吧", "继续做", "继续干", "往下", "做完", "接着来", "做吧", "开始吧", "继续执行", "恢复", "别停", "请继续", "接着干", "往下做", "继续往下", "完成它", "把它做完", "干吧",
];

const NO_CHANGE_PHRASES: ReadonlyArray<string> = [
  "nothing else", "nothing more", "no other changes", "no changes", "no more changes", "just that", "that s all", "nichts anderes", "nichts weiter",
  "sonst nichts", "nichts andern", "unverandert", "sin cambios", "nada mas", "solo eso", "そのまま", "それだけ", "変更なし", "変えないで", "何も変えず",
  "何もしないで", "他は何も", "ほかは何も",
  "no changes needed", "leave the rest", "leave everything else", "everything else stays", "same as before", "as is", "as it is", "don t change anything", "do not change anything", "keep everything else",
  "no cambies nada", "tal cual", "como estaba", "sin tocar nada", "no toques nada", "el resto igual", "lo demas igual", "nada mas",
  "so lassen", "wie es ist", "wie bisher", "ohne anderungen", "keine anderungen", "nichts verandern", "alles andere bleibt", "der rest bleibt", "sonst bleibt alles",
  "rien d autre", "sans changement", "pas de changement", "c est tout", "tel quel", "inchange", "ne change rien", "ne touche a rien", "le reste ne change pas", "garde le reste",
  "そのままで", "変更せず", "変えずに", "変えなくて", "他はそのまま", "ほかはそのまま", "このまま", "触らず", "何も変えない",
  "不用改", "不改", "不要改", "保持不变", "不变", "没有改动", "就这样", "别的不用", "其他不变", "其余不变", "其他的不用", "什么都别改", "保持原样", "照旧", "原样",
];

const WEAK_GO_PHRASES: ReadonlyArray<string> = ["go"];

const FILLER_WORDS: ReadonlySet<string> = new Set([
  "please", "pls", "yes", "yep", "yeah", "yup", "ok", "okay", "sure", "alright", "fine", "great", "cool", "thanks", "thank", "now", "the", "rest", "with", "and", "und",
  "just", "it", "so", "then", "dann", "all", "to", "do", "can", "you", "could", "would", "will", "auch", "mach", "bitte", "ja", "doch", "mal", "den", "restlichen",
  "por", "favor", "si", "sí", "pues", "vale", "con", "el", "la", "lo", "resto", "ahora", "y", "ya",
  "super", "toll", "prima", "klasse", "gut", "perfekt", "perfecto", "bien", "genial", "parfait", "excelente", "awesome", "excellent", "perfect", "danke", "jetzt", "einfach", "gern", "gerne", "okay", "na", "also", "mit", "dem", "der", "die", "das", "bis", "zum", "ende", "fertig", "weiter", "schon", "noch", "gracias", "ahora", "mismo", "todo", "entonces", "oui", "merci", "svp", "stp", "plait", "il", "vous", "te", "s", "d", "accord", "maintenant", "encore", "tout", "alors", "bon", "jusqu", "au", "bout", "fin", "la", "le", "les", "du", "ca", "c", "est", "bonne",
  "wonderful", "nice", "good", "job", "gemacht",
]);

const CJK_FILLERS: ReadonlyArray<string> = ["はい", "お願い", "残り", "どうぞ", "よし", "うん", "ええ", "ありがとう", "ください", "下さい", "します", "全部", "全て", "いいね", "最高", "完璧", "素晴らしい", "お願いします", "ちょうだい", "くれ", "ね", "よ", "てください", "とにかく", "今", "もう", "請", "请", "吧", "啊", "呢", "哦", "呀", "一下", "好的", "好", "谢谢", "现在", "全部", "剩下的", "其余", "其他", "了", "就", "把", "它", "都", "也", "再", "一直", "到底", "下去"];

const LATIN_PHRASE = /^[a-z ]+$/;

type Taken = { readonly rest: string; readonly found: boolean };

function removeEveryOccurrence(text: string, phrase: string): Taken {
  const latin = LATIN_PHRASE.test(phrase);
  let rest = latin ? ` ${text} ` : text;
  const needle = latin ? ` ${phrase} ` : phrase;
  let found = false;
  while (rest.includes(needle)) {
    found = true;
    rest = rest.replace(needle, " ");
  }
  return { rest: rest.trim(), found };
}

function longestFirst(phrases: ReadonlyArray<string>): ReadonlyArray<string> {
  return phrases.map(foldText).sort((left, right) => right.length - left.length);
}

function takePhrases(text: string, phrases: ReadonlyArray<string>): Taken {
  return longestFirst(phrases).reduce<Taken>((taken, phrase) => {
    const next = removeEveryOccurrence(taken.rest, phrase);
    return { rest: next.rest, found: taken.found || next.found };
  }, { rest: text, found: false });
}

function residualWords(text: string): ReadonlyArray<string> {
  const withoutFillers = CJK_FILLERS.map(foldText).reduce((rest, filler) => rest.split(filler).join(" "), text);
  return wordsOf(withoutFillers).filter((word) => !FILLER_WORDS.has(word));
}

/** What a message to a stopped job means: a go-ahead with nothing else resumes it, a no-change clause resumes it whatever else it says, a go-ahead with other words amends it, and any message without a go-ahead starts something new. */
export function continuationReading(message: string): ContinuationReading {
  const withoutNoChange = takePhrases(foldText(message), NO_CHANGE_PHRASES);
  const withoutGoAhead = takePhrases(withoutNoChange.rest, GO_AHEAD_PHRASES);
  const withoutWeakGo = takePhrases(withoutGoAhead.rest, WEAK_GO_PHRASES);
  if (!withoutGoAhead.found && !withoutWeakGo.found) return "new-request";
  if (withoutNoChange.found) return "resume";
  if (residualWords(withoutWeakGo.rest).length === 0) return "resume";
  return withoutGoAhead.found ? "amend-and-resume" : "new-request";
}
