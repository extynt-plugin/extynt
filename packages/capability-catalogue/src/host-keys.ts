// The key host evidence is recorded under (version, build, platform, architecture), and the rules for which recorded keys apply to a host.

/** The running After Effects as the snapshot reports it. */
export interface HostRuntimeIdentity {
  readonly appVersion: string;
  readonly buildNumber: string | null;
  readonly platform: string;
  readonly architecture: string;
}

/** The operating system families a host key can name. */
export type HostOsFamily = "Windows" | "macOS";

/** A host key split into its After Effects major, operating system family and version. */
export interface ParsedHostKey {
  readonly major: number;
  readonly os: HostOsFamily | null;
  readonly version: string;
}

const HOST_KEY_PATTERN = /^(\d+)((?:\.\d+)*)\S*(?: \([^)]*\))? (\S+)\/\S*$/;

function osFamilyOfPlatform(platform: string): HostOsFamily | null {
  if (platform.startsWith("win")) return "Windows";
  return platform === "macos" || platform === "mac" || platform.startsWith("darwin") ? "macOS" : null;
}

function splitArchitecture(key: string): { base: string; architecture: string } {
  const slash = key.lastIndexOf("/");
  if (slash < 0) return { base: key, architecture: key };
  return { base: key.slice(0, slash + 1), architecture: key.slice(slash + 1) };
}

/** The exact key evidence is recorded under; any change to version, build, platform, or architecture starts over. */
export function hostVerificationKey(runtime: HostRuntimeIdentity | null | undefined): string | null {
  if (!runtime?.appVersion) return null;
  return `${runtime.appVersion} (${runtime.buildNumber ?? "?"}) ${runtime.platform}/${runtime.architecture}`;
}

/** An entry recorded under an `unknown` architecture applies to any architecture of the same version, build and platform; the reverse never holds. */
export function ledgerKeyApplies(ledgerKey: string, hostKey: string): boolean {
  if (ledgerKey === hostKey) return true;
  const recorded = splitArchitecture(ledgerKey);
  return recorded.architecture === "unknown" && recorded.base === splitArchitecture(hostKey).base;
}

/** "26.2.1x2 (2) Windows/unknown" -> major 26, OS Windows, version "26.2.1". Platform spellings differ between the panel ("macOS"), node ("darwin", "win32") and older ledgers, so the OS is normalised; null when the key does not parse. */
export function parseHostKey(key: string): ParsedHostKey | null {
  const match = HOST_KEY_PATTERN.exec(key.trim());
  if (!match) return null;
  return { major: Number(match[1]), os: osFamilyOfPlatform((match[3] ?? "").toLowerCase()), version: `${match[1]}${match[2] ?? ""}` };
}

/** Evidence from another patch build applies when the After Effects major and the OS family match: the operations run through the same scripting surface, and this copy's receipts still catch a regression. */
export function ledgerKeyAppliesToFamily(ledgerKey: string, hostKey: string): boolean {
  const recorded = parseHostKey(ledgerKey);
  const host = parseHostKey(hostKey);
  return recorded !== null && host !== null && recorded.os !== null && recorded.os === host.os && recorded.major === host.major;
}

/** "After Effects 26.2.1 Windows": the build the evidence came from, for every verdict detail. */
export function evidenceHostName(ledgerKey: string): string {
  const parsed = parseHostKey(ledgerKey);
  if (!parsed) return `After Effects ${ledgerKey}`;
  return `After Effects ${parsed.version}${parsed.os ? ` ${parsed.os}` : ""}`;
}
