// The frame picture on the sidecar: it reaches only a decision model or chat model that accepts images, the log says whether it went, and the log never holds its bytes.
import test from "node:test";
import assert from "node:assert/strict";
import { ENDED_IN_PROSE, FRAME_QUALITY, type DecisionImage } from "@extynt/decide";
import { compileCaptureCommand } from "@extynt/host-ae";
import { MockProvider, type JsonCompletionRequest, type JsonSchemaSpec } from "@extynt/llm";
import { withChatModel } from "../src/decision-language.js";
import { adviseFrameQuality, imageOfDataUrl, latestFrameImage } from "../src/decision-frame.js";
import { DecisionService } from "../src/decision-service.js";
import type { DecisionLogRow } from "../src/decision-log.js";
import type { CaptureRecord } from "../src/server-types.js";
import { picked, scriptedModel, serviceOver, yesNo } from "./decision-fakes.js";

const IMAGE: DecisionImage = { mediaType: "image/png", base64: "QUJDRA==" };

const SITE = { moment: "frame-gate", jobId: "job-1", image: IMAGE } as const;

const ROWS = [{ compositionId: "c1", layerId: "l1", layer: "Title", verdict: "IN_FRAME" as const }];

const FRAME = { request: "a title", width: 1920, height: 1080 };

const sees = (question: { readonly kind: string }) => (question.kind === "score" ? { kind: "score" as const, expected: 3, confidence: 0.95, probabilities: [0, 0, 0.05, 0.95] } : yesNo(true));

class Chat extends MockProvider {
  public readonly requests: JsonCompletionRequest[] = [];
  public constructor(acceptsImages: boolean | undefined) { super(acceptsImages === undefined ? {} : { acceptsImages }); }
  public async completeJson(request: JsonCompletionRequest, _schema: JsonSchemaSpec): Promise<string> {
    this.requests.push(request);
    return JSON.stringify({ answers: { "frame-quality": { probabilities: [0, 0.02, 0.03, 0.95] } } });
  }
}

function serialised(rows: ReadonlyArray<DecisionLogRow>): string {
  return JSON.stringify(rows);
}

test("a decision model that accepts images is sent the frame, and the log row says so without the bytes", async () => {
  const vision = scriptedModel(sees, undefined, true);
  const { service, rows } = serviceOver([vision.model]);
  await adviseFrameQuality(service, { jobId: "job-1", frame: FRAME, rows: ROWS, image: IMAGE });
  assert.deepEqual(vision.calls[0]?.image, IMAGE);
  assert.equal(rows[0]?.image, true);
  assert.equal(serialised(rows).includes(IMAGE.base64), false);
});

test("a decision model that does not accept images, as Jev does not, is never asked about the frame", async () => {
  const text = scriptedModel(sees);
  const { service, rows } = serviceOver([text.model]);
  await adviseFrameQuality(service, { jobId: "job-1", frame: FRAME, rows: ROWS, image: IMAGE });
  assert.equal(text.calls.length, 0);
  assert.equal(rows[0]?.image, false);
  assert.equal(rows[0]?.tier, "deterministic");
});

test("a question that does not want an image is sent none even when the site holds one", async () => {
  const vision = scriptedModel((question) => (question.kind === "binary" ? yesNo(false) : picked("resume")), undefined, true);
  const { service, rows } = serviceOver([vision.model]);
  await service.decideAll({ answer: "Done.", sealed: false, failed: false, askedUser: false, refused: false }, { ended: ENDED_IN_PROSE }, SITE);
  assert.equal(vision.calls[0]?.image, undefined);
  assert.equal(rows[0]?.image, false);
});

function chatService(provider: Chat): { readonly service: DecisionService; readonly rows: DecisionLogRow[] } {
  const rows: DecisionLogRow[] = [];
  const models = withChatModel(() => [], () => provider, {});
  return { service: new DecisionService({ models, log: { record: (batch) => { rows.push(...batch); } }, now: () => new Date(0) }), rows };
}

test("a chat model the user declared to accept images is sent the frame through the structured-output image path", async () => {
  const provider = new Chat(true);
  const { service, rows } = chatService(provider);
  await service.decideAll({ ...FRAME, layers: [] }, { "frame-quality": { ...FRAME_QUALITY, useModel: true as const } }, SITE);
  assert.deepEqual(provider.requests[0]?.image, IMAGE);
  assert.equal(rows[0]?.image, true);
});

test("a chat model that declared no images, or that nothing has reported on, is not asked about the frame", async () => {
  for (const declared of [false, undefined]) {
    const provider = new Chat(declared);
    const { service, rows } = chatService(provider);
    await service.decideAll({ ...FRAME, layers: [] }, { "frame-quality": { ...FRAME_QUALITY, useModel: true as const } }, SITE);
    assert.equal(provider.requests.length, 0);
    assert.equal(rows[0]?.image, false);
    assert.equal(rows[0]?.fallback, "image-unavailable");
  }
});

function commandFor(compositionId: string, captureId: string): CaptureRecord["request"] {
  const command = compileCaptureCommand({ compositionId, time: 0, width: 60, height: 60, format: "png", shareWithProvider: false }, captureId);
  if (!("operation" in command)) throw new Error(command.message);
  return command;
}

function capture(id: string, compositionId: string, dataUrl: string | undefined): CaptureRecord {
  const request = commandFor(compositionId, id);
  return { captureId: id, status: "completed", request, preview: { maxWidth: 1, maxHeight: 1 }, maxEncodedBytes: 1, receipt: { captureId: id, status: "completed", compositionId, ...(dataUrl === undefined ? {} : { dataUrl }) } };
}

test("the newest completed capture of the composition is the picture, skipping one that holds no image", () => {
  const captures = new Map([
    ["a", capture("a", "c1", "data:image/png;base64,QUJDRA==")],
    ["b", capture("b", "c2", "data:image/png;base64,WFla")],
    ["c", capture("c", "c1", undefined)],
  ]);
  assert.deepEqual(latestFrameImage(captures, "c1"), IMAGE);
  assert.equal(latestFrameImage(captures, "c3"), undefined);
  assert.equal(imageOfDataUrl("not a data url"), undefined);
});
