/** The composer: its Send/Steer state, its height, and filling it with words that are not sent. */
import { chatButton, chatMessage } from "./panel-dom.js";
import { t } from "./panel-language.js";
import { setChatInFlight } from "./panel-turn.js";
import { turnIsElsewhere, turnSessionName } from "./panel-sessions.js";
import { touchStatus } from "./panel-status-signal.js";
import { turnRunning } from "./panel-suggest-hooks.js";

const MIN_HEIGHT = 34;
const MAX_HEIGHT = 140;

let composerBusy = false;

function hintFor(busy: boolean): string {
  if (!busy) return t("chat.composer.hintIdle");
  if (turnIsElsewhere()) return t("chat.composer.hintElsewhere", { session: turnSessionName() });
  return t("chat.composer.hintRunning");
}

/** Paints the composer's words for its Send or Steer state, in the language the panel speaks now. */
export function paintComposer(): void {
  chatButton.disabled = false;
  chatButton.textContent = composerBusy ? t("chat.composer.steer") : t("chat.composer.send");
  chatButton.className = "primary";
  chatMessage.placeholder = composerBusy ? t("chat.composer.placeholderSteer") : t("chat.composer.placeholder");
  chatMessage.title = hintFor(composerBusy);
}

/** Switches the composer between Send and Steer, and tells the rest of the panel whether a turn runs. */
export function setComposerBusy(busy: boolean): void {
  setChatInFlight(busy);
  composerBusy = busy;
  paintComposer();
  touchStatus();
  turnRunning(busy);
}

/** Grows the composer with its text, up to half the panel's height. */
export function autosizeComposer(): void {
  const ceiling = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(window.innerHeight / 2)));
  chatMessage.style.height = "auto";
  chatMessage.style.height = Math.min(ceiling, Math.max(MIN_HEIGHT, chatMessage.scrollHeight || MIN_HEIGHT)) + "px";
}

/** Puts words in the composer and focuses it; nothing is sent. */
export function fillComposer(text: string): void {
  chatMessage.value = text;
  autosizeComposer();
  chatMessage.focus();
}
