/** A fake native plugin client for the native-spike tests. */
import type { JsonObject } from "@extynt/decode";
import { ZERO_TIMING, errorResponse, okResponse } from "./fake-server.ts";
import type { FakeHandler } from "./fake-server.ts";
import { makeResult } from "./fixtures.ts";

/** A stand-in for the native plugin that answers `revision` and `read_project` like the real one; everything else is empty. */
export function createFakeNative(): { readonly handler: FakeHandler } {
  const timingFor = (op: string): JsonObject => ({ ...ZERO_TIMING, queuedMs: 1, dispatchedBy: op === "ping_direct" ? "socket" : "idle" });
  const handler: FakeHandler = (request) => {
    if (request.op === "revision") {
      return okResponse(request, { source: "native", revision: 7, revisionUs: 130, floorUs: 30, revisionRaw: "7" }, timingFor("revision"));
    }
    if (request.op === "read_project") return okResponse(request, makeResult(), timingFor("read_project"));
    if (request.op === "configure") return errorResponse(request, "UNKNOWN_OP", "unknown op: configure");
    return okResponse(request, {}, timingFor(request.op));
  };
  return { handler };
}
