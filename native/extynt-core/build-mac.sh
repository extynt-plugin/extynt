#!/usr/bin/env bash
# Builds, signs and (optionally) installs the extynt native core plugin on macOS.
#
#   AE_SDK_ROOT=~/SDKs/AdobeAfterEffectsSDK_26.5_MacOS \
#   EXTYNT_CODESIGN_ID="Developer ID Application: Your Name (TEAMID)" \
#   native/extynt-core/build-mac.sh [--install] [--uninstall] [--no-sign] [--clean] [--dev-library] [--ae-year 2026]
#
# --dev-library builds with EXTYNT_DEV_LIBRARY=ON: the plugin then also reads the host jsx library from
# ~/Library/Application Support/extynt/host (node scripts/install-host-library.ts fills it). Never ship such a build.
# Output: native/extynt-core/build/mac/ae/extyntcore.plugin (universal arm64 + x86_64, signed). Every prerequisite is checked up front.
# --install / --uninstall write under /Applications/Adobe After Effects <year>/Plug-ins, which is root-owned: when the
# folder is not writable the steps are re-run with sudo (EXTYNT_SUDO overrides the command) after the script prints the
# command and the reason; a bundle copied with sudo is handed to root:wheel like the folder it sits in.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
build_dir="${EXTYNT_BUILD_DIR:-$here/build/mac}"
plugin_version="${EXTYNT_PLUGIN_VERSION:-0.1.0}"
deployment_target="${EXTYNT_MACOS_TARGET:-13.5}"
ae_year="2026"
do_install=0
do_uninstall=0
do_sign=1
do_clean=0
dev_library=OFF

die() { echo "build-mac.sh: ERROR: $*" >&2; exit 1; }
note() { echo "build-mac.sh: $*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --install) do_install=1 ;;
    --uninstall) do_uninstall=1 ;;
    --no-sign) do_sign=0 ;;
    --clean) do_clean=1 ;;
    --dev-library) dev_library=ON ;;
    --ae-year) shift; ae_year="${1:-}" ;;
    -h|--help) sed -n '2,15p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
  shift
done

applications_dir="${EXTYNT_APPLICATIONS_DIR:-/Applications}"
install_dir="$applications_dir/Adobe After Effects $ae_year/Plug-ins/extynt"
read -r -a sudo_cmd <<<"${EXTYNT_SUDO:-sudo}"

quote_cmd() { printf '%q ' "$@"; }

# The closest existing folder at or above $1: the one whose permissions decide whether a write there works.
nearest_existing() {
  local dir="$1"
  while [ ! -e "$dir" ] && [ "$dir" != "/" ]; do dir="$(dirname "$dir")"; done
  echo "$dir"
}

# priv DIR CMD...: runs CMD. DIR is the folder CMD writes into (or removes from); when this user cannot write
# there, CMD is re-run with sudo. Always prints the exact command that runs and why it needs root.
# priv_used_sudo says whether the last priv call took the sudo path.
priv_used_sudo=0
priv() {
  local target probe
  target="$1"; shift
  probe="$(nearest_existing "$target")"
  priv_used_sudo=0
  if [ -w "$probe" ]; then
    note "running: $(quote_cmd "$@")"
    "$@"
    return
  fi
  note "$probe is not writable by $(id -un) ($(find "$probe" -maxdepth 0 -exec ls -ld {} \; | awk '{print $1, $3, $4}')), so this step needs root. Running: $(quote_cmd "${sudo_cmd[@]}" "$@")"
  note "(sudo may ask for your password. If it cannot prompt here, run that command in a terminal yourself, then re-run this script.)"
  priv_used_sudo=1
  if ! "${sudo_cmd[@]}" "$@"; then
    note "the sudo step failed: $(quote_cmd "${sudo_cmd[@]}" "$@")"
    return 1
  fi
}

if [ "$do_uninstall" = 1 ]; then
  if [ -e "$install_dir/extyntcore.plugin" ]; then
    priv "$install_dir" rm -rf "$install_dir/extyntcore.plugin" || die "could not remove $install_dir/extyntcore.plugin"
    note "removed $install_dir/extyntcore.plugin"
    if [ -d "$install_dir" ] && [ -z "$(ls -A "$install_dir")" ]; then priv "$(dirname "$install_dir")" rmdir "$install_dir" || true; fi
  else
    note "nothing at $install_dir/extyntcore.plugin"
  fi
  note "Quit After Effects first if it was running; also delete ~/Library/Application Support/extynt/native.json if it lingers."
  exit 0
fi

