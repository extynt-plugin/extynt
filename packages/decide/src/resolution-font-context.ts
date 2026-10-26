// Words around a font request that describe its use or phrasing and never name a family, so they do not count as an unexplained family name.
const CONTEXT = (
  "show shows graphic graphics title titles logo intro video project design headline heading banner brand branding app website web game ad ads slide slides caption captions " +
  "subtitle subtitles channel film movie trailer section page card cards label labels wording lettering book books face cover covers name names scene scenes promo promos reel clip " +
  "tipo estilo aspecto parecido parece parezca se sea sean programa juego titulo grafico proyecto pelicula " +
  "wirkt wirken wie art ahnlich aussieht aussehen sieht soll sendung spiel titel grafik projekt untertitel untertiteln untertitelung vorspann abspann uberschrift uberschriften " +
  "une qui soit semble paraisse facon genre ressemble emission jeu titre graphique projet livre buch roman libro " +
  "german germany deutsch deutsche deutscher deutsches deutschen deutschland alemana aleman alemania allemand allemande allemagne doitsu aus stil en im am vom beim ins aufs sur dans sous comme tres plus moins tout toute tous encore sobre sobre entre hacia desde pero sound feel feels vibe vibes that which who whose what looks big large huge giant bit little very really quite"
).split(" ");

/** The words of a font request that carry no family name. */
export const CONTEXT_WORDS: ReadonlySet<string> = new Set(CONTEXT);
