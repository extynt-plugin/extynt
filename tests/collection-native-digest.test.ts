// The key digest that the plugin's property-details host call computes for the sidecar's reads: it obeys the read callback's budget,
// while the digest the mutation path takes stays callable unchanged.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { decodeJson, decodeOrThrow, fail, jsonObject } from '../packages/decode/dist/src/index.js';
import type { Decoder } from '../packages/decode/dist/src/index.js';
import { maybeTextOf } from '../apps/sidecar/dist/tests/http-json.js';
import { loadHostFiles } from '../apps/panel/dist/tests/host-sources.js';

type Reading = number | boolean | readonly number[] | undefined;
type ReadingFunction = () => Reading;
type Interpolation = 6613;

interface Ease {
  readonly speed: number;
  readonly influence: number;
}

interface KeyedProperty {
  isSpatial: boolean;
  keyTime: (key: number) => number;
  keyValue: (key: number) => number | readonly number[];
  keyInInterpolationType: () => Interpolation;
  keyOutInterpolationType: () => Interpolation;
  keyInTemporalEase: () => readonly Ease[];
  keyOutTemporalEase: () => readonly Ease[];
  keyInSpatialTangent: ReadingFunction;
  keyOutSpatialTangent: ReadingFunction;
  keyRoving: ReadingFunction;
  keySpatialContinuous: ReadingFunction;
  keySpatialAutoBezier: ReadingFunction;
  keyTemporalContinuous: () => boolean;
  keyTemporalAutoBezier: () => boolean;
}

type SpatialReader = 'keyInSpatialTangent' | 'keyOutSpatialTangent' | 'keyRoving' | 'keySpatialContinuous' | 'keySpatialAutoBezier';
type RefusalMode = 'throw' | 'undefined';

const SPATIAL_READERS: readonly SpatialReader[] = ['keyInSpatialTangent', 'keyOutSpatialTangent', 'keyRoving', 'keySpatialContinuous', 'keySpatialAutoBezier'];

function hostContext(): vm.Context {
  const context = vm.createContext({});
  loadHostFiles(context, 'probe.jsx');
  return context;
}

type HostArgument = KeyedProperty | number | string | undefined | (() => void) | (() => number | undefined) | ((raw: string) => string);

const textAnswer: Decoder<string> = { run: answer => typeof answer === 'string' ? answer : fail('the expected answer type', answer) };
const numberAnswer: Decoder<number> = { run: answer => typeof answer === 'number' ? answer : fail('the expected answer type', answer) };
function evaluateHost<Answer>(context: vm.Context, expression: string, args: readonly HostArgument[], answer: Decoder<Answer>): Answer {
  args.forEach((argument, index) => Reflect.set(context, `hostArg${index}`, argument));
  return decodeOrThrow(answer, vm.runInContext(expression, context));
}

const callOf = (name: string, count: number): string => `${name}(${Array.from({ length: count }, (_, index) => `hostArg${index}`).join(', ')})`;

const digestOf = (context: vm.Context, property: KeyedProperty, keys: number, onRead?: () => void): string =>
  evaluateHost(context, callOf('aeKeyDigest', 3), [property, keys, onRead], textAnswer);

const safeOf = (context: vm.Context, call: () => number | undefined, fallback: number): number => evaluateHost(context, callOf('aeSafe', 2), [call, fallback], numberAnswer);

const guardedEntry = (context: vm.Context, entry: (raw: string) => string): ((raw: string) => string) =>
  (raw) => evaluateHost(context, 'aeEntryGuard(hostArg0)(hostArg1)', [entry, raw], textAnswer);

test('the key digest stops when its read callback refuses, and the mutation digest stays callable unchanged', () => {
  const context = hostContext();
  let keys = 0, admitted = 0;
  const property = { ...keyedProperty(false, 'throw'), keyTime: () => { keys += 1; return 0; }, keyValue: () => 1 };
  assert.throws(() => digestOf(context, property, 1024, () => { admitted += 1; if (admitted > 3) throw new Error('stop'); }), /stop/);
  assert.equal(keys, 3);
  assert.match(digestOf(context, property, 1), /^1:1:/);
});

function keyedProperty(spatial: boolean, mode: RefusalMode): KeyedProperty {
  const refuse: ReadingFunction = () => { if (mode === 'throw') throw new Error('This property does not have a spatial PropertyValueType'); return undefined; };
  const key = (value: Reading): ReadingFunction => (spatial ? () => value : refuse);
  return {
    isSpatial: spatial, keyTime: (k) => k / 10, keyValue: (k) => (spatial ? [k, 2] : k),
    keyInInterpolationType: () => 6613, keyOutInterpolationType: () => 6613,
    keyInTemporalEase: () => [{ speed: 0, influence: 33 }], keyOutTemporalEase: () => [{ speed: 0, influence: 33 }],
    keyInSpatialTangent: key([1, 0]), keyOutSpatialTangent: key([0, 1]), keyRoving: key(false),
    keySpatialContinuous: key(true), keySpatialAutoBezier: key(false),
    keyTemporalContinuous: () => false, keyTemporalAutoBezier: () => false,
  };
}

test('the key digest is the same whether AE errors throw (DoScript) or return undefined (the plugin)', () => {
  const context = hostContext();
  for (const spatial of [false, true]) {
    assert.equal(digestOf(context, keyedProperty(spatial, 'throw'), 3), digestOf(context, keyedProperty(spatial, 'undefined'), 3), `spatial ${spatial}`);
  }
  assert.notEqual(digestOf(context, keyedProperty(true, 'throw'), 3), digestOf(context, keyedProperty(false, 'throw'), 3));
});

test('a spatial property digest depends on its tangents and a non-spatial one never reads them', () => {
  const context = hostContext();
  const flat = keyedProperty(false, 'throw');
  let spatialReads = 0;
  for (const name of SPATIAL_READERS) flat[name] = () => { spatialReads += 1; return 0; };
  digestOf(context, flat, 2);
  assert.equal(spatialReads, 0);
  const moved = keyedProperty(true, 'throw');
  moved.keyOutSpatialTangent = () => [5, 5];
  assert.notEqual(digestOf(context, moved, 2), digestOf(context, keyedProperty(true, 'throw'), 2));
});

test('probe helpers treat a call that returns undefined like one that throws, and an escaped error becomes a typed failure', () => {
  const context = hostContext();
  const refusing: ReadonlyArray<() => undefined> = [() => undefined, () => { throw new Error('refused'); }];
  for (const call of refusing) {
    assert.equal(safeOf(context, call, 7), 7);
  }
  assert.equal(safeOf(context, () => 0, 7), 0);
  const guarded = guardedEntry(context, () => { throw new Error('escaped'); });
  const failure = decodeJson(guarded('{}'), jsonObject);
  assert.equal(failure.ok && maybeTextOf(failure.value, 'error.code'), 'HOST_SCRIPT_ERROR');
  assert.equal(guardedEntry(context, (raw) => `ok:${raw}`)('x'), 'ok:x');
});