# ---- prerequisites --------------------------------------------------------------------------
[ "$(uname -s)" = "Darwin" ] || die "this script builds the macOS plugin and must run on a Mac (the pure-core tests run anywhere)."

xcode_path="$(xcode-select -p 2>/dev/null || true)"
[ -n "$xcode_path" ] || die "Xcode command line tools are not installed. Run: xcode-select --install   (Rez, needed for the PiPL, ships with full Xcode: install it from the App Store, then: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer)"
xcrun --find clang++ >/dev/null 2>&1 || die "clang++ not found via xcrun. Reinstall the command line tools: xcode-select --install"
rez="$(xcrun --find Rez 2>/dev/null || true)"
[ -n "$rez" ] || die "Rez not found (the PiPL cannot be compiled without it). Install full Xcode and run: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer ; then sudo xcodebuild -license accept"
command -v cmake >/dev/null 2>&1 || die "cmake not found. Install it: brew install cmake"
cmake_version="$(cmake --version | head -1 | sed 's/[^0-9.]//g')"
note "toolchain: $(xcrun clang++ --version | head -1); cmake $cmake_version; Rez at $rez"

[ -n "${AE_SDK_ROOT:-}" ] || die "AE_SDK_ROOT is not set. Export the path of the unpacked After Effects SDK (the folder that contains Examples/), e.g. export AE_SDK_ROOT=\"\$HOME/SDKs/AdobeAfterEffectsSDK_26.5_MacOS\""
if [ -f "$AE_SDK_ROOT/Examples/Headers/AE_GeneralPlug.h" ]; then :
elif [ -f "$AE_SDK_ROOT/Headers/AE_GeneralPlug.h" ]; then :
else die "AE_SDK_ROOT=$AE_SDK_ROOT has no Examples/Headers/AE_GeneralPlug.h. Point it at the unpacked SDK folder (the one that contains Examples/)."; fi
[ -f "$AE_SDK_ROOT/Examples/Resources/AE_General.r" ] || [ -f "$AE_SDK_ROOT/Resources/AE_General.r" ] || die "AE_General.r missing under $AE_SDK_ROOT (needed by Rez). Is this the full SDK download?"

sign_id=""
if [ "$do_sign" = 1 ]; then
  sign_id="${EXTYNT_CODESIGN_ID:-}"
  if [ -z "$sign_id" ]; then
    echo "build-mac.sh: ERROR: EXTYNT_CODESIGN_ID is not set." >&2
    echo "  Available code-signing identities on this Mac:" >&2
    security find-identity -v -p codesigning 2>&1 | sed 's/^/    /' >&2 || true
    echo "  Export one, e.g.: export EXTYNT_CODESIGN_ID=\"Developer ID Application: Your Name (TEAMID)\"" >&2
    echo "  Or pass --no-sign for an ad-hoc signature (fine for a test on this same Mac)." >&2
    exit 1
  fi
  identities="$(security find-identity -v -p codesigning 2>/dev/null || true)"
  grep -qF "$sign_id" <<<"$identities" || die "signing identity not found in the keychain: $sign_id (list them with: security find-identity -v -p codesigning)"
fi

# ---- configure + build -------------------------------------------------------------------------
[ "$do_clean" = 1 ] && rm -rf "$build_dir"
note "configuring in $build_dir (universal arm64+x86_64, macOS $deployment_target+, plugin version $plugin_version, dev library $dev_library)"
cmake -S "$here" -B "$build_dir" \
  -DCMAKE_BUILD_TYPE=Release \
  -DEXTYNT_BUILD_PLUGIN=ON -DEXTYNT_BUILD_TESTS=ON \
  -DAE_SDK_ROOT="$AE_SDK_ROOT" \
  -DEXTYNT_PLUGIN_VERSION="$plugin_version" \
  -DEXTYNT_DEV_LIBRARY="$dev_library" \
  -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64" \
  -DCMAKE_OSX_DEPLOYMENT_TARGET="$deployment_target" \
  || die "cmake configure failed (see above)."
note "building"
cmake --build "$build_dir" --parallel || die "build failed (see above). If the failure is in Rez, run with EXTYNT_REZ_VERBOSE=1."

bundle="$build_dir/ae/extyntcore.plugin"
[ -d "$bundle" ] || bundle="$(find "$build_dir" -maxdepth 4 -name extyntcore.plugin -type d | head -1 || true)"
[ -d "$bundle" ] || die "extyntcore.plugin was not produced under $build_dir"

# ---- unit tests (pure core, also runs on the Mac) -----------------------------------------------
if (cd "$build_dir" && ctest --output-on-failure >/dev/null 2>&1); then note "unit tests: pass"; else note "WARNING: unit tests failed on this Mac (ctest --output-on-failure in $build_dir). The plugin was still built."; fi

