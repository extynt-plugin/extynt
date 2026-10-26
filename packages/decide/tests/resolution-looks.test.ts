// Offline picks for look language, control talk, family names in native script and plain-language property names, each on a small hand-made candidate list.
import assert from "node:assert/strict";
import test from "node:test";
import { pickAttribute } from "../src/resolution-attributes.js";
import { pickEffect } from "../src/resolution-effects.js";
import { pickFont } from "../src/resolution-fonts.js";

function named(titles: ReadonlyArray<string>, group = ""): ReadonlyArray<{ key: string; names: string[]; group: string; title: string }> {
  return titles.map((title) => ({ key: title, names: [title], group, title }));
}

function bundled(titles: ReadonlyArray<string>): ReadonlyArray<{ key: string; names: string[]; group: string; title: string }> {
  return titles.map((title) => ({ key: title.startsWith("CC ") ? title : `ADBE ${title}`, names: [title], group: "", title }));
}

const EFFECTS = bundled([
  "Gaussian Blur", "Fast Box Blur", "CC Radial Fast Blur", "Glow", "CC Glow", "Find Edges", "Colorama", "Hue/Saturation", "Add Grain", "Black & White", "Tint",
  "Liquify", "Ripple", "CC Twister", "Twirl", "Turbulent Displace", "Wave Warp", "Posterize", "Drop Shadow", "Noise", "Lens Flare",
]);

test("figurative look language reaches the bundled effect", () => {
  assert.equal(pickEffect("make it look hazy", EFFECTS, {}), "ADBE Gaussian Blur");
  assert.equal(pickEffect("turn it into sketchy line art", EFFECTS, {}), "ADBE Find Edges");
  assert.equal(pickEffect("cycle the colours around the wheel", EFFECTS, {}), "ADBE Colorama");
  assert.equal(pickEffect("give it an old film feel", EFFECTS, {}), "ADBE Add Grain");
  assert.equal(pickEffect("make it melt", EFFECTS, {}), "ADBE Liquify");
  assert.equal(pickEffect("mach es verschwommen", bundled(["Gaussian Blur", "Glow", "Find Edges"]), {}), "ADBE Gaussian Blur");
});

test("the standard effect wins over a variant unless a habit says otherwise", () => {
  assert.equal(pickEffect("twirl it", EFFECTS, {}), "ADBE Twirl");
  assert.equal(pickEffect("add a glow", EFFECTS, {}), "ADBE Glow");
  assert.equal(pickEffect("add a glow", EFFECTS, { "CC Glow": 5 }), "CC Glow");
});

const BLUR = [["Blur Radius", "slider"], ["Iterations", "slider"], ["Blur Dimensions", "menu"], ["Repeat Edge Pixels", "checkbox"]] as const;
const WAVE = [["Wave Type", "menu"], ["Wave Height", "slider"], ["Wave Width", "slider"], ["Direction", "angle"], ["Wave Speed", "slider"], ["Phase", "angle"]] as const;
const ECHO = [["Echo Time (seconds)", "slider"], ["Number Of Echoes", "slider"], ["Starting Intensity", "slider"], ["Decay", "slider"]] as const;

function controls(rows: ReadonlyArray<readonly [string, string]>): ReadonlyArray<{ key: string; names: string[]; group: string; title: string }> {
  return rows.map(([title, group]) => ({ key: title, names: [title], group, title }));
}

test("descriptive control talk reaches the control by synonym and unit", () => {
  assert.equal(pickAttribute("make the blur stronger", "Fast Box Blur", controls(BLUR)), "Blur Radius");
  assert.equal(pickAttribute("more passes", "Fast Box Blur", controls(BLUR)), "Iterations");
  assert.equal(pickAttribute("increase it by 20 pixels", "Fast Box Blur", controls(BLUR)), "Blur Radius");
  assert.equal(pickAttribute("taller waves", "Wave Warp", controls(WAVE)), "Wave Height");
  assert.equal(pickAttribute("make the wave faster", "Wave Warp", controls(WAVE)), "Wave Speed");
  assert.equal(pickAttribute("tilt the waves by 30 degrees", "Wave Warp", controls(WAVE)), "Direction");
  assert.equal(pickAttribute("more copies", "Echo", controls(ECHO)), "Number Of Echoes");
  assert.equal(pickAttribute("fade out faster", "Echo", controls(ECHO)), "Decay");
});

test("a request that names nothing about a control still abstains", () => {
  assert.equal(pickAttribute("make it nicer", "Fast Box Blur", controls(BLUR)), "none");
});

const TRANSFORM = ["Anchor Point", "Position", "Scale", "Rotation", "Opacity"].map((title) => ({ key: title, names: [title], group: "Transform", title }));

test("plain-language and foreign names reach the transform properties", () => {
  assert.equal(pickAttribute("make it see-through", "Layer", TRANSFORM), "Opacity");
  assert.equal(pickAttribute("mach es durchsichtig", "Layer", TRANSFORM), "Opacity");
  assert.equal(pickAttribute("double the size", "Layer", TRANSFORM), "Scale");
  assert.equal(pickAttribute("hazlo más grande", "Layer", TRANSFORM), "Scale");
  assert.equal(pickAttribute("muévelo a la izquierda", "Layer", TRANSFORM), "Position");
  assert.equal(pickAttribute("tilt it 15 degrees", "Layer", TRANSFORM), "Rotation");
  assert.equal(pickAttribute("rotate from the corner", "Layer", TRANSFORM), "Anchor Point");
  assert.equal(pickAttribute("punto de anclaje", "Layer", TRANSFORM), "Anchor Point");
});

const FAMILIES = named(["Yu Gothic", "Yu Mincho", "Meiryo", "MS Gothic", "Microsoft YaHei", "SimSun", "Malgun Gothic", "Garamond", "Gill Sans", "Hiragino Sans", "Brush Script MT", "Courier New", "Arial"]);

test("native-script names of system families reach the installed family", () => {
  assert.equal(pickFont("游ゴシック", FAMILIES, {}), "Yu Gothic");
  assert.equal(pickFont("游明朝で", FAMILIES, {}), "Yu Mincho");
  assert.equal(pickFont("メイリオ", FAMILIES, {}), "Meiryo");
  assert.equal(pickFont("ＭＳ ゴシック", FAMILIES, {}), "MS Gothic");
  assert.equal(pickFont("微软雅黑", FAMILIES, {}), "Microsoft YaHei");
  assert.equal(pickFont("宋体", FAMILIES, {}), "SimSun");
  assert.equal(pickFont("맑은 고딕", FAMILIES, {}), "Malgun Gothic");
});

test("a family name with a vendor suffix still names the family, and a described look picks a fitting one", () => {
  assert.equal(pickFont("Garamond Premier", FAMILIES, {}), "Garamond");
  assert.equal(pickFont("Gill Sans MT", FAMILIES, {}), "Gill Sans");
  assert.equal(pickFont("a handwritten brush script", FAMILIES, {}), "Brush Script MT");
  assert.equal(pickFont("Proxima Nova", FAMILIES, {}), "none");
});
