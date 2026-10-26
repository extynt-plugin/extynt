/** Plays the host for tests built on `queueHarness`: claims what the sidecar queues, answers the thumbnail captures that come first, and hands back the apply or undo item. */
import { RINGS_FRAME } from "./single-loop-rig.js";
import { pause, type QueueHarness } from "./sidecar-fixture.js";
import { recordOf, type JsonObject } from "./http-json.js";

const CLAIM_ATTEMPTS = 300;

async function answerCapture(harness: QueueHarness, item: JsonObject): Promise<void> {
  const command = recordOf(item, "command");
  await harness.post("/v1/captures", { captureId: command.captureId, ok: true, providerShared: false, dataUrl: "data:image/png;base64,aGVsbG8=", originalWidth: 1920, originalHeight: 1080, previewWidth: 1280, previewHeight: 720, resized: true, summary: RINGS_FRAME });
}

/** The next apply (`kind` absent or apply_plan) or undo item; frame captures claimed on the way are answered. */
export async function claimWork(harness: QueueHarness, kind: "apply_plan" | "undo_plan" = "apply_plan"): Promise<JsonObject> {
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1) {
    const { item } = await harness.claim();
    if (!item) { await pause(10); continue; }
    if (item.kind === "capture_frame") { await answerCapture(harness, item); continue; }
    if ((item.kind ?? "apply_plan") === kind) return item;
  }
  throw new Error(`no ${kind} item was ever offered to the host`);
}

/** The host starting an apply it claimed. */
export async function beginApply(harness: QueueHarness, planId: string, operations = 1): Promise<void> {
  await harness.post("/v1/pipeline", { event: "apply-begin", detail: `${planId} ${operations} operations` });
}
