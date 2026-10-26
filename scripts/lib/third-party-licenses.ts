// The third-party notices both binary payloads (Windows bundle, macOS bundle) carry: NOTICE at the payload root and
// licenses/ beside it, holding the full text for everything compiled into or shipped with the binaries. NOTICE points
// at these installed locations (not at source-repository folders a recipient never receives), and a missing,
// empty or unreferenced file is a hard error, never a silent skip.
import { cpSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** One license file: its name under licenses/ and its path in the repository. */
export interface ThirdPartyLicense {
  readonly name: string;
  readonly source: string;
}

/** name in licenses/ -> file in the repository. The Node.js runtime license is added from the verified runtime archive. */
export const THIRD_PARTY_LICENSES: readonly ThirdPartyLicense[] = [
  { name: "xxhash-LICENSE.txt", source: join("native", "extynt-core", "third_party", "xxhash", "LICENSE") },
  { name: "AEQUERY-LICENSE.txt", source: join("apps", "panel", "host", "AEQUERY-LICENSE.txt") },
];

export const NODE_LICENSE_NAME = "node-LICENSE.txt";

function requireNonEmptyFile(file: string, what: string): void {
  if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`${what} is missing: ${file}`);
  if (statSync(file).size === 0) throw new Error(`${what} is empty: ${file}`);
}

/** Paths under licenses/ that NOTICE tells a recipient to look at. */
export function noticeReferencedLicenses(noticeText: string): string[] {
  return [...new Set([...noticeText.matchAll(/\blicenses\/([A-Za-z0-9._-]+)/g)].map((match) => `licenses/${match[1]}`))].sort();
}

/**
 * Copies NOTICE to `bundle/NOTICE` and every third-party license to `bundle/licenses/`, `nodeLicense` being the
 * license file taken from the verified Node.js runtime archive. Throws when any source is absent or empty, or when
 * NOTICE names a licenses/ file the payload does not hold (or the payload holds one NOTICE never mentions).
 */
export function stageThirdPartyLicenses(root: string, bundle: string, nodeLicense: string): void {
  requireNonEmptyFile(join(root, "NOTICE"), "NOTICE");
  cpSync(join(root, "NOTICE"), join(bundle, "NOTICE"));
  const directory = join(bundle, "licenses");
  mkdirSync(directory, { recursive: true });
  for (const { name, source } of THIRD_PARTY_LICENSES) {
    requireNonEmptyFile(join(root, source), `the ${name} source`);
    cpSync(join(root, source), join(directory, name));
  }
  requireNonEmptyFile(nodeLicense, "the Node.js runtime license");
  cpSync(nodeLicense, join(directory, NODE_LICENSE_NAME));
  assertNoticeMatchesPayload(bundle);
}

/** Throws unless every licenses/ path NOTICE references exists non-empty in `bundle`, and every staged license is referenced. */
export function assertNoticeMatchesPayload(bundle: string): void {
  const noticeFile = join(bundle, "NOTICE");
  requireNonEmptyFile(noticeFile, "the payload NOTICE");
  const referenced = noticeReferencedLicenses(readFileSync(noticeFile, "utf8"));
  const expected = [...THIRD_PARTY_LICENSES.map((license) => license.name), NODE_LICENSE_NAME].map((name) => `licenses/${name}`).sort();
  for (const path of referenced) requireNonEmptyFile(join(bundle, path), `${path} (referenced by NOTICE)`);
  for (const path of expected) {
    if (!referenced.includes(path)) throw new Error(`NOTICE does not mention ${path}, which the payload ships`);
  }
}
