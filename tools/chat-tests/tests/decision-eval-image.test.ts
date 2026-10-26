// Decision-eval fixture images: a case can name a capture file, and the picture reaches only the models that accept images.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FRAME_QUALITY } from "@extynt/decide";
import type { DecisionImage, DecisionModel } from "@extynt/decide";
import { specCase } from "../src/decision-eval-cases.js";
import { loadFixtureImage } from "../src/decision-fixtures.js";

const PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const STATE = { request: "Add the title", width: 1920, height: 1080, layers: [{ name: "TITLE", text: true, box: null }] };

function withFrame<T>(run: (directory: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), "extynt-frame-"));
  try {
    writeFileSync(join(directory, "pixel.png"), Buffer.from(PIXEL_PNG, "base64"));
    return run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function listening(acceptsImages: boolean): { readonly model: DecisionModel; readonly seen: Array<DecisionImage | undefined> } {
  const seen: Array<DecisionImage | undefined> = [];
  const model: DecisionModel = {
    id: "fake", tier: "decision-model", supports: new Set(["score"]), calibrated: true, threshold: 0.5, acceptsImages,
    decide: async (_state, questions, _signal, image) => {
      seen.push(image);
      return { ok: true, answers: new Map(questions.map((question) => [question.id, { kind: "score" as const, expected: 3, confidence: 0.9, probabilities: [0, 0, 0.1, 0.9] }])), usage: { model: null, inputTokens: null } };
    },
  };
  return { model, seen };
}

test("a fixture image loads with its media type and bytes, and a file that is not an image is refused", () => {
  withFrame((directory) => {
    assert.deepEqual(loadFixtureImage("pixel.png", directory), { mediaType: "image/png", base64: PIXEL_PNG });
    assert.throws(() => loadFixtureImage("pixel.txt", directory), /png or jpeg/u);
  });
});

test("a case with an image puts it to a model that accepts images and to no other", async () => {
  const image = withFrame((directory) => loadFixtureImage("pixel.png", directory));
  const vision = listening(true);
  const text = listening(false);
  const frame = specCase({ id: "title", tags: { lang: "en", hard: false }, spec: FRAME_QUALITY, state: STATE, expected: 3, image });
  await frame.ask({ models: [vision.model], decisionTimeoutMs: 1000 }, false);
  await frame.ask({ models: [text.model], decisionTimeoutMs: 1000 }, false);
  assert.deepEqual(vision.seen, [image]);
  assert.deepEqual(text.seen, []);
});

test("a case without an image is not asked of a model for a question that needs one", async () => {
  const vision = listening(true);
  const frame = specCase({ id: "title", tags: { lang: "en", hard: false }, spec: FRAME_QUALITY, state: STATE, expected: 3 });
  await frame.ask({ models: [vision.model], decisionTimeoutMs: 1000 }, false);
  assert.deepEqual(vision.seen, []);
});
