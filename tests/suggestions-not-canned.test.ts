// Selection-aware suggestions are written by the model from the snapshot. No source that handles them may carry a prompt of its own:
// not a list of requests, not a request per layer type, not a fallback for when the model says nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import ts from 'typescript';

const MODULES = [...globSync('apps/sidecar/src/*suggest*.ts'), ...globSync('apps/panel/runtime/panel-suggest*.ts')].sort();
const IMPERATIVE_VERBS = [
  "animate", "fade", "stabili[sz]e", "add", "apply", "make", "create", "colou?r", "grade", "blur", "glow", "keyframe", "scale", "rotate",
  "speed", "slow", "loop", "track", "mask", "remove", "rename", "duplicate", "trim", "sharpen", "smooth", "zoom", "shake", "wiggle",
  "reverse", "freeze", "crop", "replace", "parent", "extend", "shorten", "split", "cut", "move", "align", "center", "fix", "clean",
  "brighten", "darken", "desaturate", "tint", "bounce", "reveal", "wipe", "slide", "flicker", "pulse", "stretch", "offset", "delay",
  "stagger", "ease", "fill", "set", "turn", "give", "try", "use", "convert", "import", "export", "generate", "build", "design", "write",
  "show", "hide",
];
const IMPERATIVE = new RegExp(`^(${IMPERATIVE_VERBS.join("|")})\\b`, "i");
const words = (text: string): string[] => text.trim().split(/\s+/).filter(Boolean);
type TextNode = ts.StringLiteral | ts.NoSubstitutionTemplateLiteral;

const isText = (node: ts.Node): node is TextNode => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);

const isJoinedList = (node: ts.Node): boolean => ts.isArrayLiteralExpression(node) && ts.isPropertyAccessExpression(node.parent) && node.parent.name.text === 'join';
const isRequestShaped = (node: ts.Node): node is TextNode => {
  if (!isText(node)) return false;
  const count = words(node.text).length;
  return count >= 2 && count <= 6 && IMPERATIVE.test(node.text.trim());
};

function listOfPhrases(node: ts.Node): string[] {
  if (!ts.isArrayLiteralExpression(node) || isJoinedList(node)) return [];
  const phrases = node.elements.filter(isText).filter(element => words(element.text).length >= 2);
  return phrases.length >= 2 ? [`list of phrases: ${phrases.map(element => JSON.stringify(element.text)).join(', ')}`] : [];
}

/** What in one source reads as a prompt the code supplies itself. */
export function cannedPrompts(text: string, name = 'source.ts'): string[] {
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    found.push(...listOfPhrases(node));
    if (isRequestShaped(node)) found.push(`request-shaped text: ${JSON.stringify(node.text)}`);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

test('the scan finds the modules that handle suggestions, in the sidecar and in the panel', () => {
  for (const expected of ['apps/sidecar/src/suggestion-service.ts', 'apps/sidecar/src/suggestion-prompt.ts', 'apps/sidecar/src/suggestion-parse.ts', 'apps/sidecar/src/suggestion-description.ts', 'apps/sidecar/src/server-suggestions-route.ts', 'apps/panel/runtime/panel-suggest.ts', 'apps/panel/runtime/panel-suggest-view.ts', 'apps/panel/runtime/panel-suggest-hooks.ts'])
    assert.ok(MODULES.includes(expected), `${expected} is scanned`);
});

test('no module that handles suggestions carries a prompt of its own', () => {
  for (const file of MODULES) assert.deepEqual(cannedPrompts(readFileSync(file, 'utf8'), file), [], `${file} must not ship suggestion text; the model writes it`);
});

test('the scan would catch a canned list, a per-layer-type table or a fallback', () => {
  assert.equal(cannedPrompts('export const SUGGESTIONS = ["Animate in", "Add a glow", "Fade out"];').length > 0, true, 'a list');
  assert.equal(cannedPrompts('const byType = { text: "Animate it in", footage: "Stabilize the clip" };').length > 0, true, 'a table keyed by type');
  assert.equal(cannedPrompts('const fallback = ["subtle drift", "soft bloom"];').length > 0, true, 'a list of phrases in any wording');
  assert.equal(cannedPrompts('function suggest(model) { return model.reply() ?? "Fade in the title"; }').length > 0, true, 'a fallback when the model says nothing');
  assert.deepEqual(cannedPrompts('const SYSTEM = ["You write prompts for a model.", "Reply with JSON only."].join(" "); const key = "no-model";'), [], 'prose that is joined into one instruction is fine');
});
