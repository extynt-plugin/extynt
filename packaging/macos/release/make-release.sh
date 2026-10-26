#!/usr/bin/env bash
set -euo pipefail
# Builds the release bundle and the signed plugin, wraps them in a system-domain installer package, signs it with
# Developer ID Installer, notarizes it and staples the ticket.
#   packaging/macos/release/make-release.sh [--no-notarize] [--dry-run] [--bundle ARCHIVE]
#   --no-notarize skips notarytool and stapler; --dry-run prints the plan and builds nothing; --bundle reuses a tarball
# Environment (see packaging/macos/release/README.md): AE_SDK_ROOT (required to build the plugin), EXTYNT_SIGN_APP and
# EXTYNT_SIGN_INSTALLER (identities, auto-detected when the keychain holds one), EXTYNT_NOTARY_PROFILE (default
# extynt-notary), EXTYNT_ARCH (universal, arm64 or x64), EXTYNT_RELEASE_OUT, EXTYNT_SKIP_CHECK=1, EXTYNT_ALLOW_DIRTY=1.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
here="${repo_root}/packaging/macos/release"
no_notarize=0
dry_run=0
bundle_archive=""

die() { echo "make-release.sh: $*" >&2; exit 1; }
note() { echo "make-release.sh: $*"; }

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --no-notarize) no_notarize=1 ;;
      --dry-run) dry_run=1 ;;
      --bundle) shift; bundle_archive="${1:-}"; [[ -f "${bundle_archive}" ]] || die "--bundle needs an existing archive: ${bundle_archive}" ;;
      -h|--help) sed -n '5,19p' "${BASH_SOURCE[0]}"; exit 0 ;;
      *) die "unknown option: $1 (try --help)" ;;
    esac
    shift
  done
}

# detect_identity KIND: the one "Developer ID <KIND>: ..." identity in the keychain, or an error naming what to export.
detect_identity() {
  local kind="$1" variable="$2" found count
  found="$(security find-identity -v -p basic 2>/dev/null | grep -F "\"Developer ID ${kind}:" | sed -n 's/.*"\(.*\)".*/\1/p' | sort -u || true)"
  count="$(printf '%s' "${found}" | grep -c . || true)"
  if [[ "${count}" == 1 ]]; then printf '%s' "${found}"; return 0; fi
  if [[ "${count}" == 0 ]]; then echo "No \"Developer ID ${kind}\" identity in the keychain. Install the certificate or export ${variable}." >&2; return 1; fi
  printf 'More than one "Developer ID %s" identity:\n%s\nExport %s with the one to use.\n' "${kind}" "${found}" "${variable}" >&2
  return 1
}

resolve_identities() {
  sign_app="${EXTYNT_SIGN_APP:-}"
  sign_installer="${EXTYNT_SIGN_INSTALLER:-}"
  if [[ -z "${sign_app}" ]]; then sign_app="$(detect_identity Application EXTYNT_SIGN_APP)" || exit 1; fi
  if [[ -z "${sign_installer}" ]]; then sign_installer="$(detect_identity Installer EXTYNT_SIGN_INSTALLER)" || exit 1; fi
  case "${sign_app}" in "Developer ID Application:"*) ;; *) die "EXTYNT_SIGN_APP must name a \"Developer ID Application\" identity: ${sign_app}" ;; esac
  case "${sign_installer}" in "Developer ID Installer:"*) ;; *) die "EXTYNT_SIGN_INSTALLER must name a \"Developer ID Installer\" identity: ${sign_installer}" ;; esac
}

resolve_product() {
  version="$(sed -n 's/^  "version": "\([^"]*\)",$/\1/p' "${repo_root}/package.json" | head -n 1)"
  [[ -n "${version}" ]] || die "No product version in package.json."
  arch_choice="${EXTYNT_ARCH:-universal}"
  case "${arch_choice}" in
    universal) arch_suffix=""; bundle_name="extynt-${version}-macos"; host_arches="arm64,x86_64"; bundle_arches="arm64 x64" ;;
    arm64) arch_suffix="-arm64"; bundle_name="extynt-${version}-macos-arm64"; host_arches="arm64"; bundle_arches="arm64" ;;
    x64) arch_suffix="-x64"; bundle_name="extynt-${version}-macos-x64"; host_arches="x86_64"; bundle_arches="x64" ;;
    *) die "EXTYNT_ARCH must be universal, arm64 or x64." ;;
  esac
  pkg_name="extynt-${version}${arch_suffix}.pkg"
  notary_profile="${EXTYNT_NOTARY_PROFILE:-extynt-notary}"
  out_dir="${EXTYNT_RELEASE_OUT:-${PWD}/release-out}"
}

