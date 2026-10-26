/** Stop: the one stop. It always asks the sidecar, naming the job when the panel knows it, and ends the panel's own request too. */
import { stopReplyDecoder } from "./chat-reply.js";
import { setComposerBusy } from "./panel-composer.js";
import { clearEndedJob, followJob, followedJob, runningJob, setLiveProgress, setStopNote } from "./panel-progress.js";
import { refreshPlans } from "./panel-plans.js";
import { t } from "./panel-language.js";
import { getCurrentSessionId, setTurnSessionId } from "./panel-sessions.js";
import { diagnosticId, send, transportContext, type Reply } from "./panel-transport.js";
import { abortActiveTurn, activeTurn, isChatInFlight } from "./panel-turn.js";
import type { Infer } from "@extynt/decode";

type StopReply = Infer<typeof stopReplyDecoder>;
type StopWords = { readonly text: string; readonly settled: boolean };

/** What the thread says when a stop took effect. */
export function stoppedText(): string {
  return t("chat.stop.stopped");
}

function notAnswered(): StopWords {
  return { text: t("chat.stop.noAnswer"), settled: false };
}

function stopWords(reply: Reply<StopReply>): StopWords {
  if (!reply.ok) {
    const why = reply.error.local ? reply.error.message : reply.error.reason;
    return { text: t("chat.stop.failed", { reason: why }), settled: false };
  }
  const { outcome, message } = reply.value;
  if (outcome === "stopped") return { text: stoppedText(), settled: true };
  if (outcome === "already-finished" || outcome === "nothing-running") return { text: message || t("chat.stop.nothingRunning"), settled: true };
  return notAnswered();
}

function onStopped(reply: Reply<StopReply>): void {
  const words = stopWords(reply);
  setStopNote({ phase: words.settled ? "stopped" : "failed", text: words.text });
  if (!words.settled) return;
  clearEndedJob(getCurrentSessionId());
  if (!activeTurn() && isChatInFlight()) {
    followJob(null);
    setTurnSessionId(null);
    setLiveProgress(null);
    setComposerBusy(false);
    refreshPlans();
  }
}

/** Asks the sidecar to stop the running job, or whatever runs, and ends the panel's own request. */
export function stopChat(): void {
  const job = runningJob() ?? followedJob();
  setStopNote({ phase: "stopping", text: t("chat.stop.stopping") });
  const path = job ? "/v1/ui/jobs/" + encodeURIComponent(job.jobId) + "/stop" : "/v1/ui/stop";
  const context = transportContext("POST", job ? "/v1/ui/jobs/stop" : path, diagnosticId("stop"));
  send({ method: "POST", path, body: {}, context, decoder: stopReplyDecoder }, onStopped);
  abortActiveTurn();
}
