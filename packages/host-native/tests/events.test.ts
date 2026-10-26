// Tests that the line splitter turns arbitrary socket chunks into whole lines.
import assert from "node:assert/strict";
import test from "node:test";
import { createLineSplitter } from "../src/index.js";

function collect(maxBytes?: number): { feed: (chunk: Buffer) => void; lines: string[]; overflows: number[] } {
  const lines: string[] = [];
  const overflows: number[] = [];
  const feed = createLineSplitter({ onLine: (line) => lines.push(line), onTooLong: () => overflows.push(1), ...(maxBytes === undefined ? {} : { maxBytes }) });
  return { feed, lines, overflows };
}

test("a chunk holding several lines emits each of them", () => {
  const { feed, lines } = collect();
  feed(Buffer.from('{"a":1}\n{"b":2}\n{"c":3}\n'));
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}', '{"c":3}']);
});

test("a line split over many chunks is emitted once, when its newline arrives", () => {
  const { feed, lines } = collect();
  feed(Buffer.from('{"a":'));
  feed(Buffer.from("1"));
  assert.deepEqual(lines, []);
  feed(Buffer.from("}\n{"));
  assert.deepEqual(lines, ['{"a":1}']);
  feed(Buffer.from('"b":2}\n'));
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
});

test("a multi-byte character split between chunks is decoded whole", () => {
  const { feed, lines } = collect();
  const bytes = Buffer.from('{"name":"héllo €"}\n');
  const cut = bytes.indexOf(0xc3) + 1;
  feed(bytes.subarray(0, cut));
  feed(bytes.subarray(cut, bytes.length - 3));
  feed(bytes.subarray(bytes.length - 3));
  assert.deepEqual(lines, ['{"name":"héllo €"}']);
});

test("blank lines and bare carriage returns are dropped, and a trailing partial line stays buffered", () => {
  const { feed, lines } = collect();
  feed(Buffer.from('\n\r\n{"a":1}\n\n{"b"'));
  assert.deepEqual(lines, ['{"a":1}']);
});

test("a line that grows past the limit without a newline reports once and resets", () => {
  const { feed, lines, overflows } = collect(10);
  feed(Buffer.from("12345678"));
  feed(Buffer.from("90abc"));
  assert.equal(overflows.length, 1);
  feed(Buffer.from("ok\n"));
  assert.deepEqual(lines, ["ok"]);
});

test("a long line within the limit is not reported", () => {
  const { feed, lines, overflows } = collect(100);
  feed(Buffer.from("x".repeat(60)));
  feed(Buffer.from(`${"y".repeat(30)}\n`));
  assert.equal(overflows.length, 0);
  assert.equal(lines[0]?.length, 90);
});
