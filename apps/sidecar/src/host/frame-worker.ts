// The worker thread's entry: one job in, one result out (frame-worker-client.ts is the other end).
import { parentPort } from "node:worker_threads";
import { runFrameJob, type FrameJob } from "./frame-job.js";

if (!parentPort) throw new Error("frame-worker.js runs only as a worker thread.");
const port = parentPort;
port.on("message", (message: { id: number; job: FrameJob }) => {
  port.postMessage({ id: message.id, result: runFrameJob(message.job) });
});
