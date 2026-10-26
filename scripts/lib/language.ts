// The language key the text-based gate rules dispatch on: a file's extension, or ".sh" for an extensionless shell script.

/** A first line that names a shell interpreter. */
export const SHELL_SHEBANG = /^#!.*\b(?:ba|da|z)?sh\b/;

/** The extension of a repo-relative key (with its dot), ".sh" for an extensionless file whose text starts with a shell shebang, else "". */
export function languageOf(key: string, text: string): string {
  const name = key.slice(key.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot >= 0) return name.slice(dot);
  return SHELL_SHEBANG.test(text) ? ".sh" : "";
}
