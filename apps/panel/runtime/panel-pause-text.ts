/** The words the panel shows on the pause card, in the language the panel speaks. */
import type { WindowCapPause } from "./panel-pause.js";
import { t } from "./panel-language.js";

/** The card's headline, such as "Paused after 3 steps". */
export function pauseHeadline(pause: WindowCapPause): string {
  return t("chat.pause.headline", { count: pause.steps });
}

/** Replaces the sidecar's "Reply 'continue' to keep going", which the button makes untrue; external clients still get that text. */
export function pauseExplanation(): string {
  return t("chat.pause.explanation");
}
