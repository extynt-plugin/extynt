// The shape every text-based gate rule consumes: one maintained file's repo-relative key and its text.

/** A file read for a rule: `key` is the repo-relative path with forward slashes. */
export interface SourceEntry {
  readonly key: string;
  readonly text: string;
}