print_plan() {
  note "plan (dry run, nothing is built):"
  echo "  package            ${out_dir}/${pkg_name}"
  echo "  plugin signed by   ${sign_app}"
  echo "  package signed by  ${sign_installer}"
  if [[ "${no_notarize}" == 1 ]]; then echo "  notarization       skipped (--no-notarize)"; else echo "  notarization       profile ${notary_profile}, then stapler"; fi
  if [[ -n "${bundle_archive}" ]]; then echo "  bundle             ${bundle_archive}"; else echo "  bundle             built by scripts/build-mac-bundle.sh (EXTYNT_ARCH=${arch_choice})"; fi
}

require_tools() {
  local tool
  [[ "$(uname -s)" == "Darwin" ]] || die "this script runs on macOS only (use --dry-run elsewhere)."
  for tool in pkgbuild productbuild productsign codesign ditto xcrun lipo pkgutil shasum; do command -v "${tool}" >/dev/null 2>&1 || die "${tool} not found; install the Xcode command line tools."; done
  [[ -n "${AE_SDK_ROOT:-}" ]] || die "AE_SDK_ROOT is not set; point it at the unpacked After Effects SDK."
  if [[ "${no_notarize}" == 0 ]]; then
    xcrun notarytool history --keychain-profile "${notary_profile}" >/dev/null 2>&1 || die "no notarytool keychain profile named ${notary_profile} (see release/README.md), or pass --no-notarize."
  fi
}

# The third-party notices must be in the bundle.
verify_notices() {
  local dir="$1"
  [[ -s "${dir}/NOTICE" && -s "${dir}/licenses/xxhash-LICENSE.txt" && -s "${dir}/licenses/node-LICENSE.txt" ]] || die "the bundle lacks NOTICE or its licenses/ folder (xxhash, node)."
}

build_bundle() {
  if [[ -n "${bundle_archive}" ]]; then archive="${bundle_archive}"; return; fi
  archive="${repo_root}/artifacts/${bundle_name}.tar.gz"
  note "building the release bundle (${arch_choice})"
  (cd "${repo_root}" && EXTYNT_ARCH="${arch_choice}" scripts/build-mac-bundle.sh)
}