# ---- structural checks before signing ---------------------------------------------------------
exe="$bundle/Contents/MacOS/extyntcore"
[ -f "$exe" ] || die "missing executable $exe"
archs="$(lipo -archs "$exe")"
case "$archs" in *arm64*x86_64*|*x86_64*arm64*) ;; *) die "binary is not universal (archs: $archs)" ;; esac
exports="$(nm -gU "$exe" 2>/dev/null || true)"
grep -q "_EntryPointFunc" <<<"$exports" || die "EntryPointFunc is not exported from $exe (the PiPL names it; AE would refuse to load the plugin)"
[ -s "$bundle/Contents/Resources/extyntcore.rsrc" ] || die "PiPL resource missing: $bundle/Contents/Resources/extyntcore.rsrc (the Rez step did not produce it)"
plutil -lint "$bundle/Contents/Info.plist" >/dev/null || die "Info.plist is invalid"
grep -q "AEgx" "$bundle/Contents/Info.plist" || die "Info.plist lacks CFBundlePackageType AEgx"
note "bundle ok: archs=$archs, EntryPointFunc exported, PiPL present ($(wc -c < "$bundle/Contents/Resources/extyntcore.rsrc" | tr -d ' ') bytes)"

# ---- sign -----------------------------------------------------------------------------------------
if [ "$do_sign" = 1 ]; then
  note "signing with: $sign_id"
  codesign --force --sign "$sign_id" --options runtime --timestamp "$bundle" || die "codesign failed (is the identity valid and the keychain unlocked? try: security unlock-keychain)"
else
  note "ad-hoc signing (--no-sign)"
  codesign --force --sign - "$bundle" || die "ad-hoc codesign failed"
fi
codesign --verify --strict --verbose=2 "$bundle" || die "signature verification failed"
codesign -dv "$bundle" 2>&1 | sed 's/^/    /'

note "built: $bundle"

# ---- install --------------------------------------------------------------------------------------
if [ "$do_install" = 1 ]; then
  ae_app="$applications_dir/Adobe After Effects $ae_year"
  # A leftover folder from an uninstalled version has no app inside; installing a plugin there would never load.
  [ -d "$ae_app/Adobe After Effects $ae_year.app" ] || die "\"$ae_app/Adobe After Effects $ae_year.app\" not found. Pass --ae-year for the installed version (ls /Applications | grep 'After Effects')."
  pgrep -x "After Effects" >/dev/null 2>&1 && note "WARNING: After Effects is running; quit and relaunch it to load the plugin."
  command -v ditto >/dev/null 2>&1 || die "ditto not found (it ships with macOS)"
  [ -d "$install_dir" ] || priv "$install_dir" mkdir -p "$install_dir" || die "cannot create $install_dir (or use the shared folder: /Library/Application Support/Adobe/Common/Plug-ins/7.0/MediaCore/)"
  [ ! -e "$install_dir/extyntcore.plugin" ] || priv "$install_dir" rm -rf "$install_dir/extyntcore.plugin" || die "cannot replace the old $install_dir/extyntcore.plugin"
  priv "$install_dir" ditto "$bundle" "$install_dir/extyntcore.plugin" || die "copy failed"
  copied_with_sudo="$priv_used_sudo"
  priv "$install_dir/extyntcore.plugin" xattr -dr com.apple.quarantine "$install_dir/extyntcore.plugin" || true
  if [ "$copied_with_sudo" = 1 ]; then
    # The copy ran as root but ditto kept the build output's owner, so the installed bundle would belong to this user inside
    # a root-owned folder. Run unconditionally with sudo: the bundle is user-owned, so priv would find it writable and skip sudo.
    note "the copy ran as root, which left the bundle owned by $(id -un); giving it to root:wheel like $install_dir. Running: $(quote_cmd "${sudo_cmd[@]}" chown -R root:wheel "$install_dir/extyntcore.plugin")"
    "${sudo_cmd[@]}" chown -R root:wheel "$install_dir/extyntcore.plugin" || die "could not hand $install_dir/extyntcore.plugin to root:wheel (run: sudo chown -R root:wheel \"$install_dir/extyntcore.plugin\")"
  fi
  note "installed to $install_dir/extyntcore.plugin. Relaunch After Effects, then check: cat \"\$HOME/Library/Application Support/extynt/native-core.log\""
else
  note "not installed. To install: re-run with --install, or copy the bundle into \"$install_dir/\""
fi
