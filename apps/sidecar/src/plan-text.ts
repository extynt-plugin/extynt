// The English translator the sidecar's plan text falls back to when its caller gave none, so code that composes panel text can take an optional translator and keep today's wording.
import { translatorFor, type Translate } from "@extynt/ui-text";

/** The English translator: the default for every composer of panel text that is handed no translator of its own. */
export const ENGLISH_TEXT: Translate = translatorFor("en");