# The bundle must be this checkout's version and carry the Node runtimes of the release architecture: its sidecar is a copy
# of apps/sidecar/package.json, and its runtime/ holds one node-v*-darwin-<arch>.tar.xz per architecture.
verify_bundle_identity() {
  local dir="$1" bundle_version arches
  bundle_version="$(sed -n 's/^ *"version": "\([^"]*\)".*/\1/p' "${dir}/sidecar/apps/sidecar/package.json" 2>/dev/null | head -n 1)"
  arches="$(find "${dir}/runtime" -maxdepth 1 -name 'node-v*-darwin-*.tar.xz' 2>/dev/null | sed 's/.*-darwin-\([^.]*\)\.tar\.xz$/\1/' | sort | paste -sd' ' -)"
  if [[ "${bundle_version}" != "${version}" || "${arches}" != "${bundle_arches}" ]]; then
    die "the bundle is version ${bundle_version:-unknown} with runtimes [${arches:-none}]; this checkout is ${version} for EXTYNT_ARCH=${arch_choice} (runtimes [${bundle_arches}]). Build a matching bundle or pass a matching --bundle."
  fi
}

extract_bundle() {
  tar -xzf "${archive}" -C "${work}"
  bundle="${work}/${bundle_name}"
  [[ -d "${bundle}" ]] || die "the archive does not contain ${bundle_name} (this checkout is ${version} for EXTYNT_ARCH=${arch_choice})."
  verify_bundle_identity "${bundle}"
  (cd "${bundle}" && shasum -a 256 -c --quiet SHA256SUMS) || die "bundle checksums failed before packaging."
  verify_notices "${bundle}"
}

verify_plugin_signature() {
  local plugin="$1" details
  codesign --verify --strict --deep --verbose=2 "${plugin}" || die "the plugin signature does not verify: ${plugin}"
  details="$(codesign -dvv "${plugin}" 2>&1)"
  grep -q 'Authority=Developer ID Application' <<<"${details}" || die "the plugin is not signed with a Developer ID Application identity."
  grep -q 'flags=.*runtime' <<<"${details}" || die "the plugin has no hardened runtime."
  grep -q 'Timestamp=' <<<"${details}" || die "the plugin signature has no secure timestamp."
}

build_plugin() {
  local plugin
  note "building and signing the plugin"
  EXTYNT_CODESIGN_ID="${sign_app}" EXTYNT_BUILD_DIR="${work}/plugin-build" "${repo_root}/native/extynt-core/build-mac.sh" --clean
  plugin="${work}/plugin-build/ae/extyntcore.plugin"
  [[ -d "${plugin}" ]] || plugin="$(find "${work}/plugin-build" -maxdepth 4 -name extyntcore.plugin -type d | head -n 1)"
  [[ -d "${plugin}" ]] || die "build-mac.sh did not produce extyntcore.plugin."
  verify_plugin_signature "${plugin}"
  mkdir -p "${bundle}/plugin"
  ditto --norsrc --noextattr --noqtn "${plugin}" "${bundle}/plugin/extyntcore.plugin"
  verify_plugin_signature "${bundle}/plugin/extyntcore.plugin"
}

refresh_checksums() {
  (cd "${bundle}" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 shasum -a 256 > "${work}/SHA256SUMS.new")
  mv "${work}/SHA256SUMS.new" "${bundle}/SHA256SUMS"
}

# extynt Catalogue.app (catalogue-window/): the window that learns the installed effects right after install. A
# universal app signed like the plugin, carried in the bundle; postinstall opens it as the signed-in user.
build_catalogue_window() {
  local source="${here}/catalogue-window" app="${bundle}/catalogue-window/extynt Catalogue.app"
  note "building the catalogue window"
  mkdir -p "${app}/Contents/MacOS"
  sed "s/__VERSION__/${version}/g" "${source}/Info.plist" > "${app}/Contents/Info.plist"
  xcrun clang -fobjc-arc -Wall -Werror -arch arm64 -arch x86_64 -mmacosx-version-min=13.5 -framework Cocoa \
    -o "${app}/Contents/MacOS/extynt Catalogue" "${source}/CatalogueWindow.m" \
    "${source}"/Catalogue{Theme,Words,Bar,Receipt,View}.m
  codesign --force --timestamp --options runtime --sign "${sign_app}" "${app}"
  codesign --verify --strict "${app}" || die "the catalogue window does not verify."
}

build_package() {
  local root="${work}/pkgroot" scripts="${work}/scripts" resources="${work}/resources"
  mkdir -p "${root}/Library/Application Support/extynt/installer/${version}" "${scripts}" "${resources}"
  ditto --norsrc --noextattr --noqtn "${bundle}" "${root}/Library/Application Support/extynt/installer/${version}"
  sed "s/__VERSION__/${version}/g" "${here}/scripts/postinstall" > "${scripts}/postinstall"
  cp "${here}/scripts/preinstall" "${scripts}/preinstall"
  chmod 755 "${scripts}/postinstall" "${scripts}/preinstall"
  pkgbuild --quiet --root "${root}" --identifier com.extynt.installer --version "${version}" --install-location / --scripts "${scripts}" --ownership recommended "${work}/extynt-payload.pkg"
  cp -R "${here}"/text/*.lproj "${resources}/"
  cp "${here}/text/en.lproj/welcome.html" "${here}/text/en.lproj/conclusion.html" "${here}/branding/background.png" "${here}/branding/background-dark.png" "${resources}/"
  sed -e "s/__VERSION__/${version}/g" -e "s/__HOST_ARCHITECTURES__/${host_arches}/g" "${here}/distribution.xml" > "${work}/distribution.xml"
  productbuild --quiet --distribution "${work}/distribution.xml" --resources "${resources}" --package-path "${work}" "${work}/unsigned.pkg"
}

sign_package() {
  mkdir -p "${out_dir}"
  final_pkg="${out_dir}/${pkg_name}"
  productsign --timestamp --sign "${sign_installer}" "${work}/unsigned.pkg" "${final_pkg}"
  pkgutil --check-signature "${final_pkg}" | grep -q 'Developer ID Installer' || die "the package is not signed with a Developer ID Installer identity."
}

notarize_package() {
  local log="${work}/notarytool.log"
  if [[ "${no_notarize}" == 1 ]]; then note "skipping notarization (--no-notarize); Gatekeeper blocks this package on a downloaded copy."; return; fi
  xcrun notarytool submit "${final_pkg}" --keychain-profile "${notary_profile}" --wait | tee "${log}"
  grep -q 'status: Accepted' "${log}" || die "notarization was not accepted; read the log with: xcrun notarytool log <id> --keychain-profile ${notary_profile}"
  # The ticket is fetched from Apple's CDN, which drops connections now and then; a few tries before giving up.
  local try
  for try in 1 2 3 4; do
    if xcrun stapler staple "${final_pkg}"; then break; fi
    [[ "${try}" == 4 ]] && die "stapling failed four times; retry with: xcrun stapler staple ${final_pkg}"
    sleep 15
  done
  xcrun stapler validate "${final_pkg}"
  spctl --assess --type install -vv "${final_pkg}"
}

finish() {
  (cd "${out_dir}" && shasum -a 256 "${pkg_name}" > "${pkg_name}.sha256")
  note "created ${final_pkg}"
}

main() {
  parse_args "$@"
  resolve_identities
  resolve_product
  if [[ "${dry_run}" == 1 ]]; then print_plan; return 0; fi
  require_tools
  build_bundle
  work="$(mktemp -d)"
  trap 'rm -rf "${work}"' EXIT
  extract_bundle
  build_plugin
  build_catalogue_window
  refresh_checksums
  build_package
  sign_package
  notarize_package
  finish
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then main "$@"; fi
