#!/usr/bin/env bash
# Syntax-checks the Windows sources (ae/*_win*.cpp, transport/*_win.cpp, catalogue-window/) on Linux with a mingw-w64 cross compiler:
#   AE_SDK_ROOT=/path/to/AfterEffectsSDK native/extynt-core/tests/syntax-check/check-ae-syntax-win.sh [--tidy]
# With --tidy (or EXTYNT_TIDY=1) the same files go through clang-tidy for the x86_64-w64-mingw32 target against mingw's
# Windows headers and libstdc++, without the gcc compiler include directories (clang's own intrinsics headers replace them);
# the sdk_* wrapper files and headers use the wrapper configuration.
# WIN_CXX names the compiler (default x86_64-w64-mingw32-g++-posix, else x86_64-w64-mingw32-g++); WEBVIEW2_INCLUDE the
# directory with WebView2.h (default .tools/webview2/build/native/include, fetched by `pnpm setup:tools`). The Adobe
# headers are only read from AE_SDK_ROOT (never copied). This checks syntax and types against mingw's Windows headers,
# not the MSVC build: only the Windows build proves the code compiles with MSVC /W4 /WX and links.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
core="$(cd "$here/../.." && pwd)"
repo="$(cd "$core/../.." && pwd)"
sdk="${AE_SDK_ROOT:?set AE_SDK_ROOT to the unpacked After Effects SDK}"
[ -d "$sdk/Examples/Headers" ] && sdk="$sdk/Examples"
cxx="${WIN_CXX:-}"
if [ -z "$cxx" ]; then
  for candidate in x86_64-w64-mingw32-g++-posix x86_64-w64-mingw32-g++; do
    if command -v "$candidate" >/dev/null 2>&1; then cxx="$candidate"; break; fi
  done
fi
[ -n "$cxx" ] || { echo "no mingw-w64 compiler: install g++-mingw-w64-x86-64 or set WIN_CXX" >&2; exit 1; }
webview2="${WEBVIEW2_INCLUDE:-$repo/.tools/webview2/build/native/include}"
[ -f "$webview2/WebView2.h" ] || { echo "WebView2.h not found in $webview2: run pnpm setup:tools" >&2; exit 1; }

warnings=(-Wall -Wextra -Wpedantic -Wshadow -Wconversion -Wsign-conversion -Wold-style-cast -Woverloaded-virtual
          -Wnull-dereference -Wdouble-promotion -Wformat=2 -Wimplicit-fallthrough -Wcast-align -Wunused -Werror)
common=(-std=c++17 "${warnings[@]}" -DMSWindows -DWIN32 -D_WINDOWS -DWIN32_LEAN_AND_MEAN -DNOMINMAX
        -DEXTYNT_PLUGIN_VERSION='"check"'
        -DUNICODE -D_UNICODE -DEXTYNT_ICON_PATH='""' -Wno-unknown-pragmas
        -I"$core/ae" -I"$core/core" -I"$core/transport" -I"$core/catalogue-window"
        -isystem "$core/third_party/xxhash" -isystem "$here/win"
        -isystem "$sdk/Headers" -isystem "$sdk/Headers/SP" -isystem "$sdk/Resources" -isystem "$webview2")

tidy_mode=0
if [ "${1:-}" = "--tidy" ] || [ "${EXTYNT_TIDY:-}" = 1 ]; then tidy_mode=1; fi

cd "$core"
shopt -s nullglob
files=(ae/*_win.cpp ae/*_win_*.cpp ae/ae_entry.cpp ae/ae_suites.cpp ae/ae_reader*.cpp ae/ae_log.cpp transport/*_win.cpp transport/sdk_winsock.cpp catalogue-window/*.cpp)
if [ "$tidy_mode" = 1 ]; then
  tidy="${TIDY:-}"
  if [ -z "$tidy" ] && [ -x "$repo/.tools/venv/bin/clang-tidy" ]; then tidy="$repo/.tools/venv/bin/clang-tidy"; fi
  tidy="${tidy:-clang-tidy}"
  config="${EXTYNT_TIDY_WINDOWS_CONFIG:-$(node "$repo/scripts/wrapper-tidy-config.ts" windows)}"
  wrapper_config="${EXTYNT_TIDY_WINDOWS_WRAPPER_CONFIG:-$(node "$repo/scripts/wrapper-tidy-config.ts" windows-wrapper)}"
  sysroot=()
  while IFS= read -r dir; do sysroot+=(-isystem "$dir"); done < <(
    "$cxx" -E -x c++ - -v </dev/null 2>&1 | sed -n '/#include <...>/,/End of search/p' | sed '1d;$d' | sed 's/^ //' |
      while IFS= read -r dir; do
        resolved="$(cd "$dir" && pwd)"
        case "$resolved" in (*/lib/gcc/*/include | */lib/gcc/*/include-fixed) continue ;; esac
        echo "$resolved"
      done)
  failed=0
  for file in "${files[@]}" ae/sdk_win_*.h ae/sdk_panel_suite_ids.h; do
    case "$file" in ae/sdk_win_*.h | ae/sdk_panel_suite_ids.h) [ -e "${file%.h}.cpp" ] && continue; lang=c++-header ;; *) lang=c++ ;; esac
    case "$file" in */sdk_*) use="$wrapper_config" ;; *) use="$config" ;; esac
    echo "win tidy: $file"
    "$tidy" --quiet --config-file="$use" "$file" -- -x "$lang" --target=x86_64-w64-mingw32 -fms-extensions -nostdinc++ \
      "${sysroot[@]}" "${common[@]}" || failed=1
  done
  [ "$failed" = 0 ] || exit 1
  echo "ok"
  exit 0
fi
for file in "${files[@]}"; do
  echo "win syntax: $file"
  "$cxx" -fsyntax-only "${common[@]}" "$file"
done
echo "win syntax: tests/test_panel_keys_win.cpp"
"$cxx" -fsyntax-only "${common[@]}" -I"$core/tests" tests/test_panel_keys_win.cpp
echo "ok"
