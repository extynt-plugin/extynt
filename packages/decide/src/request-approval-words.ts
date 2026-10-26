// The words a request uses to ask to see the design first, or to wait for a go-ahead, before anything is built: one list per language so the match also names the language.
export type RequestLanguage = "en" | "es" | "de" | "fr" | "ja" | "zh-Hans";

export const APPROVAL_FIRST_WORDS: Readonly<Record<RequestLanguage, ReadonlyArray<string>>> = {
  en: [
    "show me the design", "show me the plan", "show me the concept", "show me the mockup", "show me first", "show me before", "show me what you", "design first", "plan first", "see the design", "see the plan", "see it first", "see it before",
    "preview it first", "preview the design", "my go ahead", "my approval", "my ok", "my okay", "my sign off", "wait for my", "wait until i", "wait for me", "before you build", "before you start", "before you draw", "before building",
    "before you make it", "before you create", "approve it before", "approve the design", "approve it first", "let me approve", "let me see the design", "let me see the plan", "let me review", "let me check the design",
    "run it by me", "check with me first", "check in with me", "ask me before", "ask me first", "get my approval", "get my ok", "get my go",
  ],
  es: [
    "muestrame el diseno", "muestrame el plan", "muestrame la idea", "ensename el diseno", "ensename el plan", "muestrame primero", "muestrame antes", "ensename primero", "mostrar el diseno", "primero el diseno", "diseno primero",
    "quiero ver el diseno", "quiero ver el plan", "quiero ver primero", "dejame ver el diseno", "dejame aprobar", "dejame revisar", "antes de construir", "antes de crear", "antes de hacerlo", "antes de empezar", "antes de dibujar",
    "espera mi aprobacion", "espera mi visto bueno", "espera mi ok", "espera a que apruebe", "espera a que te de", "hasta que lo apruebe", "hasta que yo apruebe", "mi aprobacion", "mi visto bueno", "pidemelo antes", "consultamelo antes",
  ],
  de: [
    "zeig mir den entwurf", "zeig mir das design", "zeig mir den plan", "zeig mir zuerst", "zeig mir vorher", "zeige mir den entwurf", "zeige mir das design", "zeige mir zuerst", "entwurf zuerst", "design zuerst", "zuerst den entwurf",
    "erst den entwurf", "erst zeigen", "zuerst zeigen", "ich will den entwurf sehen", "ich mochte den entwurf sehen", "ich will das design sehen", "lass mich den entwurf", "lass mich das design", "lass mich es freigeben", "bevor du baust",
    "bevor du anfangst", "bevor du erstellst", "bevor du zeichnest", "bevor du es baust", "vor dem bauen", "warte auf mein ok", "warte auf meine freigabe", "warte auf mein go", "warte auf meine zustimmung", "warte auf mich", "meine freigabe",
    "meine zustimmung", "mein okay", "frag mich vorher", "frag mich zuerst", "hol meine freigabe",
  ],
  fr: [
    "montre moi le design", "montre moi la conception", "montre moi le plan", "montre moi la maquette", "montre moi d abord", "montre moi avant", "montre d abord", "montrez moi", "d abord le design", "le design d abord", "la conception d abord",
    "je veux voir le design", "je veux voir la conception", "je veux voir d abord", "laisse moi voir le design", "laisse moi valider", "laisse moi approuver", "laisse moi verifier", "avant de construire", "avant de creer", "avant de commencer",
    "avant de dessiner", "avant de le faire", "attends mon feu vert", "attends mon accord", "attends mon approbation", "attends ma validation", "attends que je valide", "attends que j approuve", "mon feu vert", "mon accord avant", "mon approbation",
    "ma validation", "demande moi avant", "demande moi d abord",
  ],
  ja: [
    "先にデザインを見せ", "最初にデザインを見せ", "先にデザインを見", "先にプランを見せ", "先に案を見せ", "先に見せて", "先に見せてから", "まずデザインを見せ", "まず見せて", "デザインを見せてから", "デザインを確認してから", "デザインを見てから",
    "作る前に見せ", "作る前に確認", "作る前にデザイン", "作成する前に", "構築する前に", "作り始める前に", "進める前に確認", "描く前に確認", "描く前に見せ", "確認してから進", "確認してから作", "確認してから始",
    "承認してから", "承認するまで", "承認を待", "私の承認", "僕の承認", "OKが出るまで", "OKを出すまで", "OKするまで", "OKをもらってから", "ゴーサイン", "了承するまで", "了承してから", "許可するまで", "許可を待",
    "承認させて", "チェックさせてから",
  ],
  "zh-Hans": [
    "先给我看", "先让我看", "先看设计", "先看看设计", "先看方案", "先看看方案", "先出设计", "先出方案", "给我看设计", "给我看看设计", "给我看方案", "让我看看设计", "让我看看方案", "让我先看", "先让我确认",
    "等我确认", "等我批准", "等我同意", "等我点头", "等我的确认", "等我的批准", "等我的同意", "等我说开始", "等我说可以", "等我回复", "等我审核", "我批准后", "我确认后", "我同意后", "确认后再", "确认之后再", "批准后再", "批准之后再",
    "同意后再", "同意之后再", "经我同意", "经过我同意", "需要我批准", "需要我确认", "构建之前", "制作之前先", "开始之前先", "动手之前先", "动工之前先", "我的批准", "我的确认",
  ],
};
