/**
 * The theme tokens in styles/tokens.css: the light palette is declared twice (explicit data-theme and the
 * prefers-color-scheme fallback) and the copies must agree, and every text pairing the components use meets WCAG AA
 * in both themes.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

type Tokens = Map<string, string>;
type Rgb = readonly [number, number, number];

const AA_TEXT = 4.5;
const AA_GRAPHIC = 3;
const SURFACES = ["bg", "surface", "raised", "field"] as const;

const css = readFileSync("apps/panel/styles/tokens.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function blockAfter(header: string): string {
  const start = css.indexOf(header);
  assert.ok(start >= 0, `tokens.css has ${header}`);
  const open = css.indexOf("{", start);
  let depth = 1,
    index = open + 1;
  while (depth > 0 && index < css.length) {
    depth += css[index] === "{" ? 1 : css[index] === "}" ? -1 : 0;
    index += 1;
  }
  return css.slice(open + 1, index - 1);
}

function declarations(block: string): Tokens {
  const tokens: Tokens = new Map();
  for (const match of block.matchAll(/(--[\w-]+|color-scheme):\s*([^;]+);/g)) tokens.set(match[1] ?? "", (match[2] ?? "").trim());
  return tokens;
}

function themeTokens(block: string, primitives: Tokens): Tokens {
  const resolved: Tokens = new Map();
  for (const [name, value] of declarations(block)) {
    const reference = /^var\((--[\w-]+)\)$/.exec(value);
    resolved.set(name, reference ? (primitives.get(reference[1] ?? "") ?? value) : value);
  }
  return resolved;
}

function parse(color: string): { rgb: Rgb; alpha: number } {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const value = parseInt(hex[1] ?? "0", 16);
    return { rgb: [(value >> 16) & 255, (value >> 8) & 255, value & 255], alpha: 1 };
  }
  const rgba = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(color);
  assert.ok(rgba, `a colour this test can read: ${color}`);
  return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha: Number(rgba[4]) };
}

function over(top: string, base: string): Rgb {
  const { rgb, alpha } = parse(top);
  const under = parse(base).rgb;
  const blend = (channel: 0 | 1 | 2): number => Math.round(rgb[channel] * alpha + under[channel] * (1 - alpha));
  return [blend(0), blend(1), blend(2)];
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function ratio(foreground: Rgb, background: Rgb): number {
  const [a, b] = [luminance(foreground), luminance(background)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function colour(tokens: Tokens, name: string, base?: string): Rgb {
  const value = tokens.get(`--${name}`);
  assert.ok(value, `--${name} is defined`);
  return base ? over(value, base) : parse(value).rgb;
}

function hex(rgb: Rgb): string {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

const primitives = declarations(blockAfter(":root {"));
const DARK = themeTokens(blockAfter(':root[data-theme="dark"]'), primitives);
const LIGHT = themeTokens(blockAfter(':root[data-theme="light"]'), primitives);
const THEMES: ReadonlyArray<readonly [string, Tokens]> = [
  ["dark", DARK],
  ["light", LIGHT],
];

function assertAtLeast(label: string, actual: number, minimum: number): void {
  assert.ok(actual >= minimum, `${label}: ${actual.toFixed(2)}:1 is under ${minimum}:1`);
}

test("the prefers-color-scheme fallback repeats the explicit light theme exactly", () => {
  const fallback = themeTokens(blockAfter(":root:not([data-theme])"), primitives);
  assert.deepEqual([...fallback].sort(), [...LIGHT].sort());
});

test("both themes define the same tokens and declare their color-scheme", () => {
  assert.deepEqual([...DARK.keys()].sort(), [...LIGHT.keys()].sort());
  assert.equal(DARK.get("color-scheme"), "dark");
  assert.equal(LIGHT.get("color-scheme"), "light");
});

for (const [name, tokens] of THEMES) {
  test(`${name}: body, muted and faint text meet AA on every surface`, () => {
    for (const surface of SURFACES) {
      for (const ink of ["text", "muted", "faint"])
        assertAtLeast(`${ink} on ${surface}`, ratio(colour(tokens, ink), colour(tokens, surface)), AA_TEXT);
      assertAtLeast(`text on ${surface} (primary text)`, ratio(colour(tokens, "text"), colour(tokens, surface)), 7);
    }
  });

  test(`${name}: accent text, text on accent and the user bubble meet AA`, () => {
    for (const surface of ["bg", "surface", "raised"] as const)
      assertAtLeast(`accent-text on ${surface}`, ratio(colour(tokens, "accent-text"), colour(tokens, surface)), AA_TEXT);
    for (const fill of ["accent-solid", "accent-hover", "accent-pressed"])
      assertAtLeast(`on-accent on ${fill}`, ratio(colour(tokens, "on-accent"), colour(tokens, fill)), AA_TEXT);
    for (const ink of ["text", "muted", "accent-text"])
      assertAtLeast(`${ink} on user-bg`, ratio(colour(tokens, ink), colour(tokens, "user-bg")), AA_TEXT);
    assertAtLeast("accent against surface (focus ring, edges)", ratio(colour(tokens, "accent"), colour(tokens, "surface")), AA_GRAPHIC);
  });

  test(`${name}: status colours meet AA as text, alone and over their soft tint`, () => {
    for (const [ink, soft] of [
      ["green", "green-soft"],
      ["amber", "amber-soft"],
      ["red-text", "red-soft"],
      ["red-text", "red-soft-strong"],
    ] as const) {
      for (const surface of ["bg", "surface", "raised"] as const) {
        assertAtLeast(`${ink} on ${surface}`, ratio(colour(tokens, ink), colour(tokens, surface)), AA_TEXT);
        const tinted = hex(colour(tokens, soft, hex(colour(tokens, surface))));
        assertAtLeast(`${ink} on ${soft} over ${surface}`, ratio(colour(tokens, ink), parse(tinted).rgb), AA_TEXT);
      }
    }
    assertAtLeast("on-amber on amber", ratio(colour(tokens, "on-amber"), colour(tokens, "amber")), AA_TEXT);
    assertAtLeast("red as an icon on surface", ratio(colour(tokens, "red"), colour(tokens, "surface")), AA_GRAPHIC);
  });
  test(`${name}: the card's marks, verdict colours, state edges and quiet lines meet their contrast`, () => {
    for (const surface of ["surface", "bg"] as const) {
      for (const ink of ["green", "amber", "red-text", "muted", "faint", "text"])
        assertAtLeast(
          `${ink} on ${surface} (verdict, check marks, undo reason, before value)`,
          ratio(colour(tokens, ink), colour(tokens, surface)),
          AA_TEXT,
        );
      for (const edge of ["amber", "red", "accent"])
        assertAtLeast(`${edge} as the card's state edge on ${surface}`, ratio(colour(tokens, edge), colour(tokens, surface)), AA_GRAPHIC);
    }
    assertAtLeast("faint on raised (the Acting on label)", ratio(colour(tokens, "faint"), colour(tokens, "raised")), AA_TEXT);
    assertAtLeast("muted on field (the model pill)", ratio(colour(tokens, "muted"), colour(tokens, "field")), AA_TEXT);
    assertAtLeast("text on hover (the pill while its menu is open)", ratio(colour(tokens, "text"), colour(tokens, "hover")), AA_TEXT);
  });
}
