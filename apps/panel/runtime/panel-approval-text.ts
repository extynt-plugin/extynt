/** The words the panel sends and shows for the design-approval card, in the language the panel speaks. */
import { t } from "./panel-language.js";

/** Exactly what the reader would type to approve the brief, in the language the panel speaks. */
export function approveMessage(): string {
  return t("chat.approval.approveMessage");
}
