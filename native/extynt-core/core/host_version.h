// Which After Effects the plugin was loaded into, and what that means for extynt. Pure core: the adapter hands in the
// host's version text and the facts it measured at startup (the AEGP API version, the suites it acquired); this file
// parses and classifies. The answer rides in `ping` and `ping_direct` as `host`, so the sidecar, the agent and the
// receipts always know whether they are on 25 or 26, and a difference between the two is a typed field, never a guess.
// The thresholds mirror NATIVE_SVG_MIN_MAJOR and AE25_MEASURED in packages/host-native/src/host-identity.ts and
// NATIVE_SVG_IMPORTER_MIN_MAJOR in packages/action-plan/src/svg-routing.ts; the plugin alone decides the revision
// guard.
#pragma once

#include <cstdint>
#include <string>

namespace extynt {

struct HostVersion {
  // False when the text held no "major.minor"
  bool known = false;
  int major = 0;
  int minor = 0;
  int patch = 0;
  // Empty when the text carried none
  std::string build;
};

// Accepts "26.5.0 (build 61)", "25.6", "26.2.1x2" (ExtendScript's app.version) and the bare forms; anything else is
// {known: false}, including a version followed by other text ("26.5abc", "26.5.0-beta", "26.5.0.1"). The TypeScript
// deriveHostIdentity accepts exactly the same forms; the vectors in tests/vectors/host_versions.json hold both to it.
HostVersion parseHostVersion(const std::string& text);

enum class HostFamily : std::uint8_t { Unknown, Older, Ae25, Ae26, Newer };

[[nodiscard]] HostFamily hostFamily(const HostVersion& version);
[[nodiscard]] const char* hostFamilyName(HostFamily family);

// How the host serves SVG import: "native" (AE 26 and later), "converter" (before 26: extynt builds the shapes itself),
// "unknown" when the version could not be read (the sidecar then tries native first). The same cut-off the sidecar's
// svgImporterRoute uses (packages/action-plan/src/svg-routing.ts).
[[nodiscard]] const char* svgImportRoute(const HostVersion& version);

// True for a release newer than the newest measured major: extynt runs there, but nothing has been tried on it, so
// the panel, ae_status, the agent and the receipts all say EXPERIMENTAL rather than only "unmeasured".
[[nodiscard]] bool hostExperimental(const HostVersion& version);

// Whether the plugin reads `app.project.revision` on this host ("on"), or leaves it out of every stamp ("off") so the
// sidecar guards by content fingerprint alone. Decided per release from real runs.
[[nodiscard]] bool revisionGuardOn(const HostVersion& version);

// True for the majors whose behaviour has been measured on a real host (docs/native/plugin-design.md). A major outside
// the set still runs, but every answer from it is unmeasured and the receipts say so.
[[nodiscard]] bool hostMajorMeasured(int major);

// What the adapter measured at startup, independent of the version number.
struct HostApiFacts {
  // The AEGP version passed to the entry point
  long aegpApiMajor = 0;
  long aegpApiMinor = 0;
  // The Stream suite version acquired (0 if none)
  int streamSuite = 0;
  // GetExpression returns UTF-16 on that suite
  bool expressionUtf16 = false;
  // Every suite the reads need loaded
  bool suitesComplete = false;
};

// The `host` object: {version, major, minor, patch, build, family, supported, measured, aegpApi, capabilities}.
// `capabilities` holds only typed values: strings with a closed vocabulary, or booleans.
std::string hostProfileJson(const std::string& versionText, const HostApiFacts& facts);

}
