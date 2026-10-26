#!/usr/bin/env bash
# Syntax-checks the AE-facing sources on Linux, where the SDK and Apple's frameworks cannot be built against:
#   AE_SDK_ROOT=/path/to/AdobeAfterEffectsSDK_26.5_MacOS native/extynt-core/tests/syntax-check/check-ae-syntax.sh [--tidy]
# The Adobe headers are only read from AE_SDK_ROOT (never copied). The Mac-only types they need (Fixed, Boolean,
# Handle, TargetConditionals) and the Cocoa/WebKit declarations that the ae/*.mm files use come from the small
# hand-written stand-ins in ./stubs. This is a syntax and type check against OUR idea of those APIs; it is not a
# build. Only the Mac build proves the code compiles against Apple's SDK.
# Every .cpp (g++) and every .mm (clang++, Objective-C++ with ARC) in ae/ is checked with the project's strict
# warning set and -Werror. With --tidy (or EXTYNT_TIDY=1) the same files, with the same flags, go through clang-tidy
# using native/extynt-core/.clang-tidy instead, plus the Apple header mapping on macOS (TIDY overrides the clang-tidy
# binary), with the sdk_* wrapper files on the derived wrapper config; the .mm files are left out of that mode.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
core="$(cd "$here/../.." && pwd)"
repo="$(cd "$core/../.." && pwd)"
sdk="${AE_SDK_ROOT:?set AE_SDK_ROOT to the unpacked After Effects SDK}"
[ -d "$sdk/Examples/Headers" ] && sdk="$sdk/Examples"

tidy_mode=0
if [ "${1:-}" = "--tidy" ] || [ "${EXTYNT_TIDY:-0}" = "1" ]; then tidy_mode=1; fi

warnings=(-Wall -Wextra -Wpedantic -Wshadow -Wconversion -Wsign-conversion -Wnon-virtual-dtor -Wold-style-cast
          -Woverloaded-virtual -Wnull-dereference -Wdouble-promotion -Wformat=2 -Wimplicit-fallthrough -Wcast-align
          -Wunused -Werror)
common=(-std=c++17 "${warnings[@]}" -include "$here/stubs/macshim.h"
        -D__MACH__ -DMAC_ENV=1 -D__LP64__ -DEXTYNT_PLUGIN_VERSION='"check"'
        -I"$core/ae" -I"$core/core" -I"$core/transport"
        -isystem "$core/third_party/xxhash" -isystem "$here/stubs"
        -isystem "$sdk/Headers" -isystem "$sdk/Headers/SP" -isystem "$sdk/Resources")
objcxx=(-x objective-c++ -fobjc-arc -fobjc-weak -fblocks -fobjc-runtime=gnustep-2.0 -Wobjc-missing-super-calls)

cd "$core"
shopt -s nullglob
cpp_files=()
for candidate in ae/*.cpp; do
  case "$candidate" in ae/*_win.cpp | ae/*_win_*.cpp) continue ;; esac
  cpp_files+=("$candidate")
done
mm_files=(ae/*.mm)
if [ ${#cpp_files[@]} -eq 0 ] || [ ${#mm_files[@]} -eq 0 ]; then
  echo "no sources found in $core/ae" >&2
  exit 1
fi

if [ "$tidy_mode" = 1 ]; then
  config="${EXTYNT_TIDY_CONFIG:-}"
  if [ -z "$config" ] && [ "$(uname -s)" = "Darwin" ]; then config="$(node "$repo/scripts/darwin-tidy-config.ts")"; fi
  if [ -z "${SDKROOT:-}" ] && [ "$(uname -s)" = "Darwin" ]; then
    SDKROOT="$(xcrun --show-sdk-path)"
    export SDKROOT
  fi
  config="${config:-$core/.clang-tidy}"
  wrapper_config="${EXTYNT_TIDY_WRAPPER_CONFIG:-$(node "$repo/scripts/wrapper-tidy-config.ts")}"
  tidy="${TIDY:-}"
  if [ -z "$tidy" ] && [ -x "$repo/.tools/venv/bin/clang-tidy" ]; then tidy="$repo/.tools/venv/bin/clang-tidy"; fi
  if [ -z "$tidy" ]; then tidy="clang-tidy"; fi
  failed=0
  for file in "${cpp_files[@]}"; do
    echo "tidy: $file"
    case "$file" in ae/sdk_*) use="$wrapper_config" ;; *) use="$config" ;; esac
    "$tidy" --quiet --config-file="$use" "$file" -- -x c++ "${common[@]}" || failed=1
  done
  for file in ae/sdk_*.h; do
    case "$file" in ae/sdk_win_* | ae/sdk_cocoa.h | ae/sdk_panel_suite_ids.h) continue ;; esac
    [ -e "${file%.h}.cpp" ] && continue
    echo "tidy: $file (header)"
    "$tidy" --quiet --config-file="$wrapper_config" "$file" -- -x c++-header "${common[@]}" || failed=1
  done
  if [ "${EXTYNT_TIDY_MM:-0}" = "1" ]; then
    for file in "${mm_files[@]}"; do
      echo "tidy: $file (Objective-C++)"
      "$tidy" --quiet --config-file="$config" "$file" -- "${objcxx[@]}" "${common[@]}" || failed=1
    done
  else
    echo "tidy: ae/*.mm skipped (see the comment in this script; EXTYNT_TIDY_MM=1 runs them)"
  fi
  [ "$failed" = 0 ] || exit 1
  echo "ok"
  exit 0
fi

failed=0
failed_files=()
for file in "${cpp_files[@]}"; do
  echo "syntax: $file"
  g++ -fsyntax-only "${common[@]}" "$file" || { failed=1; failed_files+=("$file"); }
done
for file in "${mm_files[@]}"; do
  if [ "$(uname -s)" = "Darwin" ]; then
    echo "syntax: $file skipped (Objective-C++ against the stand-in Cocoa is Linux-only; the Mac build compiles it)"
    continue
  fi
  echo "syntax: $file (Objective-C++, ARC, against the stand-in Cocoa and WebKit)"
  clang++ -fsyntax-only "${objcxx[@]}" "${common[@]}" "$file" || { failed=1; failed_files+=("$file"); }
done
if [ "$failed" != 0 ]; then
  echo "FAILED: ${#failed_files[@]} file(s) did not pass:" >&2
  printf '  %s\n' "${failed_files[@]}" >&2
  exit 1
fi
echo "ok"
