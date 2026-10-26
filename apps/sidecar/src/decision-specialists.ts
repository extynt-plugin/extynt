// The specialists decision read at the seams that start a specialist: a role the models confidently left out of the request is withheld; the execution role and every unbooked request keep the deterministic rules.
import { REQUEST_SPECIALISTS, type SpecialistRole } from "@extynt/decide";
import { bookedBand, bookedYesNo } from "./decision-book.js";

const ACT_BAND = "act";

/** Whether the specialists decision, taken in the act band for this goal, left the role out; execution is never withheld, and a goal with no booked answer withholds nothing. */
export function specialistWithheld(goal: string | undefined, role: SpecialistRole): boolean {
  if (goal === undefined || role === "execution") return false;
  const entry = { decision: REQUEST_SPECIALISTS.name, text: goal };
  return bookedBand(entry) === ACT_BAND && bookedYesNo({ ...entry, item: role }) === false;
}
