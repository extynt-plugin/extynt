#!/usr/bin/env bash
# Compiles the PiPL (.r) into a data-fork .rsrc inside the plugin bundle, as the SDK's Xcode
# samples do through Xcode's Rez build rule. Usage:
#   rez_pipl.sh <AE SDK Examples dir> <PiPL .r file> <output .rsrc>
# Rez is deprecated by Apple but still ships with Xcode. Because Xcode's exact command line is not
# visible from here, several equivalent variants are tried in order and the first that yields a
# non-empty file wins. Set EXTYNT_REZ_VERBOSE=1 to see every attempt.
set -euo pipefail
sdk_examples="$1"
source_r="$2"
out_rsrc="$3"

fail() { echo "rez_pipl.sh: $*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "Rez only exists on macOS."
rez="$(xcrun --find Rez 2>/dev/null || true)"
if [ -z "$rez" ] || [ ! -x "$rez" ]; then
  fail "Rez not found. Install full Xcode (Rez lives in Xcode.app/Contents/Developer/usr/bin) and select it: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer. The Command Line Tools alone may lack Rez."
fi
sdkroot="$(xcrun --sdk macosx --show-sdk-path 2>/dev/null || true)"
[ -f "$sdk_examples/Headers/AEConfig.h" ] || fail "AEConfig.h not found under $sdk_examples/Headers (check AE_SDK_ROOT)."
[ -f "$sdk_examples/Resources/AE_General.r" ] || fail "AE_General.r not found under $sdk_examples/Resources (check AE_SDK_ROOT)."
[ -f "$source_r" ] || fail "PiPL source not found: $source_r"
mkdir -p "$(dirname "$out_rsrc")"

common=(-useDF -d __MACH__ -i "$sdk_examples/Headers" -i "$sdk_examples/Resources" -i "$(dirname "$source_r")")
[ -n "$sdkroot" ] && common+=(-isysroot "$sdkroot")

attempt() {
  local label="$1"; shift
  rm -f "$out_rsrc"
  local log status=0
  log="$("$rez" "$@" -o "$out_rsrc" "$source_r" 2>&1)" || status=$?
  if [ $status -eq 0 ] && [ -s "$out_rsrc" ]; then
    echo "rez_pipl.sh: compiled PiPL with variant '$label' -> $out_rsrc ($(wc -c < "$out_rsrc" | tr -d ' ') bytes)"
    return 0
  fi
  if [ -n "${EXTYNT_REZ_VERBOSE:-}" ] || [ "$label" = "last" ]; then
    echo "rez_pipl.sh: variant '$label' failed (exit $status):" >&2
    printf '    %s\n' "${log//$'\n'/$'\n'    }" >&2
  fi
  return 1
}

attempt "arch-flags" "${common[@]}" -arch arm64 -arch x86_64 && exit 0
attempt "single-arch" "${common[@]}" -arch arm64 && exit 0
attempt "arch-define" "${common[@]}" -d __arm64__ && exit 0
attempt "last" "${common[@]}" && exit 0
fail "every Rez variant failed. Run with EXTYNT_REZ_VERBOSE=1 for each attempt. Common causes: Xcode license not accepted (sudo xcodebuild -license), wrong AE_SDK_ROOT, or Rez missing the SDK root."
