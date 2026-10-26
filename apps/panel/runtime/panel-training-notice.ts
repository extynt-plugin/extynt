/**
 * What a provider does with the user's prompts. A service that may train on them shows its warning and a checkbox the
 * user must tick before the choice can be saved; one that does not shows a quiet line. Setup and model settings share it.
 */
import { el } from "./panel-dom.js";
import { t } from "./panel-language.js";

/** Whether a service keeps the user's prompts out of training; only a service the sidecar vouches for is "no-training". */
export type TrainingPolicy = "no-training" | "may-train";

/** The parts of a service the notice needs: its id, the policy the sidecar listed for it, and whether the user types its address. */
export interface TrainingSubject {
  readonly id: string;
  readonly trainingPolicy: TrainingPolicy;
  readonly addressEditable: boolean;
}

/**
 * The notice for one provider choice. `update` repaints it for the chosen service and address, `accepted` setting the
 * checkbox; `blocking` is true while the choice trains and the box is not ticked, so saving must wait; `acknowledgement`
 * is the value to send as `acknowledgeTrainingRisk`, or null when the choice does not train.
 */
export interface TrainingNotice {
  readonly node: HTMLElement;
  readonly update: (service: TrainingSubject, address: string, accepted: boolean) => void;
  readonly blocking: () => boolean;
  readonly acknowledgement: () => boolean | null;
}

type WarningKey = "model.training.google" | "model.training.deepseek" | "model.training.xai" | "model.training.unknown";

const WARNINGS: ReadonlyMap<string, WarningKey> = new Map<string, WarningKey>([
  ["google", "model.training.google"],
  ["deepseek", "model.training.deepseek"],
  ["xai", "model.training.xai"],
]);
const ADDRESS_HOST = /^[a-z][a-z0-9+.-]*:\/\/(\[[^\]]*\]|[^/:?#]*)/i;

function hostOf(address: string): string {
  const match = ADDRESS_HOST.exec(address.trim());
  return (match?.[1] ?? "").replace(/^\[|\]$/g, "").toLowerCase();
}

function isLoopbackAddress(address: string): boolean {
  const host = hostOf(address);
  return host === "127.0.0.1" || host === "::1" || host === "localhost" || host.endsWith(".localhost");
}

function effectiveTrainingPolicy(service: TrainingSubject, address: string): TrainingPolicy {
  if (service.trainingPolicy === "no-training" || !service.addressEditable) return service.trainingPolicy;
  return isLoopbackAddress(address) ? "no-training" : "may-train";
}

/** A notice that starts as the quiet line and follows every `update`. */
export function createTrainingNotice(): TrainingNotice {
  const node = el("div", "training-notice");
  const line = el("div", "hint");
  const row = el("label", "training-ack");
  const box = el("input");
  box.type = "checkbox";
  row.appendChild(box);
  row.appendChild(el("span", "", t("model.training.checkbox")));
  node.appendChild(line);
  node.appendChild(row);
  let policy: TrainingPolicy = "no-training";
  const update = (service: TrainingSubject, address: string, accepted: boolean): void => {
    policy = effectiveTrainingPolicy(service, address);
    const risky = policy === "may-train";
    line.textContent = risky ? t(WARNINGS.get(service.id) ?? "model.training.unknown") : t("model.training.none");
    line.className = risky ? "hint warn" : "hint";
    row.hidden = !risky;
    box.checked = risky && accepted;
  };
  return {
    node,
    update,
    blocking: () => policy === "may-train" && !box.checked,
    acknowledgement: () => (policy === "may-train" ? box.checked : null),
  };
}
