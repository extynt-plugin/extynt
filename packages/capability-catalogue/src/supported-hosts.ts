// The After Effects majors and operating systems extynt is built for. A host outside this list is not refused; it simply has no support claim.
import type { HostOsFamily } from "./host-keys.js";

/** One After Effects major on one operating system family. */
export interface SupportedHost {
  readonly os: HostOsFamily;
  readonly major: number;
}

/** Every host family extynt supports. */
export const SUPPORTED_HOSTS: readonly SupportedHost[] = [
  { os: "macOS", major: 25 },
  { os: "macOS", major: 26 },
  { os: "Windows", major: 25 },
  { os: "Windows", major: 26 },
];

/** A representative key for a host family; only its major and OS family matter to family matching. */
export const supportedHostKey = (host: SupportedHost): string => `${host.major}.0 (0) ${host.os}/unknown`;

/** "After Effects 26 Windows": the name of a host family. */
export const supportedHostLabel = (host: SupportedHost): string => `After Effects ${host.major} ${host.os}`;
