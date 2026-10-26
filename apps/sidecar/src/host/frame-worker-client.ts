// Runs frame jobs (frame-job.ts) on one worker thread, started on first use and ended after a quiet spell. A worker that
// dies fails the jobs it held with CAPTURE_WORKER_FAILED and is replaced by the next job; it never takes the sidecar down.
import { Worker } from "node:worker_threads";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FrameJob, FrameResult } from "./frame-job.js";

const IDLE_TTL_MS = 10_000;

interface Pending { resolve(result: FrameResult): void }
interface Live { worker: Worker; pending: Map<number, Pending>; idle: NodeJS.Timeout | undefined; nextId: number }

let live: Live | undefined;

function workerFailure(reason: string): FrameResult {
  return { ok: false, code: "CAPTURE_WORKER_FAILED", message: `The frame worker stopped (${reason}).` };
}

function retire(current: Live, reason: string): void {
  if (live === current) live = undefined;
  clearTimeout(current.idle);
  for (const entry of current.pending.values()) entry.resolve(workerFailure(reason));
  current.pending.clear();
}

function settled(current: Live): void {
  if (current.pending.size > 0) return;
  current.worker.unref();
  current.idle = setTimeout(() => { retire(current, "idle"); void current.worker.terminate(); }, IDLE_TTL_MS);
  current.idle.unref();
}

function launch(): Live {
  const worker = new Worker(join(fileURLToPath(new URL(".", import.meta.url)), "frame-worker.js"));
  const current: Live = { worker, pending: new Map(), idle: undefined, nextId: 1 };
  worker.on("message", (message: { id: number; result: FrameResult }) => {
    const entry = current.pending.get(message.id);
    current.pending.delete(message.id);
    entry?.resolve(message.result);
    settled(current);
  });
  worker.on("error", (error: Error) => retire(current, error.message));
  worker.on("exit", () => retire(current, "exited"));
  return current;
}

/** The job's result, computed off the event loop. */
export function processFrame(job: FrameJob): Promise<FrameResult> {
  const current = live ?? (live = launch());
  clearTimeout(current.idle);
  current.worker.ref();
  const id = current.nextId++;
  return new Promise((resolve) => {
    current.pending.set(id, { resolve });
    current.worker.postMessage({ id, job });
  });
}
