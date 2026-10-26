// Words around a family name that only phrase the request: verbs and small words of the Latin-script languages, loanword nouns written in katakana, and the German function words that show a request is German.
const LATIN_FILLERS = (
  "switch swap replace try apply pick choose go going turn could would can should shall will please thanks thank ahead prefer rather instead maybe perhaps actually just also then there here ones into onto " +
  "cambia cambiar cambialo cambiala pon ponle ponla ponlo poner quiero quisiera queremos necesito necesitamos dame dale haz hazlo hazla hacer utiliza utilizar usalo elige elegir escoge selecciona prueba probar favor gracias ahora tambien solo ese esa eso este esta esto otro otra sobre " +
  "verwende verwenden nimm nehmen nutze nutzen benutze benutzen setze setz stelle stell andere aendere wahle wahl wechsle wechseln schreib schreibe schreiben machen mochte mochten wurde wurden hatte konnte konnten kann danke doch mal jetzt auch nur noch dann bei nach auf uber unter zum zur vom dies diese dieser dieses hier dort genau einfach gern gerne lieber statt stattdessen sollte " +
  "mets mettre mettez met utilise utiliser utilisez prends prendre choisis choisir change changer changez passe passer veux voudrais voulais souhaite aimerais faire fais applique appliquer essaie essayer plait svp merci maintenant aussi seulement juste cette cet ce ces celui celle ceux ca son sa ses notre votre ton ta ma mon mes il elle nous vous te tu je s j qu l d n m c"
).split(" ");

/** Words of a font request that carry no family name and may not be part of one. */
export const FILLER_WORDS: ReadonlySet<string> = new Set(LATIN_FILLERS);

const GERMAN_MARKERS = new Set("und mit fur der die den dem des zum zur im vom beim auf uber unter nach bei aus wird werden das ein eine einer einen einem bitte ist sind nicht schrift schriftart soll sollen wie".split(" "));

/** Whether a folded request holds a German function word, which shows its capitalised words are nouns. */
export function readsGerman(words: ReadonlyArray<string>): boolean {
  return words.some((word) => GERMAN_MARKERS.has(word));
}

/** Katakana nouns that name the thing being styled and never a family; they are removed before a katakana run is read as a family name. */
export const KATAKANA_FILLERS: ReadonlyArray<string> = [
  "サブタイトル", "タイトル", "フォント", "テキスト", "スタイル", "デザイン", "キャプション", "テロップ", "ロゴ", "イメージ", "タイプフェイス", "タイプ", "フェイス", "タイポグラフィ", "レタリング", "プロジェクト", "シーン",
  "ビデオ", "ムービー", "オープニング", "エンディング", "ヘッドライン", "ヘッダー", "バナー", "ラベル", "コピー", "ワード", "メッセージ", "セクション", "ページ", "スライド", "ブランド", "ショー", "ゲーム", "アプリ", "ウェブ",
].sort((left, right) => right.length - left.length);
