/** Names the test file patterns the workspace and root suites run, and expands them to files. */
import { globSync } from "node:fs";
import { resolve } from "node:path";

export const ROOT_TEST_PATTERNS = Object.freeze(["tests/*.test.ts"]);
/** The live decision suites: they call the real Jev model with the developer's key, so only `pnpm test:live` runs them. */
export const LIVE_TEST_PATTERNS = Object.freeze(["apps/sidecar/dist/tests/decision-live-*.test.js", "packages/decide/dist/tests/live*.test.js"]);
export const WORKSPACE_TEST_PATTERNS = Object.freeze([
  "packages/decode/dist/tests/*.test.js",
  "packages/decide/dist/tests/*.test.js",
  "packages/collection/dist/tests/*.test.js",
  "packages/project-graph/dist/tests/*.test.js",
  "packages/action-plan/dist/tests/*.test.js",
  "packages/workflow/dist/tests/*.test.js",
  "packages/host-native/dist/tests/*.test.js",
  "packages/llm/dist/tests/*.test.js",
  "packages/capability-catalogue/dist/tests/*.test.js",
  "packages/mcp-server/dist/tests/*.test.js",
  "packages/host-ae/dist/tests/*.test.js",
  "packages/visual-evidence/dist/tests/*.test.js",
  "packages/ui-text/dist/tests/*.test.js",
  "apps/panel/dist/tests/*.test.js",
  "apps/sidecar/dist/tests/*.test.js",
  "tools/host-verification/dist/tests/*.test.js",
  "tools/chat-tests/dist/tests/*.test.js",
  "tools/fake-plugin/dist/tests/*.test.js",
]);

/** Keep every maintained suite category mandatory, even after files are renamed. */
export function expandTestPatterns(patterns: ReadonlyArray<string>, root: string): string[] {
  if (!patterns.length) throw new Error("No test patterns supplied.");
  const targets = patterns.flatMap((pattern) => {
    const matches = globSync(pattern, { cwd: root }).map((file) => resolve(root, file)).sort();
    if (!matches.length) throw new Error(`Test pattern matched no file: ${pattern}`);
    return matches;
  });
  return [...new Set(targets)];
}
