// The learned-alias store: a phrase is found again whatever its case, accents or plural, an alias from another After Effects version is a miss, the store is bounded and least-recently-used first out, and it survives a restart.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LearnedAliases, MAX_ALIASES, aliasPhrase, type AliasKey } from "../src/learned-aliases.js";

const directory = (): string => mkdtempSync(join(tmpdir(), "extynt-aliases-"));
const on = (): boolean => true;
const key = (phrase: string, catalogue = "26.2.1.2"): AliasKey => ({ kind: "effect", catalogue, scope: "", phrase });

test("a phrase is found again whatever its case, accents, spacing or plural", () => {
  const aliases = new LearnedAliases(directory(), on);
  aliases.learn(key("Soften the edges"), "ADBE Gaussian Blur 2");
  assert.equal(aliases.lookup(key("  soften   THE edge ")), "ADBE Gaussian Blur 2");
  assert.equal(aliasPhrase("Café Glows"), aliasPhrase("cafe glow"));
  assert.equal(aliases.lookup(key("harden the edges")), undefined);
});

test("an alias is about one kind, one effect and one After Effects version", () => {
  const aliases = new LearnedAliases(directory(), on);
  aliases.learn(key("soften"), "ADBE Gaussian Blur 2");
  assert.equal(aliases.lookup(key("soften", "26.3.0.1")), undefined, "another version is a stale miss");
  assert.equal(aliases.lookup({ ...key("soften"), kind: "font" }), undefined);
  assert.equal(aliases.lookup({ ...key("soften"), scope: "ADBE Glo2" }), undefined);
});

test("a newer answer replaces the older one for the same phrase", () => {
  const aliases = new LearnedAliases(directory(), on);
  aliases.learn(key("glow"), "one");
  aliases.learn(key("glow"), "two");
  assert.equal(aliases.lookup(key("glow")), "two");
  assert.equal(aliases.size(), 1);
});

test("the store is bounded and drops the least recently used alias first", () => {
  const aliases = new LearnedAliases(directory(), on);
  for (let index = 0; index < MAX_ALIASES; index += 1) aliases.learn(key(`phrase ${index}`), `answer ${index}`);
  assert.equal(aliases.lookup(key("phrase 0")), "answer 0", "reading the oldest marks it recently used");
  aliases.learn(key("one more"), "answer");
  assert.equal(aliases.size(), MAX_ALIASES);
  assert.equal(aliases.lookup(key("phrase 1")), undefined, "the least recently used went");
  assert.equal(aliases.lookup(key("phrase 0")), "answer 0");
});

test("aliases survive a restart, in a versioned file only the owner can read", () => {
  const folder = directory();
  new LearnedAliases(folder, on).learn(key("soften"), "ADBE Gaussian Blur 2");
  assert.equal(new LearnedAliases(folder, on).lookup(key("soften")), "ADBE Gaussian Blur 2");
  assert.match(readFileSync(join(folder, "learned-aliases.json"), "utf8"), /^\{"version":1,/u);
});

test("a file of another version or a damaged file starts the store empty, and clearing empties the disk too", () => {
  const folder = directory();
  const path = join(folder, "learned-aliases.json");
  writeFileSync(path, JSON.stringify({ version: 2, aliases: [{ ...key("soften"), answer: "x" }] }));
  assert.equal(new LearnedAliases(folder, on).size(), 0);
  writeFileSync(path, "{ not json");
  assert.equal(new LearnedAliases(folder, on).size(), 0);
  const aliases = new LearnedAliases(folder, on);
  aliases.learn(key("soften"), "x");
  aliases.clear();
  assert.equal(new LearnedAliases(folder, on).size(), 0);
});

test("with learning switched off nothing is recorded, and what was learned before is still found", () => {
  const folder = directory();
  let learning = true;
  const aliases = new LearnedAliases(folder, () => learning);
  aliases.learn(key("soften"), "ADBE Gaussian Blur 2");
  learning = false;
  aliases.learn(key("harden"), "ADBE Glo2");
  assert.equal(aliases.lookup(key("soften")), "ADBE Gaussian Blur 2");
  assert.equal(aliases.lookup(key("harden")), undefined);
  assert.equal(new LearnedAliases(folder, on).size(), 1);
});
