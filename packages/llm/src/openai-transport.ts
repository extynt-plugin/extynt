/** The HTTP edge of the OpenAI-compatible adapters: one JSON post, the failure it becomes, and the abort and stall guard around one step. */
import { bearerHeader } from "./provider-secret.js";
import { linkAbortSignal, startStallGuard, type StallGuard } from "./provider-stall.js";
import { refusalDetail } from "./model-capabilities.js";
import { ProviderHttpError } from "./provider-http-error.js";
import type { AgentStepInput } from "./types.js";

export interface Transport {
  request: typeof globalThis.fetch;
  endpoint: string;
  apiKey: string;
}

export const MAX_TOKENS_MESSAGE = "The compatible API stopped at its max_tokens limit (finish_reason \"length\") before the answer finished.";

/** Posts a JSON body to a path under the endpoint, with the bearer header only when there is a key. */
export function postJson<Body>(transport: Transport, path: string, body: Body, signal: AbortSignal): Promise<Response> {
  return transport.request(`${transport.endpoint}${path}`, { method: "POST", headers: { ...bearerHeader(transport.apiKey), "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
}

/** The provider's own reason, bounded, so a refusal says why and not only its status; the body is kept for reading what the model does not take. */
export function compatibleHttpFailure(status: number, body: string): ProviderHttpError {
  const bounded = refusalDetail(body).message.replace(/\s+/g, " ").trim().slice(0, 300);
  return new ProviderHttpError(status, `The compatible API returned HTTP ${status}${bounded ? `: ${bounded}` : "."}`, body.slice(0, 4_000));
}

/** The failure for a response that is not ok. */
export async function responseFailure(response: Response): Promise<ProviderHttpError> {
  return compatibleHttpFailure(response.status, await response.text().catch(() => ""));
}

/** Runs one step under a stall guard that the caller's own signal also aborts; a stall surfaces as the stall error rather than the abort it caused. */
export async function guardedStep<T>(input: AgentStepInput, run: (signal: AbortSignal, guard: StallGuard) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const guard = startStallGuard(controller, input.stallTimeoutMs);
  const releaseAbort = linkAbortSignal(input.signal, controller);
  try {
    return await run(controller.signal, guard);
  } catch (error) {
    throw guard.fired ?? error;
  } finally {
    guard.stop();
    releaseAbort();
  }
}
