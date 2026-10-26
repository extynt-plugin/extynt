// A quoted name keeps a space on each side: the r02 reply from the live Windows run came back with the spaces gone.
import assert from "node:assert/strict";
import test from "node:test";
import { spacedQuotes } from "../src/agent-answer-spacing.js";

const BROKEN = 'The open comp is"R01 Title"(comp 141) at 1920×1080, and it holds one layer: the text layer"Introducing", centred with a per-letter "Pop In" text animator. A separate empty"R01 Title"comp (10 seconds) also exists.';
const FIXED = 'The open comp is "R01 Title" (comp 141) at 1920×1080, and it holds one layer: the text layer "Introducing", centred with a per-letter "Pop In" text animator. A separate empty "R01 Title" comp (10 seconds) also exists.';

test("a quoted name regains the spaces around it", () => {
  assert.equal(spacedQuotes(BROKEN), FIXED);
});

test("well-spaced text, odd quote counts and code spans are left alone", () => {
  assert.equal(spacedQuotes(FIXED), FIXED);
  assert.equal(spacedQuotes('He said "hi" and 5" wide'), 'He said "hi" and 5" wide');
  assert.equal(spacedQuotes('Use `a"b"c` here'), 'Use `a"b"c` here');
  assert.equal(spacedQuotes('Named "Intro", then "Outro".'), 'Named "Intro", then "Outro".');
});
