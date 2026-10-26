// A language-model call that failed in a way the decision receipt can name.
import type { FailureReason } from "./port.js";

/** Thrown by a language-model port to say why it could not answer; any other error counts as the model being unavailable. */
export class LanguageModelFailure extends Error {
  readonly reason: FailureReason;

  constructor(reason: FailureReason, detail: string) {
    super(detail);
    this.name = "LanguageModelFailure";
    this.reason = reason;
  }
}
