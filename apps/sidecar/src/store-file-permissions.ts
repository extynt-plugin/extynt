// Whether a store file's permission bits let other local users in.

/** True when a POSIX store file's mode lets group or other in. Windows reports every file as 0o666 (0o444 when read-only) whatever its ACL grants, so the bits say nothing there: these stores live in the user's own profile, and its ACL is the guard. */
export function opensToOthers(mode: number, platform: NodeJS.Platform = process.platform): boolean {
  return platform !== "win32" && (mode & 0o077) !== 0;
}
