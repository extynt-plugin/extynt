// The frame-quality decision: a confident model's low score leaves a note for the completion, a full score, no model or a failure leaves none; one request, never a refusal.
import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { clearBook } from "../src/decision-book.js";
import { adviseFrameQuality, frameAdvice } from "../src/decision-frame.js";
import type { FrameCheckRow } from "../src/verify/frame-check.js";
import { scriptedModel, serviceOver } from "./decision-fakes.js";

const PICTURE = { mediaType: "image/png", base64: "AAAA" };

beforeEach(() => clearBook());

const ROWS: FrameCheckRow[] = [{ compositionId: "c", layerId: "l", layer: "Title", verdict: "IN_FRAME" }];
const bare = (jobId: string) => ({ jobId, frame: { request: "A title card", width: 1920, height: 1080 }, rows: ROWS });
const input = (jobId: string) => ({ ...bare(jobId), image: PICTURE });
const scoring = (level: number, images?: true) => scriptedModel(() => ({ kind: "score", expected: level, confidence: 0.95, probabilities: [0, 1, 2, 3].map((index) => (index === level ? 0.95 : 0.05 / 3)) }), undefined, images);

test("a model that finds a layer cut by the frame edge leaves one note, after one request", async () => {
  const jev = scoring(2, true);
  await adviseFrameQuality(serviceOver([jev.model]).service, input("job-a"));
  assert.equal(jev.calls.length, 1);
  assert.match(frameAdvice("job-a") ?? "", /cut by the frame edge/);
});

test("a full score, no model, no rows or a failing model leaves no note", async () => {
  await adviseFrameQuality(serviceOver([scoring(3, true).model]).service, input("job-b"));
  await adviseFrameQuality(serviceOver([]).service, input("job-c"));
  await adviseFrameQuality(serviceOver([scoring(0, true).model]).service, { ...input("job-d"), rows: [] });
  await adviseFrameQuality(serviceOver([scriptedModel(() => ({ kind: "score", expected: 0, confidence: 0.9, probabilities: [1, 0, 0, 0] }), "timeout", true).model]).service, input("job-e"));
  for (const id of ["job-b", "job-c", "job-d", "job-e"]) assert.equal(frameAdvice(id), undefined, id);
});

test("a text-only model is never asked about a frame; the offline score stands and the log says why", async () => {
  const jev = scoring(0);
  const { service, rows } = serviceOver([jev.model]);
  await adviseFrameQuality(service, input("job-f"));
  assert.equal(jev.calls.length, 0);
  assert.equal(frameAdvice("job-f"), undefined);
  assert.equal(rows[0]?.tier, "deterministic");
  assert.equal(rows[0]?.fallback, "image-unavailable");
  assert.equal(rows[0]?.image, false);
});

test("a model that takes images is asked with the frame attached", async () => {
  const seeing = scoring(1, true);
  const { service, rows } = serviceOver([seeing.model]);
  await adviseFrameQuality(service, input("job-g"));
  assert.deepEqual(seeing.calls[0]?.image, PICTURE);
  assert.equal(rows[0]?.image, true);
  assert.match(frameAdvice("job-g") ?? "", /beyond the frame/);
});

test("an image model with no frame to show is not asked either", async () => {
  const seeing = scoring(0, true);
  const { service, rows } = serviceOver([seeing.model]);
  await adviseFrameQuality(service, bare("job-h"));
  assert.equal(seeing.calls.length, 0);
  assert.equal(frameAdvice("job-h"), undefined);
  assert.equal(rows[0]?.fallback, "image-unavailable");
});

test("a text-only decision model and a chat model that sees images: the chat model reads the frame", async () => {
  const jev = scoring(0);
  const chat = scoring(1, true);
  const { service, rows } = serviceOver([jev.model, chat.model]);
  await adviseFrameQuality(service, input("job-i"));
  assert.equal(jev.calls.length, 0);
  assert.deepEqual(chat.calls[0]?.image, PICTURE);
  assert.equal(rows[0]?.image, true);
});
