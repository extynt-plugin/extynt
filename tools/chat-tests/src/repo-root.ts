/** Where the repository checkout lives, resolved from this module so the harness works from any directory. */
import { fileURLToPath } from "node:url";

/** The repository root, with a trailing separator. */
export const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
