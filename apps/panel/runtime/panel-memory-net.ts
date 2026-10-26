/**
 * The Memory section's calls to the sidecar's /v1/notes routes (paired panel only), answered as one outcome:
 * the decoded `ok: true` body, or a failure the caller turns into a sentence with panel-memory.ts.
 */
import type { Decoder } from "@extynt/decode";
import { outcomeOf, type Outcome } from "./panel-memory.js";
import { diagnosticId, send, transportContext } from "./panel-transport.js";
import { type JsonValue } from "@extynt/decode";

interface NotesCall<T> {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly body: JsonValue | null;
  readonly decoder: Decoder<T>;
}

/** Sends one notes request and hands the caller the outcome; a refused change is an answer from a working sidecar. */
export function callNotes<T>(call: NotesCall<T>, done: (outcome: Outcome<T>) => void): void {
  const route = call.path.split("?")[0] ?? call.path;
  const context = transportContext(call.method, route, diagnosticId("memory"));
  send({ method: call.method, path: call.path, body: call.body, context, decoder: call.decoder }, (reply) => {
    done(outcomeOf(reply));
  });
}
