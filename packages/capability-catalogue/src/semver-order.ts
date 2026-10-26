// Orders extynt kit versions by SemVer precedence, treating a letter suffix on the core as a later build of the same release.

type Order = -1 | 0 | 1;

interface ParsedVersion {
  readonly core: readonly string[];
  readonly letters: string;
  readonly prerelease: readonly string[] | undefined;
}

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)([a-z]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const NUMERIC = /^\d+$/;

function orderOf(left: string | number, right: string | number): Order {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

function hasLeadingZero(part: string): boolean {
  return NUMERIC.test(part) && part.length > 1 && part.startsWith("0");
}

function parseVersion(version: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(version);
  if (!match) return null;
  const letters = match[4] ?? "";
  const prerelease = match[5]?.split(".");
  if ((letters && prerelease) || prerelease?.some(hasLeadingZero)) return null;
  return { core: match.slice(1, 4), letters, prerelease };
}

function compareDecimalParts(left: string, right: string): Order {
  return left.length === right.length ? orderOf(left, right) : orderOf(left.length, right.length);
}

function comparePrereleaseIdentifiers(left: string, right: string): Order {
  const leftNumeric = NUMERIC.test(left);
  const rightNumeric = NUMERIC.test(right);
  if (leftNumeric && rightNumeric) return compareDecimalParts(left, right);
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return orderOf(left, right);
}

function comparePrereleaseParts(left: readonly string[], right: readonly string[]): Order {
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const order = comparePrereleaseIdentifiers(leftPart, rightPart);
    if (order !== 0) return order;
  }
  return 0;
}

function comparePrereleases(left: readonly string[] | undefined, right: readonly string[] | undefined): Order {
  if (left && right) return comparePrereleaseParts(left, right);
  if (left) return -1;
  return right ? 1 : 0;
}

function compareParsed(left: ParsedVersion, right: ParsedVersion): Order {
  const coreOrder = left.core.map((part, index) => compareDecimalParts(part, right.core[index] ?? "")).find((order) => order !== 0);
  if (coreOrder) return coreOrder;
  if (left.letters !== right.letters) return orderOf(left.letters, right.letters);
  return comparePrereleases(left.prerelease, right.prerelease);
}

/** Negative when `left` is older, positive when newer, zero when equal; null when either is not a version. */
export function compareSemverVersions(left: string, right: string): number | null {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);
  return parsedLeft && parsedRight ? compareParsed(parsedLeft, parsedRight) : null;
}
