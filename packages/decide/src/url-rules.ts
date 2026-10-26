// Where a configured decision model may be reached: https anywhere, plain http only on this machine.

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parsed(address: string): URL | null {
  try {
    return new URL(address);
  } catch {
    return null;
  }
}

/** True for an address on this machine: localhost, 127.0.0.1, ::1 or a name under .localhost. */
export function isLoopback(address: string): boolean {
  const url = parsed(address);
  return url !== null && (LOOPBACK_HOSTS.has(url.hostname) || url.hostname.endsWith(".localhost"));
}

/** Why an address may not be used, or null when it may: it must be a URL, and https unless it is on this machine. */
export function addressProblem(address: string): string | null {
  const url = parsed(address);
  if (url === null) return `${address} is not a URL`;
  if (url.protocol === "https:") return null;
  return url.protocol === "http:" && isLoopback(address) ? null : "a remote address must use https (plain http is for this machine only)";
}
