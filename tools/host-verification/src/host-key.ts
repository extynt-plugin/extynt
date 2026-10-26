/**
 * The host key a kit run is recorded under, computed exactly the way the product computes it (`hostVerificationKey`) so the committed ledger
 * and the live host agree.
 */
import { hostVerificationKey } from "@extynt/capability-catalogue";
import type { LiveReport } from "./types.js";

type Runtime = NonNullable<LiveReport["runtime"]>;

const unset = (value: string): boolean => value === "" || value === "undefined" || value === "null" || value === "unknown";

function canonicalAppVersion(raw: string): string {
  const parts = raw.trim().replace(/x\d+$/, "").split(".");
  while (parts.length < 3 && /^\d+$/.test(parts[0] ?? "")) parts.push("0");
  return parts.join(".");
}

function osFamilyOf(platform: string, os: string): "Windows" | "macOS" | null {
  const text = `${unset(platform) ? "" : platform} ${os}`.toLowerCase();
  if (/win/.test(text)) return "Windows";
  if (/mac|darwin/.test(text)) return "macOS";
  return null;
}

function architectureOf(architecture: string, os: string): string {
  const a = architecture.toLowerCase();
  if (a === "arm64" || a === "aarch64") return "arm64";
  if (a === "x86_64" || a === "amd64" || a === "x64") return "x86_64";
  return /^windows\/64\b/i.test(os.trim()) ? "x86_64" : "unknown";
}

/** The runtime with the version, platform and architecture in the product's spelling. */
export function canonicalRuntime(runtime: Runtime): Runtime {
  return { ...runtime, appVersion: canonicalAppVersion(runtime.appVersion), platform: osFamilyOf(runtime.platform, runtime.os) ?? (unset(runtime.platform) ? "unknown" : runtime.platform), architecture: architectureOf(runtime.architecture, runtime.os) };
}

export const canonicalHostKey = (runtime: Runtime): string | null => hostVerificationKey(canonicalRuntime(runtime));
