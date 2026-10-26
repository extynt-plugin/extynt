// The --paths option: globs, as several arguments after the flag, as a comma list, or both, that limit the file-based gate stages to matching
// repo-relative files.

/** A predicate over repo-relative keys, true for the files a run covers. */
export type PathScope = (key: string) => boolean;

const GLOB_CHARACTERS = /[*?{]/;

function translateBraces(source: string): string {
  return source.replace(/\{([^}]*)\}/g, (_match: string, alternatives: string) => `(?:${alternatives.split(",").join("|")})`);
}

function translateGlob(glob: string): string {
  const escaped = glob.replace(/[.+^$()|[\]\\]/g, "\\$&");
  const wild = escaped.replace(/\*\*\/|\*\*|\*|\?/g, (token: string) => {
    if (token === "**/") return "(?:.*/)?";
    if (token === "**") return ".*";
    return token === "*" ? "[^/]*" : "[^/]";
  });
  return translateBraces(wild);
}

/** A RegExp matching repo-relative paths for one glob; a glob without wildcards matches that file or directory. */
export function globToRegExp(glob: string): RegExp {
  const cleaned = glob.replace(/^\.\//, "").replace(/\/+$/, "");
  const body = GLOB_CHARACTERS.test(cleaned) ? translateGlob(cleaned) : `${cleaned.replace(/[.+^$()|[\]\\]/g, "\\$&")}(?:/.*)?`;
  return new RegExp(`^${body}$`);
}

/** The globs of every `--paths` option: each takes the following arguments up to the next flag, and each argument may be a comma list. */
export function pathGlobs(argv: ReadonlyArray<string>): string[] {
  const globs: string[] = [];
  argv.forEach((argument, index) => {
    if (argument !== "--paths") return;
    for (const value of argv.slice(index + 1)) {
      if (value.startsWith("--")) break;
      globs.push(...value.split(/,(?![^{]*\})/).map((glob) => glob.trim()).filter(Boolean));
    }
  });
  return globs;
}

/** A predicate over repo-relative keys: everything matches when no globs are given. */
export function pathScope(globs: ReadonlyArray<string>): PathScope {
  const patterns = globs.map(globToRegExp);
  return (key) => patterns.length === 0 || patterns.some((pattern) => pattern.test(key));
}
