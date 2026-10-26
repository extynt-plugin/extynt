// SVG/CSS colour values to After Effects [r, g, b] 0-1 with a separate alpha.

/** A colour as red, green and blue between 0 and 1. */
export type Rgb = [number, number, number];
interface ParsedColor { readonly rgb: Rgb; readonly alpha: number }

const NAMED: Readonly<Record<string, string>> = {
  aliceblue: "f0f8ff", antiquewhite: "faebd7", aqua: "00ffff", aquamarine: "7fffd4", azure: "f0ffff", beige: "f5f5dc", bisque: "ffe4c4", black: "000000",
  blanchedalmond: "ffebcd", blue: "0000ff", blueviolet: "8a2be2", brown: "a52a2a", burlywood: "deb887", cadetblue: "5f9ea0", chartreuse: "7fff00",
  chocolate: "d2691e", coral: "ff7f50", cornflowerblue: "6495ed", cornsilk: "fff8dc", crimson: "dc143c", cyan: "00ffff", darkblue: "00008b",
  darkcyan: "008b8b", darkgoldenrod: "b8860b", darkgray: "a9a9a9", darkgreen: "006400", darkgrey: "a9a9a9", darkkhaki: "bdb76b", darkmagenta: "8b008b",
  darkolivegreen: "556b2f", darkorange: "ff8c00", darkorchid: "9932cc", darkred: "8b0000", darksalmon: "e9967a", darkseagreen: "8fbc8f",
  darkslateblue: "483d8b", darkslategray: "2f4f4f", darkslategrey: "2f4f4f", darkturquoise: "00ced1", darkviolet: "9400d3", deeppink: "ff1493",
  deepskyblue: "00bfff", dimgray: "696969", dimgrey: "696969", dodgerblue: "1e90ff", firebrick: "b22222", floralwhite: "fffaf0", forestgreen: "228b22",
  fuchsia: "ff00ff", gainsboro: "dcdcdc", ghostwhite: "f8f8ff", gold: "ffd700", goldenrod: "daa520", gray: "808080", green: "008000",
  greenyellow: "adff2f", grey: "808080", honeydew: "f0fff0", hotpink: "ff69b4", indianred: "cd5c5c", indigo: "4b0082", ivory: "fffff0", khaki: "f0e68c",
  lavender: "e6e6fa", lavenderblush: "fff0f5", lawngreen: "7cfc00", lemonchiffon: "fffacd", lightblue: "add8e6", lightcoral: "f08080", lightcyan: "e0ffff",
  lightgoldenrodyellow: "fafad2", lightgray: "d3d3d3", lightgreen: "90ee90", lightgrey: "d3d3d3", lightpink: "ffb6c1", lightsalmon: "ffa07a",
  lightseagreen: "20b2aa", lightskyblue: "87cefa", lightslategray: "778899", lightslategrey: "778899", lightsteelblue: "b0c4de", lightyellow: "ffffe0",
  lime: "00ff00", limegreen: "32cd32", linen: "faf0e6", magenta: "ff00ff", maroon: "800000", mediumaquamarine: "66cdaa", mediumblue: "0000cd",
  mediumorchid: "ba55d3", mediumpurple: "9370db", mediumseagreen: "3cb371", mediumslateblue: "7b68ee", mediumspringgreen: "00fa9a",
  mediumturquoise: "48d1cc", mediumvioletred: "c71585", midnightblue: "191970", mintcream: "f5fffa", mistyrose: "ffe4e1", moccasin: "ffe4b5",
  navajowhite: "ffdead", navy: "000080", oldlace: "fdf5e6", olive: "808000", olivedrab: "6b8e23", orange: "ffa500", orangered: "ff4500", orchid: "da70d6",
  palegoldenrod: "eee8aa", palegreen: "98fb98", paleturquoise: "afeeee", palevioletred: "db7093", papayawhip: "ffefd5", peachpuff: "ffdab9", peru: "cd853f",
  pink: "ffc0cb", plum: "dda0dd", powderblue: "b0e0e6", purple: "800080", rebeccapurple: "663399", red: "ff0000", rosybrown: "bc8f8f", royalblue: "4169e1",
  saddlebrown: "8b4513", salmon: "fa8072", sandybrown: "f4a460", seagreen: "2e8b57", seashell: "fff5ee", sienna: "a0522d", silver: "c0c0c0", skyblue: "87ceeb",
  slateblue: "6a5acd", slategray: "708090", slategrey: "708090", snow: "fffafa", springgreen: "00ff7f", steelblue: "4682b4", tan: "d2b48c", teal: "008080",
  thistle: "d8bfd8", tomato: "ff6347", turquoise: "40e0d0", violet: "ee82ee", wheat: "f5deb3", white: "ffffff", whitesmoke: "f5f5f5", yellow: "ffff00",
  yellowgreen: "9acd32",
};

