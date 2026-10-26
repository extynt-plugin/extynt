// Maps repo-relative paths to the areas the typing and native census report: workspace packages, panel parts and native layers.
interface AreaRule {
  readonly pattern: RegExp;
  readonly name: (match: RegExpExecArray) => string;
}

const TS_AREAS: ReadonlyArray<AreaRule> = [
  { pattern: /^apps\/sidecar\//, name: () => "apps/sidecar" },
  { pattern: /^apps\/panel\/runtime\//, name: () => "apps/panel/runtime" },
  { pattern: /^apps\/panel\/tests\//, name: () => "apps/panel/tests" },
  { pattern: /^((?:packages|tools)\/[^/]+)\//, name: (match) => match[1] ?? "other" },
  { pattern: /^scripts\//, name: () => "scripts" },
  { pattern: /^tests\//, name: () => "tests" },
];

const NATIVE_AREA = /^native\/extynt-core\/(ae|core|transport|catalogue-window|tests)\//;

/** The census area of a repo-relative TS/JS path; everything outside the named areas is "other". */
export function areaOf(key: string): string {
  for (const { pattern, name } of TS_AREAS) {
    const match = pattern.exec(key);
    if (match) return name(match);
  }
  return "other";
}

/** The native directory (ae, core, transport, catalogue-window, tests) of a repo-relative native path, else "other". */
export function nativeAreaOf(key: string): string {
  return NATIVE_AREA.exec(key)?.[1] ?? "other";
}
