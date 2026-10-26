// Checks the request structure counts: paragraphs, list markers, counted parts in digits, number words and kanji, and timings.
import assert from "node:assert/strict";
import test from "node:test";
import { countedPartCount, listMarkerCount, paragraphCount, timingCount } from "../src/request-structure.js";

test("paragraphs count only blocks with words of their own", () => {
  assert.equal(paragraphCount("Intro block with words.\n\nSecond block with words.\n\nx"), 2);
  assert.equal(paragraphCount("One line only, with several words in it."), 1);
});

test("list markers count numbered, bulleted and circled items", () => {
  assert.equal(listMarkerCount("1. intro\n2. product\n3. close"), 3);
  assert.equal(listMarkerCount("- intro\n- product\n- close"), 3);
  assert.equal(listMarkerCount("① intro ② product"), 2);
});

test("counted parts read digits, English and German number words, and kanji with tsu", () => {
  assert.equal(countedPartCount("Make 4 sections for the reel."), 4);
  assert.equal(countedPartCount("Build five sections, each with a title."), 5);
  assert.equal(countedPartCount("Drei Szenen mit Titeln."), 3);
  assert.equal(countedPartCount("三つのシーンを作ってください"), 3);
});

test("a number that is not before a part noun is not a part count", () => {
  assert.equal(countedPartCount("Animate the title over 3 seconds."), 0);
});

test("timings count durations and timecodes, not plain numbers", () => {
  assert.equal(timingCount("Fade over 2.5 seconds, hold for 3 s, then cut at 00:10."), 3);
  assert.equal(timingCount("Set the opacity to 40 percent."), 0);
});
