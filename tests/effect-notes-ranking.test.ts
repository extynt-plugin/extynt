/** Tests ranking of effects by distinct plans and layers, and how undo removes a plan's effects. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { effectUsageCounts, usageBriefingLine } from '../apps/sidecar/dist/src/effect-notes-briefing.js';
import { USAGE_EVENTS_PER_NAME } from '../apps/sidecar/dist/src/effect-notes-events.js';
import type { KeptEventInput, SeenEventInput, UsageKind } from '../apps/sidecar/dist/src/effect-notes-types.js';
import { notesHarness, present, readNotes, succeeded, uncheckedRecorder } from './effect-notes-support.ts';
import type { NotesHarness } from './effect-notes-support.ts';

const GLOW = 'ADBE Glo2', BLUR = 'ADBE Blur';
const kept = (planId: string, name: string, extra: Partial<KeptEventInput> = {}): KeptEventInput => ({ planId, kind: 'effect', name, ...extra });
const seen = (name: string, key: string, kind: UsageKind = 'effect'): SeenEventInput => ({ kind, name, key });
const names = (harness: NotesHarness, kind: UsageKind = 'effect', limit = 10): string[] => harness.service.topUsage(kind, limit).map(entry => entry.name);

test('an effect is ranked by distinct plans that used it plus distinct layers carrying it, best first, with display names', t => {
  const harness = notesHarness(t), { service } = harness;
  service.recordKeptEvents([kept('p1', BLUR), kept('p2', BLUR), kept('p1', GLOW)]);
  service.recordSeenEvents([seen(GLOW, 'proj|comp|layer1'), seen(GLOW, 'proj|comp|layer2'), seen(GLOW, 'proj|comp|layer3')]);
  const ranking = service.topUsage('effect', 10), first = present(ranking[0]), second = present(ranking[1]);
  assert.deepEqual([first.name, first.kept, first.seen, first.used, first.displayName], [GLOW, 1, 3, 4, `Display ${GLOW}`]);
  assert.deepEqual([second.name, second.kept, second.seen, second.used], [BLUR, 2, 0, 2]);
  assert.equal(service.topUsage('effect', 1).length, 1, 'the limit is honoured');
  assert.deepEqual(names(harness, 'font'), [], 'another kind is ranked on its own');
});

test('a plan counts an effect once however many times it used it, and a re-read of the same layer never adds', t => {
  const harness = notesHarness(t), { service } = harness;
  service.recordKeptEvents([kept('p1', BLUR, { slot: 'a' }), kept('p1', BLUR, { slot: 'b' }), kept('p1', BLUR)]);
  service.recordKeptEvents(kept('p1', BLUR));
  for (let read = 0; read < 3; read += 1) service.recordSeenEvents(seen(BLUR, 'proj|comp|layer1'));
  const entry = present(service.topUsage('effect', 5)[0]);
  assert.deepEqual([entry.kept, entry.seen], [1, 1]);
});

test('undoing a plan takes its effects out of the ranking, and a late record for it is ignored', t => {
  const harness = notesHarness(t), { service } = harness;
  service.recordKeptEvents([kept('keep', GLOW), kept('undo', GLOW), kept('undo', BLUR)]);
  assert.equal(present(service.topUsage('effect', 5)[0]).kept, 2);
  assert.equal(succeeded(service.unrecordPlanUsage('undo')).removed, 2);
  assert.deepEqual(service.topUsage('effect', 5).map(entry => [entry.name, entry.kept]), [[GLOW, 1]]);
  assert.equal(succeeded(service.recordKeptEvents(kept('undo', BLUR))).skipped, 1);
  assert.deepEqual(names(harness), [GLOW]);
});

test('"Learn from my work" off records no events and offers no ranking; Forget clears the ranking too', t => {
  const harness = notesHarness(t), { service } = harness;
  service.recordKeptEvents(kept('p1', GLOW));
  service.setLearnFromWork(false);
  const skipped = succeeded(service.recordKeptEvents([kept('p2', BLUR)])), seenSkipped = succeeded(service.recordSeenEvents(seen(BLUR, 'k')));
  assert.deepEqual([skipped.recorded, skipped.skipped, seenSkipped.recorded, seenSkipped.skipped], [0, 1, 0, 1]);
  assert.deepEqual(service.topUsage('effect', 5), [], 'nothing is offered while learning is off');
  assert.equal(effectUsageCounts(service).size, 0); assert.equal(usageBriefingLine(service), '');
  assert.equal(present(readNotes(harness, GLOW).effectUsage).kept, 1, 'the user\'s own read still shows what is stored until Forget');
  service.setLearnFromWork(true);
  assert.deepEqual(names(harness), [GLOW], 'the off period recorded nothing');
  assert.equal(succeeded(service.forgetUsage()).removed, 1);
  assert.deepEqual(service.topUsage('effect', 5), []); assert.equal(readNotes(harness, GLOW).effectUsage, null);
});

test('the notes read carries the effect\'s rank among the user\'s effects, or null when it was never used', t => {
  const harness = notesHarness(t), { service } = harness;
  assert.equal(readNotes(harness, GLOW).effectUsage, null);
  service.recordKeptEvents([kept('p1', BLUR), kept('p2', BLUR), kept('p1', GLOW)]);
  assert.deepEqual(readNotes(harness, GLOW).effectUsage, { rank: 2, kept: 1, seen: 0, used: 1 });
  assert.equal(present(readNotes(harness, BLUR).effectUsage).rank, 1);
  assert.equal(readNotes(harness, GLOW).writeAuthorizing, false);
});

test('events are bounded per name, so a long habit cannot grow the file without limit', t => {
  const harness = notesHarness(t), { service } = harness;
  service.recordSeenEvents(Array.from({ length: USAGE_EVENTS_PER_NAME + 25 }, (_, index) => ({ kind: 'effect' as const, name: GLOW, key: `k${index}`, at: 100 + index })));
  assert.equal(present(service.topUsage('effect', 1)[0]).seen, USAGE_EVENTS_PER_NAME);
});

test('fonts and presets are ranked the same way and shown by a recognisable name', t => {
  const harness = notesHarness(t), { service } = harness;
  service.recordKeptEvents([{ planId: 'p1', kind: 'font', name: 'Inter-Bold' }, { planId: 'p2', kind: 'font', name: 'Inter-Bold' }, { planId: 'p1', kind: 'font', name: 'Georgia' }, { planId: 'p1', kind: 'preset', name: 'preset:ae-presets:Behaviors/Wiggle.ffx' }]);
  assert.deepEqual(names(harness, 'font'), ['Inter-Bold', 'Georgia']);
  assert.deepEqual(service.topUsage('preset', 5).map(entry => [entry.name, entry.displayName]), [['preset:ae-presets:Behaviors/Wiggle.ffx', 'Wiggle']]);
  assert.equal(succeeded(uncheckedRecorder(service).recordKeptEvents({ planId: 'p9', kind: 'plugin', name: 'x' })).invalid, 1, 'an unknown kind is refused, not stored');
});

test('the briefing line is one short labelled line of at most eight effects, omitted when there is nothing to say', t => {
  const harness = notesHarness(t, { names: Array.from({ length: 12 }, (_, index) => `ADBE Effect ${index}`) }), { service } = harness;
  assert.equal(usageBriefingLine(service), '', 'no usage, no line');
  service.recordKeptEvents(Array.from({ length: 12 }, (_, index) => kept(`p${index}`, `ADBE Effect ${index}`)));
  service.recordKeptEvents(Array.from({ length: 5 }, (_, index) => kept(`q${index}`, 'ADBE Effect 3')));
  const line = usageBriefingLine(service);
  assert.match(line, /^Your usage \(/); assert.doesNotMatch(line, /\n/); assert.ok(line.length < 700, `short: ${line.length}`);
  assert.match(line, /effects: Display ADBE Effect 3, /, 'most used first');
  assert.equal(present(line.match(/Display ADBE Effect \d+/g)).length, 8);
  assert.doesNotMatch(line, /fonts:|presets:/, 'empty lists are not mentioned');
  service.recordKeptEvents([{ planId: 'p0', kind: 'font', name: 'Inter-Bold' }]);
  assert.match(usageBriefingLine(service), /; fonts: Inter-Bold\.$/);
  service.setLearnFromWork(false);
  assert.equal(usageBriefingLine(service), '');
});
