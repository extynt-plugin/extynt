/** "0.9.8e" -> "0.9.8.5", "0.9.8t" -> "0.9.8.20": the numeric four-part form the installer's file-version resource needs.
 *  The letter suffix is the fourth component (a=1 ... z=26); a version without one is .0. */
export function fileVersionOf(version: string): string {
  const core = /^(\d+)\.(\d+)\.(\d+)([a-z])?/.exec(version);
  if (!core) throw new Error(`version ${version} has no major.minor.patch`);
  const revision = core[4] ? core[4].charCodeAt(0) - "a".charCodeAt(0) + 1 : 0;
  return `${core[1]}.${core[2]}.${core[3]}.${revision}`;
}
