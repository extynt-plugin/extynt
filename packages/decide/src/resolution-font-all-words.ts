// Every concept row that maps request words to the style tags of a typeface.
import type { ConceptRow } from "./resolution-concepts.js";
import { LOOK_TAG_WORDS } from "./resolution-font-words.js";
import { GENRE_LOOK_WORDS } from "./resolution-font-words-genres.js";
import { MORE_LOOK_WORDS } from "./resolution-font-words-more.js";
import { STYLE_LOOK_WORDS } from "./resolution-font-words-style.js";

/** The look rows of all the font word tables, in one list. */
export const ALL_LOOK_WORDS: ReadonlyArray<ConceptRow> = [...LOOK_TAG_WORDS, ...MORE_LOOK_WORDS, ...STYLE_LOOK_WORDS, ...GENRE_LOOK_WORDS];
