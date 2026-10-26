// The shape of the sidecar's one JSON answer.
import type { ServerResponse } from "node:http";

import type { DiagnosticOutcome } from "./diagnostics.js";
import type { RequestContext } from "./server-types.js";
import type { Opaque } from "./snapshot-view.js";

/** One JSON answer: the response to write, the request it answers, its status and body, and how it ended. */
export interface RespondInput {
  response: ServerResponse;
  context: RequestContext;
  statusCode: number;
  value: Opaque;
  outcome: DiagnosticOutcome;
  errorCode?: string;
  bytes?: number;
}
