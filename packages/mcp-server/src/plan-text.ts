// The English translator plan text falls back to when its caller gave none: the model and the stored plan always read English, and only the panel's copy is said in the user's language.
import { translatorFor, type Translate } from "@extynt/ui-text";

/** The English translator: the default wherever plan text is composed without a translator of its own. */
export const ENGLISH_TEXT: Translate = translatorFor("en");
