/** The words on the composer's model pill, "Sonnet 4.5 · High", from the primary slot's model and reasoning effort. */
const MAX_NAME_LENGTH = 18;
const FAMILY = /^(opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?$/;

/** The word with its first letter in capitals. */
export function capitalized(word: string): string {
  return word.replace(/^./, (first) => first.toUpperCase());
}

function familyName(match: RegExpExecArray): string {
  const [, family = "", major = "", minor] = match;
  return capitalized(family) + " " + major + (minor ? "." + minor : "");
}

function nameOf(model: string): string {
  const id = (model.split("/").pop() ?? model).replace(/^claude[- ]/i, "").replace(/-\d{8}$/, "");
  const family = FAMILY.exec(id.toLowerCase());
  if (family) return familyName(family);
  return id.length > MAX_NAME_LENGTH ? id.slice(0, MAX_NAME_LENGTH - 1) + "…" : id;
}

/** The model's short name and its effort, each left out when unknown ("default" is not worth a word). */
export function modelPillText(model: string | undefined, effort: string | undefined): string {
  const level = effort && effort !== "default" ? capitalized(effort) : "";
  return [model ? nameOf(model) : "", level].filter(Boolean).join(" · ");
}
