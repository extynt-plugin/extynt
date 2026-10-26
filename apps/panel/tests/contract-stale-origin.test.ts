/** Panel contract: a sidecar that restarts on a new port leaves the page on a dead origin, so repeated silence reloads it. */
import assert from "node:assert/strict";
import test from "node:test";
import { barButton } from "./contract-helpers.js";
import { createClock, createPanelHarness, type PanelHarness, type StubResponse } from "./contract.test.js";

function scripted(): { harness: PanelHarness; script: (silent: number, refused?: number) => void } {
  let silent = 0,
    refused = 0;
  const respond = (record: { url: string }): StubResponse | undefined => {
    if (record.url.endsWith("/v1/ui/events")) return undefined;
    if (silent > 0) {
      silent -= 1;
      return { fail: true };
    }
    if (refused > 0) {
      refused -= 1;
      return { status: 500, text: "{}" };
    }
    return undefined;
  };
  return {
    harness: createPanelHarness({ respond }),
    script: (count, refusals = 0) => {
      silent = count;
      refused = refusals;
    },
  };
}

function showTryAgain(harness: PanelHarness): void {
  harness.dropStream();
  harness.advance(11000);
  harness.runTimeouts((timer) => timer.ms === 3000);
}

function pressTryAgain(harness: PanelHarness): void {
  barButton(harness, "retry")?.click();
}

test("three requests in a row with no answer reload the page once; two are a blip", () => {
  const { harness, script } = scripted();
  script(2);
  harness.send("one");
  assert.equal(harness.reloads(), 0, "two failures are a blip");
  script(30);
  harness.send("two");
  assert.equal(harness.reloads(), 1, "a long streak still reloads once");
});

test("an answer between failures starts the count again", () => {
  const { harness, script } = scripted();
  script(2);
  harness.send("one");
  script(0);
  harness.send("two");
  script(2);
  harness.send("three");
  assert.equal(harness.reloads(), 0);
});

test("an HTTP refusal is an answer, not silence, however many arrive", () => {
  const { harness, script } = scripted();
  script(0, 20);
  harness.send("one");
  harness.send("two");
  assert.equal(harness.reloads(), 0);
});

test("a stream that cannot connect counts toward the same streak", () => {
  const { harness, script } = scripted();
  harness.dropStream();
  assert.equal(harness.reloads(), 0);
  script(2);
  harness.send("one");
  assert.equal(harness.reloads(), 1, "one dropped stream and two silent requests");
});

test("Try again reloads when the bootstrap gets no answer, so a new port is picked up", () => {
  const { harness, script } = scripted();
  showTryAgain(harness);
  const before = harness.reloads();
  script(1);
  pressTryAgain(harness);
  assert.equal(harness.reloads(), before + 1);
});

test("Try again does not reload when the sidecar answers, even with a refusal", () => {
  const { harness, script } = scripted();
  showTryAgain(harness);
  const before = harness.reloads();
  script(0, 1);
  pressTryAgain(harness);
  assert.equal(harness.reloads(), before);
});

function burnWallTime(until: number): void {
  while (Date.now() < until) {
    Math.sqrt(until);
  }
}

test("the harness clock is virtual: wall time never moves it, only advance() does", () => {
  const clock = createClock();
  const first = clock.FakeDate.now();
  const spin = Date.now() + 25;
  burnWallTime(spin);
  assert.equal(clock.FakeDate.now(), first);
  assert.equal(new clock.FakeDate().getTime(), first);
  clock.advance(3000);
  assert.equal(clock.FakeDate.now(), first + 3000);
  assert.equal(clock.now(), first + 3000);
});
