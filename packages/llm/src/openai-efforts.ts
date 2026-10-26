/** Effort discovery for endpoints that do not list the levels a model takes: one tiny tool-capable request per level, on the route the agent uses. */
import { compatibleHttpFailure, postJson, type Transport } from "./openai-transport.js";
import { REASONING_EFFORTS, type ReasoningEffort } from "./provider-config.js";
import { withTimeout } from "./provider-runtime.js";

interface EffortProbe<Body> {
  transport: Transport;
  path: string;
  refusal: RegExp;
  body: (level: ReasoningEffort) => Body;
}

const PROBE_TIMEOUT_MS = 12_000;

/** The levels the endpoint accepts, weakest first. The probes run one after another so an endpoint is never asked for every level at once; a failure that is not a refusal of the effort fails the whole discovery. */
export async function acceptedEfforts<Body>(probe: EffortProbe<Body>): Promise<ReasoningEffort[]> {
  const accepted: ReasoningEffort[] = [];
  for (const level of REASONING_EFFORTS) {
    if (await acceptsLevel(probe, level)) accepted.push(level);
  }
  return accepted;
}

function acceptsLevel<Body>(probe: EffortProbe<Body>, level: ReasoningEffort): Promise<boolean> {
  return withTimeout(PROBE_TIMEOUT_MS, async (signal) => {
    const response = await postJson(probe.transport, probe.path, probe.body(level), signal);
    if (response.ok) {
      await response.text();
      return true;
    }
    const detail = await response.text().catch(() => "");
    if ((response.status === 400 || response.status === 422) && probe.refusal.test(detail)) return false;
    throw compatibleHttpFailure(response.status, detail);
  });
}
