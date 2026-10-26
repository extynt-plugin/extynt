// The routes that keep the chat history: saving a transcript, appending to the automatic chat log and exporting the whole log.
import { bodyRoute, ok, refuse, type MountedRoute, type RouteReply } from "./server-route-table.js";
import { jsonBody, uniformBody } from "./server-route-body.js";
import { chatTranscript, saveTranscript, type SavedTranscript } from "./server-chat-export.js";
import { chatLogBatch } from "./server-chat-log-batch.js";
import { exportChatLogs, chatLogExportBody } from "./server-chat-log-export.js";
import { appendChatLog, type AppendedChatLog } from "./server-chat-log-files.js";
import { failed, type FailureBody } from "./server-failed-reply.js";

interface SavedReply extends SavedTranscript {
  readonly ok: true;
}

interface AppendedReply extends AppendedChatLog {
  readonly ok: true;
  readonly sessionId: string;
}

interface ExportedReply {
  readonly ok: true;
  readonly path: string;
  readonly sessions: number;
  readonly bytes: number;
}

const MAX_TRANSCRIPT_BYTES = 2_000_000;
const MAX_BATCH_BYTES = 2_000_000;
const MAX_EXPORT_REQUEST_BYTES = 16_384;

const saveTranscriptRoute = bodyRoute({
  method: "POST",
  path: "/v1/chats",
  body: jsonBody(chatTranscript, MAX_TRANSCRIPT_BYTES, { status: 422, code: "INVALID_CHAT_EXPORT", message: "A chat export needs a sessionId and jsonl whose every line is a JSON object." }, {
    tooLarge: { status: 413, code: "BODY_LIMIT", message: "Chat export exceeded the limit." },
    notJson: { status: 400, code: "INVALID_JSON", message: "A chat export must be valid JSON." },
  }),
  handle: ({ deps, body }): RouteReply<SavedReply | FailureBody> => {
    try {
      const saved = saveTranscript(deps.state, body);
      return ok({ ok: true, ...saved });
    } catch (error) {
      return failed(500, "CHAT_EXPORT_FAILED", `The transcript could not be written: ${error instanceof Error ? error.message : "unknown error"}.`);
    }
  },
});

const appendRoute = bodyRoute({
  method: "POST",
  path: "/v1/chat-logs",
  body: uniformBody(chatLogBatch, MAX_BATCH_BYTES, { status: 422, code: "INVALID_CHAT_LOG", message: "The automatic chat log batch was invalid." }),
  handle: ({ deps, body }): RouteReply<AppendedReply | FailureBody> => {
    try {
      const { accepted, projectAccepted, path } = appendChatLog(deps.state, body);
      return ok({ ok: true, sessionId: body.sessionId, accepted, projectAccepted, path });
    } catch (error) {
      return failed(500, "CHAT_LOG_FAILED", `The automatic chat log could not be appended: ${error instanceof Error ? error.message : "unknown error"}.`);
    }
  },
});

const exportRoute = bodyRoute({
  method: "POST",
  path: "/v1/chat-logs/export",
  body: uniformBody(chatLogExportBody, MAX_EXPORT_REQUEST_BYTES, { status: 422, code: "INVALID_CHAT_EXPORT_PATH", message: "Choose an absolute .jsonl destination outside extynt's automatic chat-log directory." }),
  handle: ({ deps, body }): RouteReply<ExportedReply | FailureBody> => {
    try {
      const exported = exportChatLogs(deps.state, body.destination);
      if (exported.kind === "refused") return refuse(422, "INVALID_CHAT_EXPORT_PATH", exported.message);
      const { path, sessions, bytes } = exported;
      return ok({ ok: true, path, sessions, bytes });
    } catch (error) {
      return failed(500, "CHAT_EXPORT_FAILED", `The full chat log could not be exported: ${error instanceof Error ? error.message : "unknown error"}.`);
    }
  },
});

/** Chat transcripts, the automatic chat log and its export. */
export const chatLogRoutes: readonly MountedRoute[] = [saveTranscriptRoute, appendRoute, exportRoute];
