/** Tests the native-spike option parsing and its defaults. */
import assert from "node:assert/strict";
import test from "node:test";
import { parseCli } from "../lib/args.ts";

test("the bench and compare options default to off and ten seconds", () => {
  const { command, options } = parseCli([]);
  assert.equal(command, "bench");
  assert.equal(options.commandGiven, false);
  assert.deepEqual([options.cpuSample, options.cpuSeconds, options.debugFlags], [false, 10, false]);
});

test("the options are parsed", () => {
  const { command, options } = parseCli(["bench", "--cpu-sample", "--cpu-seconds", "4"]);
  assert.equal(command, "bench");
  assert.equal(options.commandGiven, true);
  assert.deepEqual([options.cpuSample, options.cpuSeconds], [true, 4]);
  assert.equal(parseCli(["compare", "--debug-flags"]).options.debugFlags, true);
});

test("bad values are USAGE errors", () => {
  for (const argv of [["--cpu-seconds", "0"], ["--cpu-seconds", "abc"], ["--cpu-seconds", "3001"], ["--cpu-seconds", "1.5"]]) {
    assert.throws(() => parseCli(argv), { code: "USAGE" }, argv.join(" "));
  }
});

test("the removed dispatch experiments are no longer options", () => {
  for (const argv of [["--dispatch-matrix"], ["--hot-window-ms", "5"]]) assert.throws(() => parseCli(argv), { code: "USAGE" }, argv.join(" "));
});
