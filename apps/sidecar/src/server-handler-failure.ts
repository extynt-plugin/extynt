// What the caller and the log are told when a route throws.
import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";

import type { DiagnosticRoute } from "./diagnostics.js";
import type { HttpRoutesDeps } from "./server-http-state.js";
import { translatorOf } from "./ui-language.js";
import { diagnosticMethod, diagnosticRoute, errorEnvelope, headerId, writeJson } from "./server-http-wire.js";

function routeOf(request: IncomingMessage): DiagnosticRoute {
  try {
    return diagnosticRoute(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
  } catch {
    return "/unknown";
  }
}

/** A thrown handler is reported to the caller and the log, never silently swallowed; a response already begun is ended. */
export function reportHandlerFailure(deps: HttpRoutesDeps, failure: { readonly request: IncomingMessage; readonly response: ServerResponse; readonly message: string }): void {
  const { request, response, message } = failure;
  const route = routeOf(request);
  deps.state.diagnostics.emit({ level: "error", event: "request.completed", phase: "response", correlationId: headerId(request.headers["x-ae-correlation-id"]) ?? "unknown", requestId: headerId(request.headers["x-ae-request-id"]), method: diagnosticMethod(request.method), route, outcome: "failed", statusCode: response.headersSent ? response.statusCode : 500, errorCode: "INTERNAL_ERROR" });
  process.stderr.write(`${JSON.stringify({ at: deps.state.now().toISOString(), event: "request.failed", route, error: message })}\n`);
  if (response.headersSent) {
    if (!response.writableEnded) response.end();
    return;
  }
  writeJson(response, 500, errorEnvelope("INTERNAL_ERROR", translatorOf(deps.state)("failure.handler.failed")));
}
