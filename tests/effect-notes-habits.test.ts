/** Tests how effect notes derive habits from plans: property kind, easing and keyframe spans. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { usageBriefingLine } from '../apps/sidecar/dist/src/effect-notes-briefing.js';
import { HABIT_MIN_SAMPLES, HABIT_SAMPLES_PER_KIND, computeHabits, mostCommon, roundSeconds } from '../apps/sidecar/dist/src/effect-notes-habits.js';
import { easingOf as easingOfJson, habitSampleOf, propertyKindOf } from '../apps/sidecar/dist/src/effect-notes-learn-habits.js';
import { forgetUndonePlanUsage, learnFromApplyReceipt } from '../apps/sidecar/dist/src/effect-notes-learn.js';
import { notesHarness, present, readNotes, succeeded } from './effect-notes-support.ts';
import type { NotesHarness } from './effect-notes-support.ts';
import type { AnimatePropertyOperation, AnimateControlOperation, KeyframeSpec, Operation, SetLayerPropertyOperation } from '../packages/action-plan/dist/src/index.js';
import type { StoredPlan } from '../packages/mcp-server/dist/src/contracts.js';
import { jsonFieldsOf, jsonOf } from '../packages/mcp-server/dist/src/index.js';
import type { StoredReceipt } from '../packages/mcp-server/dist/src/index.js';
import type { AnimationHabits } from '../apps/sidecar/dist/src/effect-notes-types.js';

const OPACITY = 'ADBE Transform Group/ADBE Opacity', POSITION = 'ADBE Transform Group/ADBE Position', GLOW = 'ADBE Glo2', GLOW_PATH = `ADBE Effect Parade/${GLOW}/${GLOW}-0001`;

type FrameExtra = Partial<Pick<KeyframeSpec, 'curve' | 'ease' | 'interpolation'>>;
type AppliedStep = Parameters<typeof habitSampleOf>[1];

interface LearnExtra {
  readonly outcomes?: ReadonlyArray<string | undefined>;
  readonly receipt?: { readonly status?: string; readonly postcondition?: string };
}

interface HabitRowFixture {
  readonly kind: string;
  readonly duration: number;
  readonly keyframes: number;
  readonly easing: string;
  readonly influence: number | null;
  readonly at: number;
}

const easingOf = (keyframes: readonly KeyframeSpec[]) => easingOfJson(keyframes.map(keyframe => jsonOf(keyframe)));
const FINGERPRINTS = { snapshotFingerprint: 's', selectionFingerprint: 'sel' };
const frames = (times: readonly number[], extra: FrameExtra = {}): KeyframeSpec[] =>
  times.map((time, index) => ({ time, value: index * 10, ...(index < times.length - 1 ? extra : {}) }));
const animate = (propertyPath: string, keyframes: KeyframeSpec[]): AnimatePropertyOperation =>
  ({ type: 'animate_property', target: { compositionId: 'c', layerId: 'L1', ...FINGERPRINTS, propertyPath }, keyframes });
const animateControl = (keyframes: KeyframeSpec[]): AnimateControlOperation => ({
  type: 'animate_control', target: { compositionId: 'c', layerId: 'L1', ...FINGERPRINTS, effectPath: `ADBE Effect Parade/${GLOW}`, propertyPath: GLOW_PATH },
  effectMatchName: GLOW, role: 'x', keyframes,
});

function storedPlan(planId: string, operations: Operation[]): StoredPlan {
  const plan = { schemaVersion: '0.2' as const, planId, snapshotFingerprint: 's', summary: 'fixture', operations, requiresApproval: true as const };
  return { plan, status: 'verified', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
}

function verified(operations: Operation[], planId = 'p', extra: LearnExtra = {}): { record: StoredPlan; receipt: StoredReceipt } {
  const outcomes = extra.outcomes ?? operations.map(() => 'confirmed');
  const operationOutcomes = operations.map((operation, index) => jsonFieldsOf({ type: operation.type, outcome: outcomes[index], targets: {} }));
  return { record: storedPlan(planId, operations), receipt: { status: 'executed', postcondition: 'passed', operationOutcomes, ...extra.receipt } };
}

const learn = (harness: NotesHarness, planId: string, operations: Operation[], extra: LearnExtra = {}): void => {
  learnFromApplyReceipt(harness.service, verified(operations, planId, extra));
};
const easy = { curve: 'easy-ease' };
const habitsOf = (harness: NotesHarness): AnimationHabits => present(harness.service.animationHabits());
function plans(harness: NotesHarness, count: number, build: (index: number) => Operation): void { for (let index = 0; index < count; index += 1) learn(harness, `plan-${index}`, [build(index)]); }

test('a property kind is read from the path, not from a list: effect controls are one kind, others are their last segment', () => {
  assert.equal(propertyKindOf(OPACITY, undefined), 'opacity'); assert.equal(propertyKindOf(POSITION, undefined), 'position'); assert.equal(propertyKindOf('ADBE Transform Group/ADBE Rotate Z', undefined), 'rotate z');
  assert.equal(propertyKindOf(GLOW_PATH, undefined), 'effect control'); assert.equal(propertyKindOf('ADBE Effect Parade/Some Vendor Thing/Anything-0007', undefined), 'effect control');
  assert.equal(propertyKindOf('ADBE Mask Parade/ADBE Mask Atom#2/ADBE Mask Shape', undefined), 'mask shape');
  assert.equal(propertyKindOf(undefined, 'transform.scale'), 'scale'); assert.equal(propertyKindOf(undefined, undefined), undefined);
});

test('easing is what the plan itself spelled out: preset curve, explicit ease (easy ease or bezier with influence), interpolation, else default', () => {
  assert.equal(easingOf(frames([0, 1], { curve: 'in-out-cubic' })).label, 'in-out-cubic');
  assert.equal(easingOf(frames([0, 1], { curve: { x1: 0.333333, y1: 0, x2: 0.666667, y2: 1 } })).label, 'easy-ease', 'a curve that is a preset is named');
  const bezier = easingOf(frames([0, 1], { curve: { x1: 0.8, y1: 0, x2: 0.4, y2: 1 } }));
  assert.deepEqual([bezier.label, Math.round(present(bezier.influence))], ['bezier', 70]);
  assert.equal(easingOf(frames([0, 1], { ease: { in: { speed: 0, influence: 33.33 }, out: { speed: 0, influence: 33.33 } } })).label, 'easy-ease');
  const custom = easingOf(frames([0, 1], { ease: { in: { speed: 0, influence: 80 }, out: { speed: 5, influence: 60 } } }));
  assert.deepEqual([custom.label, custom.influence], ['bezier', 70]);
  assert.equal(easingOf(frames([0, 1], { interpolation: { inType: 'LINEAR', outType: 'LINEAR' } })).label, 'linear');
  assert.equal(easingOf(frames([0, 1], { interpolation: { outType: 'hold' } })).label, 'hold');
  assert.equal(easingOf(frames([0, 1], { interpolation: { outType: 'ease-in-out' } })).label, 'ease');
  assert.deepEqual(easingOf(frames([0, 1])), { label: 'default', influence: null }, 'nothing said, nothing assumed');
  assert.equal(easingOf([{ time: 0, value: 0, curve: 'linear' }, { time: 1, value: 1, curve: 'in-quad' }, { time: 2, value: 2 }]).label, 'in-quad', 'a tie goes to the later segment; the last keyframe starts no segment');
});

test('a sample is the first-to-last keyframe span in seconds, the keyframe count, the kind and the easing; fewer than two keyframes is none', () => {
  const step = (operation: AnimatePropertyOperation | AnimateControlOperation | SetLayerPropertyOperation): AppliedStep => ({ operation, layerId: 'L1', propertyPath: operation.target.propertyPath });
  const sample = present(habitSampleOf('p', step(animate(OPACITY, frames([0.5, 1, 1.4], easy)))));
  assert.deepEqual([sample.propertyKind, sample.duration, sample.keyframes, sample.easing, sample.slot], ['opacity', 0.9, 3, 'easy-ease', `L1|${OPACITY}`]);
  assert.equal(habitSampleOf('p', step(animate(OPACITY, frames([2])))), undefined);
  assert.equal(habitSampleOf('p', step({ type: 'animate_property', target: { compositionId: 'c', layerId: 'L1', ...FINGERPRINTS, propertyPath: OPACITY }, expression: { source: 'wiggle(1,1)', enabled: true } })), undefined);
  assert.equal(habitSampleOf('p', step({ type: 'set_layer_property', target: { compositionId: 'c', layerId: 'L1', ...FINGERPRINTS, propertyPath: OPACITY }, role: 'transform.opacity', propertyPath: OPACITY, value: 5 })), undefined);
  assert.equal(present(habitSampleOf('p', step(animateControl(frames([0, 2], easy))))).propertyKind, 'effect control');
});

test('median, most common easing and keyframe count are computed per kind and overall, only from three or more samples', () => {
  const rows = (kind: string, durations: readonly number[], easing = 'easy-ease', keyframes = 2): HabitRowFixture[] => durations.map((duration, index) => ({ kind, duration, keyframes, easing, influence: null, at: index }));
  assert.equal(computeHabits(rows('opacity', [0.5, 0.7])), null, 'two samples say nothing');
  const habits = present(computeHabits([...rows('opacity', [0.4, 0.6, 0.8, 5]), ...rows('position', [1, 1.2], 'linear', 4), ...rows('scale', [2, 2.4, 3], 'linear', 3)]));
  assert.deepEqual(habits.kinds.map(kind => [kind.kind, kind.samples, kind.medianSeconds, kind.easing, kind.keyframes]), [['opacity', 4, 0.7, 'easy-ease', 2], ['scale', 3, 2.4, 'linear', 3]], 'position has two samples and is left out');
  assert.deepEqual([present(habits.overall).samples, present(habits.overall).medianSeconds, present(habits.overall).easing], [9, 1.2, 'linear'], 'overall counts every sample: five linear against four easy ease');
  assert.equal(HABIT_MIN_SAMPLES, 3);
  assert.deepEqual([roundSeconds(0.62), roundSeconds(0.04), roundSeconds(1.26), roundSeconds(12.3)], [0.6, 0.05, 1.3, 12.5]);
  assert.equal(mostCommon([{ value: 'b', at: 1 }, { value: 'a', at: 1 }]), 'a'); assert.equal(mostCommon([{ value: 'b', at: 2 }, { value: 'a', at: 1 }]), 'b', 'a tie goes to the more recent'); assert.equal(mostCommon([]), undefined);
  const bezier = present(computeHabits(rows('opacity', [1, 1, 1], 'bezier').map((row, index) => ({ ...row, influence: [40, 50, 60][index] ?? null }))));
  assert.deepEqual([present(bezier.overall).easing, present(bezier.overall).influence], ['bezier', 50]);
});

test('a verified receipt records one sample per animated property; fewer than three samples show no habits', t => {
  const harness = notesHarness(t);
  learn(harness, 'p1', [animate(OPACITY, frames([0, 0.6], easy)), animate(POSITION, frames([0, 1, 2], easy))]);
  assert.equal(harness.service.animationHabits(), null, 'two samples: nothing yet');
  assert.equal(usageBriefingLine(harness.service), '');
  learn(harness, 'p2', [animate(OPACITY, frames([0, 0.6], easy))]);
  const early = habitsOf(harness);
  assert.deepEqual([present(early.overall).samples, early.kinds], [3, []], 'three samples overall, but no single property kind has three yet');
  learn(harness, 'p3', [animate(OPACITY, frames([0, 0.8], easy))]);
  const { overall, kinds } = habitsOf(harness);
  assert.deepEqual(kinds.map(kind => [kind.kind, kind.samples, kind.medianSeconds, kind.easing]), [['opacity', 3, 0.6, 'easy-ease']]);
  assert.deepEqual([present(overall).samples, present(overall).medianSeconds], [4, 0.7], 'overall includes the 2 s position sample');
});

test('only a fully verified plan counts, and only its verified steps', t => {
  const harness = notesHarness(t), operation = (): Operation => animate(OPACITY, frames([0, 0.6], easy));
  for (const [index, outcomes] of [['failed'], ['rejected'], [undefined]].entries()) learn(harness, `bad-${index}`, [operation()], { outcomes });
  learn(harness, 'unverified', [operation()], { receipt: { postcondition: 'verification_unavailable' } });
  learn(harness, 'failed-post', [operation()], { receipt: { postcondition: 'failed' } });
  learn(harness, 'rejected', [operation()], { receipt: { status: 'rejected' } });
  learn(harness, 'half', [operation(), animate(POSITION, frames([0, 1], easy))], { outcomes: ['confirmed', 'failed'] });
  learnFromApplyReceipt(harness.service, { record: undefined, receipt: verified([operation()]).receipt });
  assert.equal(harness.service.animationHabits(), null, 'only the verified half of "half" counted: one sample');
  learn(harness, 'a', [operation()]);
  assert.equal(harness.service.animationHabits(), null, 'two samples');
  learn(harness, 'b', [operation()]);
  assert.deepEqual(habitsOf(harness).kinds.map(kind => [kind.kind, kind.samples]), [['opacity', 3]], 'three verified samples; position in the half-failed plan was never counted');
});

test('undoing a plan removes its samples, a late record for it is ignored, and a partial undo changes nothing', t => {
  const harness = notesHarness(t);
  plans(harness, 3, () => animate(OPACITY, frames([0, 0.6], easy)));
  assert.equal(present(habitsOf(harness).overall).samples, 3);
  forgetUndonePlanUsage(harness.service, { planId: 'plan-0', known: true, status: 'executed', finished: false });
  forgetUndonePlanUsage(harness.service, { planId: 'plan-0', known: false, status: 'executed', finished: true });
  assert.equal(present(habitsOf(harness).overall).samples, 3, 'not finished, or not a known plan: nothing is taken back');
  forgetUndonePlanUsage(harness.service, { planId: 'plan-0', known: true, status: 'executed', finished: true });
  assert.equal(harness.service.animationHabits(), null, 'two samples are left');
  learn(harness, 'plan-0', [animate(OPACITY, frames([0, 0.6], easy))]);
  assert.equal(harness.service.animationHabits(), null, 'an undone plan cannot be recorded again');
});

test('"Learn from my work" off records nothing and shows nothing; Forget clears the samples', t => {
  const harness = notesHarness(t);
  plans(harness, 3, () => animate(OPACITY, frames([0, 0.6], easy)));
  harness.service.setLearnFromWork(false);
  learn(harness, 'off', [animate(OPACITY, frames([0, 9], easy))]);
  assert.equal(harness.service.animationHabits(), null, 'nothing is offered while learning is off');
  assert.equal(usageBriefingLine(harness.service), '');
  assert.equal(readNotes(harness, GLOW).animationHabits, null);
  harness.service.setLearnFromWork(true);
  assert.equal(present(habitsOf(harness).overall).samples, 3, 'the off period recorded nothing');
  assert.equal(succeeded(harness.service.forgetUsage()).removed >= 3, true);
  assert.equal(harness.service.animationHabits(), null);
  assert.equal(present(succeeded(harness.service.settingsView()).learned).animationSeconds, null);
});

test('samples are bounded per property kind and keyed by plan and slot', t => {
  const harness = notesHarness(t);
  harness.service.recordHabitSamples(Array.from({ length: HABIT_SAMPLES_PER_KIND + 20 }, (_, index) => ({ planId: `p${index}`, propertyKind: 'opacity', duration: index < 20 ? 100 : 1, keyframes: 2, easing: 'linear', at: 100 + index })));
  const habits = habitsOf(harness);
  assert.deepEqual([present(habits.overall).samples, present(habits.overall).medianSeconds], [HABIT_SAMPLES_PER_KIND, 1], 'the 20 oldest (100 s) were evicted');
  harness.service.recordHabitSamples([{ planId: 'same', slot: 'a', propertyKind: 'scale', duration: 1, keyframes: 2, easing: 'linear' }, { planId: 'same', slot: 'a', propertyKind: 'scale', duration: 2, keyframes: 2, easing: 'linear' }, { planId: 'same', slot: 'b', propertyKind: 'scale', duration: 2, keyframes: 2, easing: 'linear' }]);
  assert.equal(present(habitsOf(harness).overall).samples, HABIT_SAMPLES_PER_KIND + 2, 'a replay of a slot updates rather than adds');
  const bad = succeeded(harness.service.recordHabitSamples([{ planId: 'x', propertyKind: 'opacity', duration: 0, keyframes: 2, easing: 'linear' }, { planId: 'x', propertyKind: 'opacity', duration: 1, keyframes: 1, easing: 'linear' }, { planId: 'x', propertyKind: 'opacity', duration: Number.NaN, keyframes: 2, easing: 'linear' }, { planId: 'x', propertyKind: '', duration: 1, keyframes: 2, easing: 'linear' }]));
  assert.deepEqual([bad.recorded, bad.invalid], [0, 4]);
});

test('the briefing line gains one short computed clause, labelled a preference, and it is absent without habits', t => {
  const harness = notesHarness(t);
  harness.service.recordKeptEvents({ planId: 'e1', kind: 'effect', name: GLOW });
  assert.doesNotMatch(usageBriefingLine(harness.service), /animations/);
  plans(harness, 3, () => animate(OPACITY, frames([0, 0.62], easy)));
  const line = usageBriefingLine(harness.service);
  assert.match(line, /; animations usually run ~0\.6 s with easy ease\.$/); assert.match(line, /an explicit request always wins/); assert.doesNotMatch(line, /\n/); assert.ok(line.length < 700, `short: ${line.length}`);
  const only = notesHarness(t);
  plans(only, 3, () => animate(OPACITY, frames([0, 1.5], { interpolation: { outType: 'hold' } })));
  assert.match(usageBriefingLine(only.service), /effects|animations usually run ~1\.5 s with hold keyframes\.$/);
  const unspoken = notesHarness(t);
  plans(unspoken, 3, () => animate(OPACITY, frames([0, 2])));
  assert.match(usageBriefingLine(unspoken.service), /animations usually run ~2 s\.$/, 'no easing is claimed when the plans spelled none out');
});

test('the settings view carries counts for "Learned so far", and the notes read carries the habits', t => {
  const harness = notesHarness(t);
  assert.deepEqual(succeeded(harness.service.settingsView()).learned, { effects: 0, fonts: 0, presets: 0, animationSeconds: null });
  harness.service.recordKeptEvents([{ planId: 'e1', kind: 'effect', name: GLOW }, { planId: 'e1', kind: 'font', name: 'Inter' }, { planId: 'e2', kind: 'effect', name: GLOW }]);
  plans(harness, 3, () => animate(OPACITY, frames([0, 0.62], easy)));
  assert.deepEqual(succeeded(harness.service.settingsView()).learned, { effects: 1, fonts: 1, presets: 0, animationSeconds: 0.6 });
  const read = readNotes(harness, GLOW);
  assert.equal(present(present(read.animationHabits).overall).medianSeconds, 0.6); assert.equal(read.writeAuthorizing, false);
});
