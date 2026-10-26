// Spacing repair for a prose answer whose straight double quotes touch the words around them.

const QUOTE = '"';
const WORD_BEFORE = /[\p{L}\p{N}.,:;!?)]$/u;
const WORD_AFTER = /^[\p{L}\p{N}(]/u;

function spaced(parts: readonly string[]): string {
  return parts.reduce((text, part, index) => {
    if (index === 0) return part;
    const opening = index % 2 === 1;
    const glued = opening ? WORD_BEFORE.test(text) : WORD_AFTER.test(part);
    return text + (opening && glued ? ` ${QUOTE}` : `${QUOTE}${glued ? " " : ""}`) + part;
  }, "");
}

/** Puts back the spaces a model left out between a quoted name and the words beside it ("is"R01 Title"(comp" becomes "is "R01 Title" (comp"). Quotes pair off in order; an odd count, or a code span, leaves the text as it came. */
export function spacedQuotes(text: string): string {
  if (text.includes("`")) return text;
  const parts = text.split(QUOTE);
  return parts.length % 2 === 1 ? spaced(parts) : text;
}
