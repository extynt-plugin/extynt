// The sidecar's version and the fingerprint of the build that is running.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SIDECAR_VERSION } from "./server-contracts.js";

function moduleFiles(directory: string, prefix: string): string[] {
  return readdirSync(join(directory, prefix), { withFileTypes: true })
    .flatMap((entry) => {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return moduleFiles(directory, relative);
      return entry.name.endsWith(".js") ? [relative] : [];
    })
    .sort();
}

/**
 * A short digest of every compiled module under `directory`. Each module's relative path goes into the digest with its bytes,
 * so a module that is moved or renamed changes the digest as an edit does. Null when the directory cannot be read.
 */
export function moduleDigest(directory: string): string | null {
  try {
    const digest = createHash("sha256");
    for (const relative of moduleFiles(directory, "")) digest.update(`${relative}\0`).update(readFileSync(join(directory, ...relative.split("/"))));
    return digest.digest("hex").slice(0, 8);
  } catch {
    return null;
  }
}

function buildFingerprint(): string {
  const digest = moduleDigest(fileURLToPath(new URL(".", import.meta.url)));
  return digest === null ? SIDECAR_VERSION : `${SIDECAR_VERSION}+${digest}`;
}

/**
 * The version and a content digest of the compiled sidecar modules that run, so two builds of one version are told apart.
 * It identifies the build by the code it runs. It is not the git commit the build was made from: a commit is not part of the
 * compiled modules, so the commit has to be recorded by whoever makes the build.
 */
export const SIDECAR_BUILD_ID = buildFingerprint();

/** The reference that stands for an approval token in logs and plan state, so the token itself is never kept. */
export function approvalReference(token: string): string {
  return `approval-ref:${createHash("sha256").update(token).digest("hex")}`;
}
