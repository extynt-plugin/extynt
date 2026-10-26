/** Panel contract: the suggester's state machine on its own, with fake timers, and the decoder of the sidecar's answer. */
import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as nodeSetTimeout } from "node:timers";
import { RETRY_AT_MOST_MS, SETTLE_MS, answerDecoder, createSuggester, type SuggestDeps } from "../runtime/panel-suggest.js";
import { decode, type JsonValue } from "@extynt/decode";

const WORDS = ["mock chip one", "mock chip two", "mock chip three"];

type Handle = NodeJS.Timeout;
type Answer = Parameters<Parameters<SuggestDeps["ask"]>[1]>[0];
interface FakeTimer {
  readonly run: () => void;
  readonly ms: number;
  readonly handle: Handle;
  live: boolean;
}

function inertHandle(): Handle {
  const handle = nodeSetTimeout(() => undefined, 0);
  clearTimeout(handle);
  return handle;
}

function timerDeps(timers: FakeTimer[]): Pick<SuggestDeps, "later" | "cancel"> {
  return {
    later: (run, ms) => {
      const timer = { run, ms, handle: inertHandle(), live: true };
      timers.push(timer);
      return timer.handle;
    },
    cancel: (handle) => {
      for (const timer of timers.filter((entry) => entry.handle === handle)) timer.live = false;
    },
  };
}

function fakeDeps(over: Partial<SuggestDeps> = {}) {
  const log: string[] = [];
  const timers: FakeTimer[] = [];
  let reply: ((answer: Answer) => void) | undefined;
  const deps: SuggestDeps = {
    enabled: () => true,
    visible: () => true,
    busy: () => false,
    composerEmpty: () => true,
    guardOk: () => true,
    ask: (fingerprint, done) => {
      log.push(`ask ${fingerprint}`);
      reply = done;
    },
    show: (suggestions) => {
      log.push(`show ${suggestions.join("|")}`);
    },
    hide: () => {
      log.push("hide");
    },
    ...timerDeps(timers),
    ...over,
  };
  return {
    suggester: createSuggester(deps),
    log,
    fire: (ms: number): void => {
      for (const timer of timers.filter((entry) => entry.live && entry.ms === ms)) {
        timer.live = false;
        timer.run();
      }
    },
    answer: (answer: Answer): void => reply?.(answer),
  };
}

test("the state machine alone: the guard, and a draft typed after the ask, each stop the chips", () => {
  const blocked = fakeDeps({ guardOk: () => false });
  blocked.suggester.selection("fp", 1);
  blocked.fire(SETTLE_MS);
  assert.deepEqual(
    blocked.log.filter((line) => line.startsWith("ask")),
    [],
    "a tripped or warned guard asks nothing",
  );
  let empty = true;
  const typed = fakeDeps({ composerEmpty: () => empty });
  typed.suggester.selection("fp", 2);
  typed.fire(SETTLE_MS);
  empty = false;
  typed.answer({ suggestions: WORDS, retryAfterMs: null });
  assert.ok(!typed.log.some((line) => line.startsWith("show")), "typed while the answer was on its way");
});

function readSuggestions(body: JsonValue): { suggestions: ReadonlyArray<string>; retryAfterMs: number | null } {
  const outcome = decode(answerDecoder, body);
  return outcome.ok ? outcome.value : { suggestions: [], retryAfterMs: null };
}

test("the suggestions decoder keeps two or three one-line strings and ignores everything else", () => {
  assert.deepEqual(readSuggestions({ ok: true, suggestions: WORDS }).suggestions, WORDS);
  assert.deepEqual(readSuggestions({ ok: true, suggestions: ["a b c", "a b c", "d e f", "g h i", "j k l"] }).suggestions, [
    "a b c",
    "d e f",
    "g h i",
  ]);
  const malformed: JsonValue[] = [
    null,
    "x",
    { ok: false, suggestions: WORDS },
    { ok: true },
    { ok: true, suggestions: ["only one"] },
    { ok: true, suggestions: ["a b c", "multi\nline"] },
    { ok: true, suggestions: ["a b c", 5, "x".repeat(60)] },
  ];
  for (const bad of malformed) assert.deepEqual(readSuggestions(bad).suggestions, [], JSON.stringify(bad));
  assert.equal(readSuggestions({ ok: true, suggestions: [], retryAfterMs: 2500 }).retryAfterMs, 2500);
  assert.equal(
    readSuggestions({ ok: true, suggestions: [], retryAfterMs: RETRY_AT_MOST_MS + 1 }).retryAfterMs,
    null,
    "a long wait is not worth holding for",
  );
});
