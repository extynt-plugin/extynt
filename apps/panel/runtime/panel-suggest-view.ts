/**
 * The suggestion chips in the empty chat: two or three small buttons, each the model's own short prompt for the layers
 * selected right now. They live only in the empty chat, never above the composer. A press puts the words in the composer
 * and focuses it; it never sends. When the chips are to go (the selection changed, a turn started, the user typed) they are
 * dropped and the empty chat shows its plain prompts again. What to ask and when comes from panel-suggest.ts.
 *
 * Settings > Approvals has the switch ("Suggest prompts for the selection", on unless turned off). Off, the panel never
 * asks, so no layer name leaves it.
 */
import { chatMessage } from "./panel-dom.js";
import { hooks } from "./panel-hooks.js";
import { getChatTranscript } from "./panel-sessions.js";
import { answerDecoder, createSuggester, type Answer } from "./panel-suggest.js";
import { onSelectionRead, onTurnRunning } from "./panel-suggest-hooks.js";
import { checkRateLimits } from "./panel-usage.js";
import { subscribeUi, uiState } from "./ui-state.js";
import { diagnosticId, later, pollContext, send } from "./panel-transport.js";

interface SuggestWiring {
  readonly isChatInFlight: () => boolean;
}

const ASK_TIMEOUT_MS = 30000;
let offered: ReadonlyArray<string> = [];

function suggestEnabled(): boolean {
  return uiState().prefs.suggestPrompts;
}

/** The model's prompts for the selection now, for the empty chat to show; none when there are none to offer. */
export function offeredSuggestions(): ReadonlyArray<string> {
  return offered;
}

function repaint(): void {
  if (getChatTranscript().length === 0) hooks.renderTranscript();
}

function show(suggestions: ReadonlyArray<string>): void {
  offered = suggestions;
  repaint();
}

function hide(): void {
  if (offered.length === 0) return;
  offered = [];
  repaint();
}

function ask(fingerprint: string, done: (answer: Answer | null) => void): void {
  if (!uiState().native) {
    done(null);
    return;
  }
  const path = "/v1/suggestions";
  const context = pollContext("POST", path, diagnosticId("suggest"));
  context.timeoutMs = ASK_TIMEOUT_MS;
  send({ method: "POST", path, body: { selectionFingerprint: fingerprint }, context, decoder: answerDecoder }, (reply) => done(reply.ok ? reply.value : null));
}

function guardQuiet(): boolean {
  const verdict = checkRateLimits();
  return !verdict.blocked && !verdict.warned;
}

function panelVisible(): boolean {
  return typeof document === "undefined" || document.hidden !== true;
}

function cancelLater(handle: ReturnType<typeof setTimeout>): void {
  if (typeof clearTimeout === "function") clearTimeout(handle);
}

/** Wires the chips. Nothing is asked until a snapshot names a selection that then holds still. */
export function wireSuggestions(wiring: SuggestWiring): void {
  const suggester = createSuggester({
    enabled: suggestEnabled,
    visible: panelVisible,
    busy: () => wiring.isChatInFlight() || getChatTranscript().length > 0,
    composerEmpty: () => chatMessage.value.trim() === "",
    guardOk: guardQuiet,
    ask,
    show,
    hide,
    later,
    cancel: cancelLater,
  });
  onSelectionRead((fingerprint, selected) => suggester.selection(fingerprint, selected));
  onTurnRunning((running) => suggester.turn(running));
  chatMessage.addEventListener("input", () => suggester.typed());
  subscribeUi((topic) => {
    if (topic === "prefs") suggester.setting();
  });
}
