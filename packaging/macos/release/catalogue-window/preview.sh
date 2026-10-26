#!/usr/bin/env bash
set -euo pipefail

# Previews the installer's look without installing anything.
#   preview.sh [out-dir]           screenshots of the Introduction and Summary pages and of the catalogue page in each
#                                  canned state, light and dark (default out-dir: $TMPDIR/extynt-installer-preview)
#   preview.sh --window [dark]     the catalogue page in a window, replaying the canned states live
#   preview.sh --backgrounds       re-renders branding/background.png and background-dark.png from background.html
#   preview.sh --pkg [out-dir]     also builds an unsigned probe package (no payload, no scripts) to open the pages and
#                                  background in the real Installer.app

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
release="$(dirname "${here}")"
branding="${release}/branding"

die() { echo "preview.sh: $*" >&2; exit 1; }

build_host() {
  host="${work}/PreviewHost"
  xcrun clang -fobjc-arc -Wall -Werror -mmacosx-version-min=13.5 -framework Cocoa -framework WebKit \
    -o "${host}" "${here}/preview/PreviewHost.m" "${here}/preview/CannedStatus.m" \
    "${here}"/Catalogue{Theme,Words,Bar,Receipt,View}.m
}

render_backgrounds() {
  "${host}" html "${branding}/background.html" "${branding}/background.png" light 700 480 2
  "${host}" html "${branding}/background.html" "${branding}/background-dark.png" dark 700 480 2 theme=dark
  sips -s dpiWidth 144 -s dpiHeight 144 "${branding}/background.png" "${branding}/background-dark.png" > /dev/null
  echo "Rendered ${branding}/background.png and background-dark.png"
}

screenshots() {
  local theme
  mkdir -p "${out}"
  for theme in light dark; do
    "${host}" text "${release}/text/en.lproj/welcome.html" "${out}/welcome-${theme}.png" "${theme}" 416 329 2
    "${host}" text "${release}/text/en.lproj/conclusion.html" "${out}/conclusion-${theme}.png" "${theme}" 416 329 2
  done
  "${host}" pane "${out}" light "${branding}/background.png"
  "${host}" pane "${out}" dark "${branding}/background-dark.png"
  echo "Screenshots in ${out}"
}

# One probe package: the release's pages and background, no payload.
probe_package() {
  local dir="${work}/probe" backgrounds
  mkdir -p "${dir}/resources"
  cp "${release}/text/en.lproj/welcome.html" "${release}/text/en.lproj/conclusion.html" "${branding}/background.png" "${branding}/background-dark.png" "${dir}/resources/"
  pkgbuild --quiet --nopayload --identifier com.extynt.preview --version 0 "${dir}/preview.pkg"
  backgrounds='<background file="background.png" alignment="bottomleft" scaling="none"/>'
  backgrounds+='<background-darkAqua file="background-dark.png" alignment="bottomleft" scaling="none"/>'
  cat > "${dir}/distribution.xml" << EOF
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
    <title>extynt preview</title>
    ${backgrounds}
    <welcome file="welcome.html" mime-type="text/html"/>
    <conclusion file="conclusion.html" mime-type="text/html"/>
    <options customize="never" require-scripts="false"/>
    <domains enable_anywhere="false" enable_currentUserHome="true" enable_localSystem="false"/>
    <choices-outline><line choice="preview"/></choices-outline>
    <choice id="preview" visible="false" title="preview"><pkg-ref id="com.extynt.preview"/></choice>
    <pkg-ref id="com.extynt.preview" version="0" onConclusion="none">preview.pkg</pkg-ref>
</installer-gui-script>
EOF
  productbuild --quiet --distribution "${dir}/distribution.xml" --resources "${dir}/resources" --package-path "${dir}" "${out}/extynt-preview.pkg"
}

work="$(mktemp -d "${TMPDIR:-/tmp}/extynt-preview.XXXXXX")"
trap 'rm -rf "${work}"' EXIT
out="${TMPDIR:-/tmp}/extynt-installer-preview"
mode=screenshots
case "${1:-}" in
  --window) build_host; "${host}" window "${2:-light}"; exit 0 ;;
  --backgrounds) build_host; render_backgrounds; exit 0 ;;
  --pkg) mode=pkg; out="${2:-${out}}" ;;
  -*) die "unknown option $1" ;;
  ?*) out="$1" ;;
esac
[[ -f "${branding}/background.png" ]] || die "run preview.sh --backgrounds first"
build_host
screenshots
if [[ "${mode}" == pkg ]]; then
  probe_package
  echo "Open ${out}/extynt-preview.pkg; quit the Installer before Install."
fi
