// State claims: whether a request asserts something about how the project is right now, which has to be read or measured before anything is changed to match it.
import { binary } from "./spec.js";
import type { BinarySpec } from "./spec.js";
import { foldRequest } from "./request-text.js";
import { STATE_CLAIMS_EDITS } from "./state-claim-edits.js";
import { STATE_CLAIMS_OTHER } from "./state-claim-words.js";

/** What the state-claim decision reads: the user's message in their words. */
export type ClaimText = { readonly message: string };

const AFTER_CLAUSE = "(?<!\\b(?:so|that|until|when|if|once|where|while|unless|because|than|whether|make|let|get|have|help|see|watch|want|need|should|will|would|can|could|to|please|like|as|how|though|sure|ensure|check|verify|before|after|since|whenever|maybe|hope)\\s)";
const NOUN = "[a-z-]+(?: (?!that\\b|which\\b|who\\b)[a-z-]+)?";
const SUBJECT = `(?:it|this|(?<![a-z] )that|they|these|those|the ${NOUN}|my ${NOUN})`;
const STATE_VERB = "(?:is|are|was|were|has|had|got|gets|not|no longer|still|never|looks|seems|feels|stays|keeps|starts|begins|ends|stops)";
const COPULA = `${AFTER_CLAUSE}\\b${SUBJECT}(?:'s| ${STATE_VERB}\\b)`;
const OWN_ACTION = "\\bi (?:undid|undone|deleted|removed|lost|broke|reverted|cleared|reset)\\b|\\bi (?:went|undid|pressed [a-z ]{0,12}) (?:back )?too far\\b";
const OTHER_ACTION = "\\byou (?:undid|deleted|removed|broke|changed|moved|reverted|lost|messed|missed|forgot|did not|never|already)\\b";
const REPLACES_CURRENT = "\\b(?:instead of|rather than|not) (?:the )?\\d";
const NOT_YET = "\\b(?:is|are|was|were|does|did) not (?:work|apply|show|stick|save|happen|a |an |the |smooth|even|round|straight|visible|there)";

const SYMPTOM = `${AFTER_CLAUSE}\\b${SUBJECT} (?:\\w+ )?(?:disappear(?:s|ed)|vanish(?:es|ed)|jump(?:s|ed)|flicker(?:s|ed)|stutter(?:s|ed)|lags?|lagged|overlap(?:s|ped)|clips?|clipped|cuts? off|drift(?:s|ed)|jitter(?:s|ed)|glitch(?:es|ed)|broke|froze|freezes|bleeds?|stretch(?:es|ed)|does not|did not|do not|will not|never|keeps|kept|turned out|came out|ended up)\\b`;
const NOTHING = "\\b(?:there(?: i|')s no|there are no|nothing (?:happens|happened|changed|moved|shows|showed|is happening|works)|no (?:effect|change|difference) (?:at all|happened)?)\\b";
const STILL = "\\b(?:it|this|they|them|that|these|those) still\\b|\\bis still\\b|\\bare still\\b|\\bstill (?:not|no|there|looks|shows|has|have|does|doesn)\\b";
const TOO_ADJ = `${AFTER_CLAUSE}(?<!\\bnot )\\btoo (?:slow|fast|dark|bright|big|small|large|long|short|wide|narrow|thin|thick|late|early|loud|quiet|blurry|soft|sharp|close|far|high|low|much|little)\\b`;

const CLAIMS: ReadonlyArray<RegExp> = [...[OWN_ACTION, OTHER_ACTION, REPLACES_CURRENT, NOT_YET, COPULA, SYMPTOM, NOTHING, STILL, TOO_ADJ].map((source) => new RegExp(source, "u")), ...STATE_CLAIMS_OTHER, ...STATE_CLAIMS_EDITS];

/** Whether the message states a fact about the current project, such as where something starts, what was undone, what shape a path has or that something clips, rather than only asking for a change. */
export function assertsCurrentState(message: string): boolean {
  const text = foldRequest(message).toLowerCase();
  return CLAIMS.some((claim) => claim.test(text));
}

/** Whether the request asserts something about the current state ("it starts at 1 second", "I undid too far", "it's not a circle") that the agent must verify before acting on it, in any wording. */
export const ASSERTS_CURRENT_STATE: BinarySpec<ClaimText> = binary<ClaimText>({
  name: "asserts-current-state",
  instructions: "A motion designer's message to an After Effects copilot may say how the project is right now: where something starts, what was undone or changed, what shape or speed a motion has, that something clips, drifts or is missing. Decide whether the message asserts such a fact about the current project, as a complaint or as the reason for a requested change, rather than only asking for a change or a question.",
  criteria: {
    true: "The message claims something is, was or does something in the project at present (for example that it starts late, is not smooth, was undone, or is clipping), whether or not the claim is true.",
    false: "The message only asks for something new to be made, changed or answered, and states nothing about the project's present state.",
  },
  useModel: true,
  deterministic: (state) => assertsCurrentState(state.message),
});
