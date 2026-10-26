// Bare function calls in an After Effects expression must name an AE global, a JavaScript global, or something the expression defines itself.
// A call to anything else would disable the expression mid-apply, so it is refused with the nearest spelling After Effects offers.
import { invalid, type Refusal } from "./validation-primitives.js";

const AE_GLOBALS = [
  "radiansToDegrees", "degreesToRadians", "linear", "ease", "easeIn", "easeOut", "wiggle", "loopIn", "loopOut", "loopInDuration", "loopOutDuration",
  "clamp", "length", "lookAt", "normalize", "cross", "dot", "add", "sub", "mul", "div", "random", "gaussRandom", "seedRandom", "noise",
  "timeToFrames", "framesToTime", "timeToTimecode", "timeToCurrentFormat", "timeToFeetAndFrames", "rgbToHsl", "hslToRgb", "hexToRgb",
  "comp", "footage", "layer", "effect", "mask", "content", "marker", "posterizeTime", "createPath", "text", "temporalWiggle", "smooth",
  "valueAtTime", "velocityAtTime", "speedAtTime", "nearestKey", "key", "numKeys", "sampleImage", "sourceRectAtTime", "sourceTime", "param",
  "toComp", "fromComp", "toWorld", "fromWorld", "toCompVec", "fromCompVec", "toWorldVec", "fromWorldVec", "fromCompToSurface", "applyTransform",
  "thisComp", "thisLayer", "thisProject", "thisProperty", "mod", "isValid", "sum", "inverse",
];
const JS_GLOBALS = [
  "parseInt", "parseFloat", "isNaN", "isFinite", "Number", "String", "Array", "Object", "Boolean", "Date", "JSON", "RegExp", "Error", "Function",
  "encodeURI", "encodeURIComponent", "decodeURI", "decodeURIComponent", "escape", "unescape",
];
const KEYWORDS = ["if", "for", "while", "switch", "catch", "return", "typeof", "function", "with", "do", "else", "in", "of", "new", "void", "delete", "throw", "case", "yield", "await"];
const KNOWN = new Set([...AE_GLOBALS, ...JS_GLOBALS, ...KEYWORDS]);
const ALIASES: ReadonlyMap<string, string> = new Map([
  ["radToDeg", "radiansToDegrees"], ["rad2deg", "radiansToDegrees"], ["radiansToDeg", "radiansToDegrees"], ["toDegrees", "radiansToDegrees"],
  ["degToRad", "degreesToRadians"], ["deg2rad", "degreesToRadians"], ["degreesToRad", "degreesToRadians"], ["toRadians", "degreesToRadians"],
  ["lerp", "linear"], ["mix", "linear"], ["interpolate", "linear"], ["clip", "clamp"], ["easeInOut", "ease"], ["smoothstep", "ease"], ["easeInOutCubic", "ease"],
  ["rand", "random"], ["rnd", "random"], ["vectorLength", "length"], ["magnitude", "length"], ["mag", "length"], ["normalise", "normalize"],
  ["secondsToFrames", "timeToFrames"], ["framesToSeconds", "framesToTime"],
]);

const MEMBER_FIXES: ReadonlyMap<string, string> = new Map([
  ["keyValue", ".key(i).value"], ["keyTime", ".key(i).time"], ["keyComment", ".key(i).comment"], ["keyIndex", ".nearestKey(t).index"],
  ["getKey", ".key(i)"], ["keyAt", ".key(i)"], ["getMarker", ".key(i)"], ["numKeys", ".numKeys (a number, not a function)"],
]);

const MAX_SUGGESTION_DISTANCE = 3;
const IDENTIFIER_LIST = /[A-Za-z_$][\w$]*/g;

function strip(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, " ").replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
}

function addNames(into: Set<string>, list: string): void { for (const name of list.match(IDENTIFIER_LIST) ?? []) into.add(name); }

function groupAt(match: RegExpMatchArray, group: number): string { return match[group] ?? ""; }

function addDeclaredNames(defined: Set<string>, code: string): void {
  for (const match of code.matchAll(/\bfunction\s*([\w$]*)\s*\(([^)]*)\)/g)) {
    if (match[1]) defined.add(match[1]);
    addNames(defined, groupAt(match, 2));
  }
  for (const match of code.matchAll(/\(([^()]*)\)\s*=>|([A-Za-z_$][\w$]*)\s*=>/g)) addNames(defined, match[1] ?? groupAt(match, 2));
}

function addVariableNames(defined: Set<string>, code: string): void {
  for (const match of code.matchAll(/\b(?:var|let|const)\s+([^;=]*(?:=[^;,]*,\s*[A-Za-z_$][\w$]*)*[^;]*)/g)) {
    for (const part of groupAt(match, 1).split(",")) addNames(defined, part.split("=")[0] ?? "");
  }
  for (const match of code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*=(?![=>])/g)) defined.add(groupAt(match, 1));
}

function definedNames(code: string): Set<string> {
  const defined = new Set<string>();
  addDeclaredNames(defined, code);
  addVariableNames(defined, code);
  return defined;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = a.charAt(i - 1).toLowerCase() === b.charAt(j - 1).toLowerCase() ? 0 : 1;
      row.push(Math.min((previous[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + substitution));
    }
    previous = row;
  }
  return previous[b.length] ?? 0;
}

function nearestName(name: string): string | undefined {
  const alias = ALIASES.get(name);
  if (alias) return alias;
  let best: string | undefined;
  let bestDistance = MAX_SUGGESTION_DISTANCE;
  for (const candidate of AE_GLOBALS) {
    const distance = editDistance(name, candidate);
    if (distance < bestDistance) { best = candidate; bestDistance = distance; }
  }
  return best;
}

function memberCallError(code: string): Refusal | undefined {
  for (const match of code.matchAll(/\.\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
    const fix = MEMBER_FIXES.get(groupAt(match, 1));
    if (fix) return invalid("EXPRESSION_INVALID", `.${match[1]}() is not an After Effects expression method, so After Effects would disable the expression mid-apply. Use ${fix}; for markers, thisComp.marker.key(i) (1-based, check i <= thisComp.marker.numKeys) or thisComp.marker.key("comment").`);
  }
  return undefined;
}

function isKnownName(name: string, defined: ReadonlySet<string>): boolean { return KNOWN.has(name) || defined.has(name) || name.startsWith("$bm_"); }

function unknownCallRefusal(name: string): Refusal {
  const suggestion = nearestName(name);
  return invalid("EXPRESSION_INVALID", `${name} is not an After Effects expression function, so After Effects would disable the expression mid-apply.${suggestion ? ` Use ${suggestion}().` : " Define it in the expression or use a built-in such as linear(), ease(), clamp(), wiggle() or radiansToDegrees()."}`);
}

function bareCallError(code: string): Refusal | undefined {
  const defined = definedNames(code), seen = new Set<string>();
  for (const match of code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = groupAt(match, 1);
    if (seen.has(name) || isKnownName(name, defined)) continue;
    seen.add(name);
    if (!/\bnew\s+$/.test(code.slice(0, match.index))) return unknownCallRefusal(name);
  }
  return undefined;
}

/** The first member call After Effects does not have, or else the first bare call that is neither an After Effects/JavaScript global nor defined in the source. `new X(` is not a call to check. */
export function unknownExpressionFunctionError(source: string): Refusal | undefined {
  const code = strip(source);
  return memberCallError(code) ?? bareCallError(code);
}
