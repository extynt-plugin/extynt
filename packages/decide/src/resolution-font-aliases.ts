// Native-script names of the typeface families that ship with the operating systems (Japanese, Chinese, Korean), read as the Latin names the installed list carries. A native name glued to a weight or width word ("ヒラギノ角ゴシックW3", "游ゴシックBold") is split so the family still resolves.

const ROWS: ReadonlyArray<readonly [native: string, family: string]> = [
  ["ヒラギノ角ゴシック", "Hiragino Sans"], ["ヒラギノ角ゴ", "Hiragino Sans"], ["ヒラギノ丸ゴシック", "Hiragino Maru Gothic"], ["ヒラギノ丸ゴ", "Hiragino Maru Gothic"], ["ヒラギノ明朝", "Hiragino Mincho"], ["ヒラギノ", "Hiragino"],
  ["游ゴシック", "Yu Gothic"], ["游明朝", "Yu Mincho"], ["游教科書体", "Yu Kyokasho"], ["メイリオ", "Meiryo"],
  ["MS Pゴシック", "MS PGothic"], ["MSPゴシック", "MS PGothic"], ["MSゴシック", "MS Gothic"], ["MS ゴシック", "MS Gothic"], ["MS P明朝", "MS PMincho"], ["MS明朝", "MS Mincho"], ["MS 明朝", "MS Mincho"],
  ["小塚ゴシック", "Kozuka Gothic"], ["小塚明朝", "Kozuka Mincho"], ["源ノ角ゴシック", "Source Han Sans"], ["源ノ明朝", "Source Han Serif"], ["BIZ UDゴシック", "BIZ UDGothic"], ["BIZ UD明朝", "BIZ UDMincho"],
  ["微软雅黑", "Microsoft YaHei"], ["微軟雅黑", "Microsoft YaHei"], ["微軟正黑體", "Microsoft JhengHei"], ["微软正黑体", "Microsoft JhengHei"],
  ["新宋体", "NSimSun"], ["新細明體", "PMingLiU"], ["宋体", "SimSun"], ["宋體", "SimSun"], ["细明体", "MingLiU"], ["細明體", "MingLiU"], ["黑体", "SimHei"], ["黑體", "SimHei"], ["楷体", "KaiTi"], ["楷體", "KaiTi"], ["仿宋", "FangSong"],
  ["苹方", "PingFang SC"], ["蘋方", "PingFang TC"], ["华文黑体", "STHeiti"], ["华文宋体", "STSong"], ["冬青黑体", "Hiragino Sans GB"], ["思源黑体", "Source Han Sans"], ["思源宋体", "Source Han Serif"], ["思源黑體", "Source Han Sans"],
  ["맑은 고딕", "Malgun Gothic"], ["맑은고딕", "Malgun Gothic"], ["나눔고딕", "NanumGothic"], ["나눔명조", "NanumMyeongjo"], ["나눔스퀘어", "NanumSquare"], ["굴림", "Gulim"], ["돋움", "Dotum"], ["바탕", "Batang"], ["궁서", "Gungsuh"],
  ["애플 SD 산돌고딕 Neo", "Apple SD Gothic Neo"], ["애플 SD 산돌고딕", "Apple SD Gothic Neo"], ["산돌고딕", "Apple SD Gothic Neo"], ["본고딕", "Source Han Sans K"],
  ["游ゴシック体", "Yu Gothic"], ["游明朝体", "Yu Mincho"], ["游ゴシック", "Yu Gothic"], ["BIZ UDPゴシック", "BIZ UDPGothic"], ["ヒラギノ明朝 ProN", "Hiragino Mincho ProN"],
  ["微软雅黑体", "Microsoft YaHei"], ["微软雅黑", "Microsoft YaHei"], ["苹方简", "PingFang SC"], ["苹方-简", "PingFang SC"], ["苹方体", "PingFang SC"], ["等线体", "DengXian"], ["等线", "DengXian"],
  ["仿宋体", "FangSong"], ["华文仿宋", "STFangsong"], ["华文楷体", "STKaiti"], ["华文中宋", "STZhongsong"], ["华文细黑", "STXihei"], ["华文新魏", "STXinwei"], ["幼圆", "YouYuan"], ["隶书", "LiSu"], ["思源宋體", "Source Han Serif"],
];

const LONGEST_FIRST: ReadonlyArray<readonly [native: string, family: string]> = [...ROWS].sort((left, right) => right[0].length - left[0].length);

const GLUED_SUFFIXES: ReadonlyArray<string> = ["semibold", "extrabold", "bold", "light", "medium", "black", "italic", "regular", "pro", "std", "lt", "mt", "itc", "jp", "sc", "tc", "kr", "hk"];

const SHORTEST_HEAD = 4;

const SHORTEST_GLUED = 7;

const PLAIN_STYLE_NAMES: ReadonlySet<string> = new Set(["黑体", "黑體", "宋体", "宋體", "楷体", "楷體"]);

function latinOf(native: string, family: string): string {
  return PLAIN_STYLE_NAMES.has(native) ? `${family.toLowerCase()} ${native}` : family;
}

function splitGlued(word: string): string {
  const lower = word.toLowerCase();
  const suffix = GLUED_SUFFIXES.find((ending) => lower.endsWith(ending) && word.length >= SHORTEST_GLUED && word.length - ending.length >= SHORTEST_HEAD);
  return suffix === undefined ? word : `${word.slice(0, word.length - suffix.length)} ${word.slice(word.length - suffix.length)}`;
}

function withSplitSuffixes(text: string): string {
  return text.split(/(\s+)/u).map((piece) => (/^\s+$/u.test(piece) ? piece : splitGlued(piece))).join("");
}

/** The request with the native names of system families written as their Latin names; the ideograph names that are also plain words for a style (黑体, 宋体, 楷体) stay beside it, with the family in lower case, so the style is still read. */
export function withLatinFamilies(phrase: string): string {
  const text = phrase.normalize("NFKC");
  return withSplitSuffixes(LONGEST_FIRST.reduce((rest, [native, family]) => (rest.includes(native) ? rest.split(native).join(` ${latinOf(native, family)} `) : rest), text));
}
