// Which model services may train on prompts, and the refusal that stops content leaving for one the user has not accepted.
import { supportsTools, type ChatProvider } from "@extynt/llm";
import { ENGLISH_FAILURE_TEXT } from "./failure-english.js";

/** Whether a service keeps prompts out of model training. A service we cannot confirm is "may-train" until the user accepts it. */
export type TrainingPolicy = "no-training" | "may-train";

/** Loopback only: a key sent in plain http is readable by anything on the network path, and a loopback server is the user's own machine. */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "127.0.0.1" || host === "::1" || host === "localhost" || host.endsWith(".localhost");
}

/** The policy a slot really has: a user-typed address on this machine is local, whatever the service's default. */
export function effectiveTrainingPolicy(service: { trainingPolicy: TrainingPolicy; addressEditable?: boolean }, baseUrl: string): TrainingPolicy {
  if (service.trainingPolicy === "no-training" || service.addressEditable !== true) return service.trainingPolicy;
  try { return isLoopbackHost(new URL(baseUrl).hostname) ? "no-training" : "may-train"; } catch { return "may-train"; }
}

/** The error code of a refusal to send content to a service that may train on it. */
export const TRAINING_RISK_CODE = "TRAINING_RISK_UNCONFIRMED";

/** Thrown before any request leaves for a may-train slot the user has not accepted. */
export class TrainingRiskRefusal extends Error {
  public readonly code = TRAINING_RISK_CODE;
  public readonly label: string;
  public constructor(label: string) {
    super(ENGLISH_FAILURE_TEXT("failure.trainingRisk", { label }));
    this.label = label;
    this.name = "TrainingRiskRefusal";
  }
}

/** The refusal for a slot that would send content to a may-train provider without acceptance; undefined when the slot may be used. */
export function trainingRefusal(slot: { service: { label: string }; trainingPolicy: TrainingPolicy; trainingRiskAcknowledged: boolean } | undefined): TrainingRiskRefusal | undefined {
  return slot && slot.trainingPolicy === "may-train" && !slot.trainingRiskAcknowledged ? new TrainingRiskRefusal(slot.service.label) : undefined;
}

/** Content-carrying calls refuse; the model list and capability probes carry no project content and stay allowed. */
export function guardProvider(provider: ChatProvider, refusal: TrainingRiskRefusal): ChatProvider {
  const refuse = (): Promise<never> => Promise.reject(refusal);
  const guarded: ChatProvider = { id: provider.id, model: provider.model, config: provider.config, displayMetadata: provider.displayMetadata, complete: refuse };
  Object.setPrototypeOf(guarded, provider);
  if (supportsTools(provider)) Object.defineProperty(guarded, "step", { value: refuse, enumerable: true });
  return guarded;
}
