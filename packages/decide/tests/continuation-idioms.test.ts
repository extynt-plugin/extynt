// Pins the continuation reading of short go-ahead idioms in English, German, Spanish, French and Japanese, next to the no-change and amend cases they must not swallow.
import assert from "node:assert/strict";
import test from "node:test";
import { CONTINUATION } from "../src/index.js";

function reading(message: string): string {
  return CONTINUATION.deterministic({ message });
}

test("German go-ahead idioms resume the stopped job", () => {
  assert.equal(reading("weiter so"), "resume");
  assert.equal(reading("Mach weiter so!"), "resume");
  assert.equal(reading("mach weiter"), "resume");
  assert.equal(reading("Weiter so, super"), "resume");
  assert.equal(reading("Gut gemacht, weiter so"), "resume");
  assert.equal(reading("bitte weiter"), "resume");
});

test("Spanish, French and Japanese go-ahead idioms resume the stopped job", () => {
  assert.equal(reading("sigue así"), "resume");
  assert.equal(reading("sigue asi, perfecto"), "resume");
  assert.equal(reading("continue comme ça"), "resume");
  assert.equal(reading("vas-y"), "resume");
  assert.equal(reading("その調子で続けて"), "resume");
  assert.equal(reading("続けてください"), "resume");
});

test("a go-ahead with other words amends, and a plain instruction starts something new", () => {
  assert.equal(reading("weiter so, mach den Titel rot"), "amend-and-resume");
  assert.equal(reading("sigue así, pon el título rojo"), "amend-and-resume");
  assert.equal(reading("continue with the title"), "amend-and-resume");
  assert.equal(reading("make it red"), "new-request");
});

test("a no-change clause still resumes whatever else it says", () => {
  assert.equal(reading("Nothing else, just keep going"), "resume");
  assert.equal(reading("何もしないで続けて"), "resume");
});
