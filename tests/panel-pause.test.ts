/** Tests the panel's pause card: when it is read, worded and enabled. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeOrThrow } from '../packages/decode/dist/src/index.js';
import { CONTINUE_MESSAGE, pauseControl, pauseKey, pauseOrNull, watchPause as watchDecoded } from '../apps/panel/dist/runtime/panel-pause.js';
import { pauseExplanation, pauseHeadline } from '../apps/panel/dist/runtime/panel-pause-text.js';
import type { PauseWatch, WindowCapPause } from '../apps/panel/dist/runtime/panel-pause.js';
import { transcriptDecoder } from '../apps/panel/dist/runtime/transcript.js';
import type { TranscriptRow } from '../apps/panel/dist/runtime/transcript.js';
import type { JsonObject, JsonValue } from '../packages/decode/dist/src/index.js';

type WireInput = JsonValue | undefined;
type RowKind = 'user' | 'assistant' | 'plan' | 'notice';

interface WatchContext {
  readonly busy: boolean;
  readonly shown: readonly TranscriptRow[];
}

interface WatchStep {
  readonly watch: PauseWatch;
  readonly announce: WindowCapPause | null;
}

const readPause = (value: WireInput): WindowCapPause | null => decodeOrThrow(pauseOrNull, value);
const watchPause = (watch: PauseWatch, reported: WireInput, context: WatchContext): WatchStep => watchDecoded(watch, readPause(reported), context);

const PAUSE: JsonObject = { kind: 'window-cap', steps: 8, jobId: 'job-A' };
const ROW_FIELDS: Readonly<Record<RowKind, JsonObject>> = {
  user: { kind: 'user', text: '' },
  assistant: { kind: 'assistant', text: '' },
  plan: { kind: 'plan', text: '', planId: 'plan-1', rows: [], operations: [], notices: [], warnings: [], expressions: [], requiresAcknowledgement: false },
  notice: { kind: 'notice', text: '', action: null, tone: '' },
};

function rowOf(kind: RowKind, extra: JsonObject = {}): TranscriptRow {
  const [row] = decodeOrThrow(transcriptDecoder, [{ ...ROW_FIELDS[kind], ...extra }]);
  if (row === undefined) throw new Error(`the ${kind} row was not read`);
  return row;
}

function pausedOf(extra: JsonObject = {}): WindowCapPause {
  const pause = readPause({ ...PAUSE, ...extra });
  if (pause === null) throw new Error('the pause was not read');
  return pause;
}

test('only a well-formed window-cap pause is read; the headline counts steps in plain words', () => {
  assert.deepEqual(readPause(PAUSE), PAUSE);
  assert.deepEqual(readPause({ ...PAUSE, extra: 'ignored' }), PAUSE);
  const unreadable: readonly WireInput[] = [null, undefined, 'x', 5, [], {}, { ...PAUSE, kind: 'other' }, { ...PAUSE, steps: 0 }, { ...PAUSE, steps: 1.5 }, { ...PAUSE, steps: '8' }, { ...PAUSE, steps: Infinity }, { ...PAUSE, jobId: '' }, { ...PAUSE, jobId: '../x' }, { ...PAUSE, jobId: 7 }, { ...PAUSE, jobId: 'a'.repeat(129) }];
  for (const bad of unreadable) assert.equal(readPause(bad), null, JSON.stringify(bad));
  assert.equal(pauseHeadline(pausedOf()), 'Paused after 8 steps');
  assert.equal(pauseHeadline(pausedOf({ steps: 1 })), 'Paused after 1 step');
  assert.equal(CONTINUE_MESSAGE, 'continue', 'the exact word the sidecar recognises');
  assert.ok(!/continue/i.test(pauseExplanation()), 'the card no longer tells the reader to type anything');
});

test('a button is ready only on the last card with nothing newer from the user, and waits while a turn runs', () => {
  const card = rowOf('assistant');
  const rows = [rowOf('user'), card];
  assert.equal(pauseControl(rows, card, false), 'ready');
  assert.equal(pauseControl(rows, card, true), 'busy');
  assert.equal(pauseControl([...rows, rowOf('plan'), rowOf('notice'), rowOf('assistant')], card, false), 'ready', 'cards, notices and answers after it are not the user saying something');
  assert.equal(pauseControl([...rows, rowOf('user')], card, false), 'stale');
  assert.equal(pauseControl([...rows, rowOf('user')], card, true), 'stale', 'stale wins over busy');
  assert.equal(pauseControl([rowOf('user')], card, false), 'stale', 'a card that is not in the transcript is history');
});

test('the poll announces a pause that appears after the first look, once, and never one that was already there', () => {
  const idle: WatchContext = { busy: false, shown: [] };
  let watch: PauseWatch = { polled: false, seen: null };
  let step = watchPause(watch, PAUSE, idle);
  assert.equal(step.announce, null, 'the first poll only records what was paused when the panel opened');
  watch = step.watch;
  step = watchPause(watch, PAUSE, idle);
  assert.equal(step.announce, null);

  watch = { polled: false, seen: null };
  watch = watchPause(watch, null, idle).watch;
  step = watchPause(watch, PAUSE, idle);
  assert.deepEqual(step.announce, PAUSE);
  assert.equal(watchPause(step.watch, PAUSE, idle).announce, null, 'the same pause is not announced twice');
  const again = { ...PAUSE, steps: 12 };
  assert.deepEqual(watchPause(step.watch, again, idle).announce, again, 'a job that is continued and stops again is a new pause');
  assert.equal(watchPause(watchPause(step.watch, null, idle).watch, PAUSE, idle).announce?.steps, 8, 'cleared and paused again at the same count announces again');
});

test('the poll waits while a turn runs and does not repeat a pause a card already shows', () => {
  const watch: PauseWatch = { polled: true, seen: null };
  const busy = watchPause(watch, PAUSE, { busy: true, shown: [] });
  assert.equal(busy.announce, null);
  assert.deepEqual(busy.watch, watch, 'waiting does not use up the pause');
  const shown = watchPause(watch, PAUSE, { busy: false, shown: [rowOf('assistant', { pause: PAUSE })] });
  assert.equal(shown.announce, null, 'the chat reply already drew it');
  assert.equal(shown.watch.seen, pauseKey(pausedOf()));
  assert.equal(watchPause(watch, { kind: 'window-cap', steps: 8, jobId: '../x' }, { busy: false, shown: [] }).announce, null, 'an unreadable report announces nothing');
});
