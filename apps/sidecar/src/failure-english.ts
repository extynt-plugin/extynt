// The English translator that failure text falls back on where no translator was handed down, so a caller that never learned about languages gets today's wording.
import { translatorFor, type Translate } from "@extynt/ui-text";

/** The translator for English, used when a failure is composed without the user's language. */
export const ENGLISH_FAILURE_TEXT: Translate = translatorFor("en");