const round = (value: number): number => Math.round(value * 10_000) / 10_000;
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function fromHex(hex: string): ParsedColor | undefined {
  const digits = hex.length === 3 || hex.length === 4 ? [...hex].map((digit) => digit + digit).join("") : hex;
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/u.test(digits)) return undefined;
  const channel = (at: number) => Number.parseInt(digits.slice(at, at + 2), 16) / 255;
  return { rgb: [round(channel(0)), round(channel(2)), round(channel(4))], alpha: digits.length === 8 ? round(channel(6)) : 1 };
}

function channelValue(token: string, scale: number): number | undefined {
  const value = Number.parseFloat(token);
  if (!Number.isFinite(value)) return undefined;
  return clamp01(token.trim().endsWith("%") ? value / 100 : value / scale);
}

function functionArguments(text: string): string[] {
  return text.replace(/^[a-z]+\(|\)$/gu, "").split(/[\s,/]+/u).filter(Boolean);
}

function alphaChannel(token: string | undefined): number | undefined {
  return token === undefined ? 1 : channelValue(token, 1);
}

function fromRgbFunction(text: string): ParsedColor | undefined {
  const parts = functionArguments(text);
  if (parts.length < 3) return undefined;
  const [r, g, b] = parts.slice(0, 3).map((part) => channelValue(part, 255));
  const alpha = alphaChannel(parts[3]);
  if (r === undefined || g === undefined || b === undefined || alpha === undefined) return undefined;
  return { rgb: [round(r), round(g), round(b)], alpha: round(alpha) };
}

function hueToChannel(p: number, q: number, t: number): number {
  const wrapped = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
  if (wrapped < 1 / 6) return p + (q - p) * 6 * wrapped;
  if (wrapped < 1 / 2) return q;
  if (wrapped < 2 / 3) return p + (q - p) * (2 / 3 - wrapped) * 6;
  return p;
}

function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  if (saturation === 0) return [lightness, lightness, lightness];
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation, p = 2 * lightness - q;
  return [hueToChannel(p, q, hue + 1 / 3), hueToChannel(p, q, hue), hueToChannel(p, q, hue - 1 / 3)];
}

function fromHslFunction(text: string): ParsedColor | undefined {
  const [hueText = "", saturationText = "", lightnessText = "", alphaText] = functionArguments(text);
  const hue = ((Number.parseFloat(hueText) % 360) + 360) % 360 / 360;
  const saturation = channelValue(saturationText, 100), lightness = channelValue(lightnessText, 100);
  const alpha = alphaChannel(alphaText);
  if (!Number.isFinite(hue) || saturation === undefined || lightness === undefined || alpha === undefined) return undefined;
  const rgb = hslToRgb(hue, saturation, lightness);
  return { rgb: [round(rgb[0]), round(rgb[1]), round(rgb[2])], alpha: round(alpha) };
}

/** A CSS colour, or undefined when the text is not one (paint keywords are the caller's). */
export function parseColor(input: string): ParsedColor | undefined {
  const text = input.trim().toLowerCase();
  if (text.startsWith("#")) return fromHex(text.slice(1));
  if (text.startsWith("rgb")) return fromRgbFunction(text);
  if (text.startsWith("hsl")) return fromHslFunction(text);
  if (text === "transparent") return { rgb: [0, 0, 0], alpha: 0 };
  const named = NAMED[text];
  return named ? fromHex(named) : undefined;
}

/** The colour `amount` of the way from `left` to `right`. */
export function mixRgb(left: Rgb, right: Rgb, amount: number): Rgb {
  return [round(left[0] + (right[0] - left[0]) * amount), round(left[1] + (right[1] - left[1]) * amount), round(left[2] + (right[2] - left[2]) * amount)];
}
