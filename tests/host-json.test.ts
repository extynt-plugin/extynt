/** Tests that the host's JSON implementation matches the native JSON for stringify and parse. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import type { JsonValue } from '../packages/decode/dist/src/index.js';
import { parseJson } from '../apps/sidecar/dist/tests/http-json.js';
import { decodeOrThrow, fail } from '../packages/decode/dist/src/index.js';
import type { Decoder } from '../packages/decode/dist/src/index.js';

const SOURCE = readFileSync(new URL('../apps/panel/host/json.jsx', import.meta.url), 'utf8');

interface Sandbox {
  $?: { global: Sandbox };
  marker?: { parse: () => string; stringify: () => string };
}

type EngineResult = string | number | boolean | undefined;

function engineWithoutJson(): Sandbox {
  const sandbox: Sandbox = {};
  sandbox.$ = { global: sandbox };
  vm.createContext(sandbox);
  vm.runInContext('delete globalThis.JSON;', sandbox);
  assert.equal(vm.runInContext('typeof JSON', sandbox), 'undefined');
  vm.runInContext(SOURCE, sandbox);
  return sandbox;
}

const ours = engineWithoutJson();

const scalarDecoder: Decoder<EngineResult> = {
  run: outcome => outcome === undefined || typeof outcome === 'string' || typeof outcome === 'number' || typeof outcome === 'boolean' ? outcome : fail('a scalar engine result', outcome),
};
const evaluate = (context: vm.Context, code: string): EngineResult => decodeOrThrow(scalarDecoder, vm.runInContext(code, context));

const inEngine = (code: string): EngineResult => evaluate(ours, code);

function textInEngine(code: string): string {
  const outcome = inEngine(code);
  if (typeof outcome !== 'string') throw new Error(`engine returned no text for ${code}`);
  return outcome;
}

const VALUES: readonly JsonValue[] = [
  0, -0.5, 1e21, 123456789, 3.25e-7, true, false, null, '', 'plain', 'quote " back \\ slash / solidus',
  'controls \b\f\n\r\t \u0001 \u001f', 'line sep \u2028 para \u2029', 'unicode é ✓ 😀', [], {}, [1, [2, [3]]],
  { a: 1, b: [true, null, 'x'], c: { d: {} } }, { 'key "quoted"': 'v', '': 'empty key' },
];

test('stringify matches the native JSON for plain values', () => {
  for (const value of VALUES) {
    const text = textInEngine(`JSON.stringify(${JSON.stringify(value)})`);
    assert.deepEqual(parseJson(text), value, text);
    if (!JSON.stringify(value).match(/[\u2028\u2029]/)) assert.equal(text, JSON.stringify(value));
  }
});

test('parse matches the native JSON, including whitespace and every escape', () => {
  const texts = [...VALUES.map((value: JsonValue) => JSON.stringify(value, null, 2)), ' \t\n[ 1 , {"a" : "\\u00e9\\/\\"" } ] ', '"\\ud83d\\ude00"', '1E+2', '0.5e-3'];
  for (const text of texts) assert.deepEqual(parseJson(textInEngine(`JSON.stringify(JSON.parse(${JSON.stringify(text)}))`)), parseJson(text), text);
  assert.equal(inEngine('1 / JSON.parse("-0")'), -Infinity);
});

test('stringify skips functions and undefined in objects, nulls them in arrays and writes non-finite numbers as null', () => {
  assert.equal(inEngine('JSON.stringify({ a: undefined, f: function () {}, n: NaN, i: Infinity, k: 1 })'), '{"n":null,"i":null,"k":1}');
  assert.equal(inEngine('JSON.stringify([undefined, function () {}, NaN])'), '[null,null,null]');
  assert.equal(inEngine('JSON.stringify(undefined)'), undefined);
  assert.equal(inEngine('JSON.stringify(new String("s"))'), '"s"');
});

test('stringify honours toJSON, a replacer function or key list, and the indent', () => {
  assert.equal(inEngine('JSON.stringify({ when: { toJSON: function (key) { return "at " + key; } } })'), '{"when":"at when"}');
  assert.equal(inEngine('JSON.stringify({ a: 1, b: 2 }, function (key, value) { return key === "b" ? undefined : value; })'), '{"a":1}');
  assert.equal(inEngine('JSON.stringify({ a: 1, b: 2, c: 3 }, ["c", "a"])'), '{"c":3,"a":1}');
  const nested = { a: [1, { b: [] }], c: {} };
  assert.equal(inEngine(`JSON.stringify(${JSON.stringify(nested)}, null, 2)`), JSON.stringify(nested, null, 2));
  assert.equal(inEngine(`JSON.stringify(${JSON.stringify(nested)}, null, "--")`), JSON.stringify(nested, null, '--'));
});

test('a cyclic value throws a TypeError', () => {
  assert.equal(inEngine('(function () { var a = {}; a.self = a; try { JSON.stringify(a); return "no"; } catch (e) { return e instanceof TypeError; } })()'), true);
});

test('parse refuses malformed text with a SyntaxError', () => {
  for (const text of ['', '{', '[1,]', '{"a":1,}', '{a:1}', "'x'", '01', '1.', '.5', '+1', '"\\x"', '"\\u12"', '"tab\there"', 'tru', 'nul', '[1] 2', '"open']) {
    assert.equal(inEngine(`(function () { try { JSON.parse(${JSON.stringify(text)}); return "parsed"; } catch (e) { return e instanceof SyntaxError; } })()`), true, text);
  }
});

test('parse applies a reviver bottom-up and drops what it returns undefined for', () => {
  const revived = inEngine('JSON.stringify(JSON.parse(\'{"a":1,"b":{"c":2,"drop":3}}\', function (key, value) { if (key === "drop") return undefined; return typeof value === "number" ? value * 10 : value; }))');
  assert.equal(revived, '{"a":10,"b":{"c":20}}');
});

test('an engine that already has JSON keeps it', () => {
  const sandbox: Sandbox = { marker: { parse() { return 'kept'; }, stringify() { return 'kept'; } } };
  sandbox.$ = { global: sandbox };
  vm.createContext(sandbox);
  vm.runInContext('globalThis.JSON = marker;', sandbox);
  vm.runInContext(SOURCE, sandbox);
  assert.equal(evaluate(sandbox, 'JSON.parse("1")'), 'kept');
});
