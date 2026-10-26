#!/usr/bin/env bash
set -euo pipefail

# Builds the macOS transfer bundle: a clean build of the sidecar, staged from an allowlist shared with the Windows bundle
# (package.json plus built dist/src of apps/sidecar and each workspace package, nothing else of the checkout), the pinned
# Node runtimes, the plugin, the served UI, the host library and third-party notices, with checksums. Refuses a dirty tree
# unless EXTYNT_ALLOW_DIRTY=1.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if command -v sha256sum >/dev/null 2>&1; then
  sha256_command=(sha256sum)
elif command -v shasum >/dev/null 2>&1; then
  sha256_command=(shasum -a 256)
else
  echo "No SHA-256 tool found: install coreutils (sha256sum) or use macOS (shasum)." >&2
  exit 1
fi
sha256() { "${sha256_command[@]}" "$@" | cut -d' ' -f1; }
# A plain digest comparison rather than `-c`, so the same code works for both
# tools and always yields the two-field "<digest>  <path>" form that
# packaging/macos/verify-checksums.sh reads back with shasum.
sha256_matches() { [[ "$(sha256 "$2")" == "$1" ]]; }
version="$(sed -n 's/^  "version": "\([^"]*\)",$/\1/p' "${repo_root}/package.json" | head -n 1)"
if [[ -z "${version}" ]]; then echo "No product version in package.json." >&2; exit 1; fi
artifact_dir="${repo_root}/artifacts"
arch_choice="${EXTYNT_ARCH:-arm64}"
case "${arch_choice}" in universal) arches="arm64 x64"; bundle_name="extynt-${version}-macos" ;; arm64|x64) arches="${arch_choice}"; bundle_name="extynt-${version}-macos-${arch_choice}" ;; *) echo "EXTYNT_ARCH must be universal, arm64, or x64." >&2; exit 1 ;; esac
work_dir="$(mktemp -d)"
bundle_dir="${work_dir}/${bundle_name}"
archive="${artifact_dir}/${bundle_name}.tar.gz"

trap 'rm -rf "${work_dir}"' EXIT
mkdir -p "${artifact_dir}" "${bundle_dir}/validation"

if [[ "${EXTYNT_ALLOW_DIRTY:-}" != "1" ]]; then
  if [ -n "$(git -C "${repo_root}" status --porcelain)" ]; then
    echo "Uncommitted changes detected. Commit or stage your changes, or set EXTYNT_ALLOW_DIRTY=1 to override." >&2
    exit 1
  fi
fi

for dist_dir in "${repo_root:?}"/apps/*/dist "${repo_root:?}"/packages/*/dist "${repo_root:?}"/tools/*/dist; do
  if [[ -d "${dist_dir}" ]]; then rm -rf "${dist_dir}"; fi
done
(cd "${repo_root}" && corepack pnpm install --frozen-lockfile && corepack pnpm -w exec tsc -b && if [[ "${EXTYNT_SKIP_CHECK:-}" != "1" ]]; then node scripts/check.ts; fi && node scripts/build-panel.ts)

panel_build_id="$(sed -n 's@^/\* extynt-panel-build:\([a-f0-9]\{16\}\) \*/$@\1@p' "${repo_root}/apps/panel/main.js")"
if [[ -z "${panel_build_id}" ]]; then echo "Panel bundle has no deterministic build identity." >&2; exit 1; fi
before_panel_hash="$(sha256 "${repo_root}/apps/panel/main.js")"
(cd "${repo_root}" && node scripts/build-panel.ts)
after_panel_hash="$(sha256 "${repo_root}/apps/panel/main.js")"
if [[ "${before_panel_hash}" != "${after_panel_hash}" ]]; then echo "Panel bundle is not deterministic." >&2; exit 1; fi

(cd "${repo_root}" && node scripts/stage-sidecar.ts --bundle "${bundle_dir}")
if ! staged_links="$(find "${bundle_dir}/sidecar" -type l)"; then echo "Could not check the bundle's symlinks." >&2; exit 1; fi
if [[ -n "${staged_links}" ]]; then printf '%s\n' "${staged_links}" >&2; echo "Refusing to bundle a symlink." >&2; exit 1; fi
if ! staged_env="$(find "${bundle_dir}/sidecar" \( -name ".env" -o -name ".env.*" -o -name "llm.env" \) ! -name ".env.example")"; then echo "Could not check the bundle for .env files." >&2; exit 1; fi
if [[ -n "${staged_env}" ]]; then printf '%s\n' "${staged_env}" >&2; echo "Refusing to bundle a .env file." >&2; exit 1; fi

# shellcheck source=/dev/null
source "${repo_root}/packaging/macos/node-runtime.env"
node_cache="${XDG_CACHE_HOME:-${HOME}/.cache}/extynt/node"
mkdir -p "${node_cache}" "${bundle_dir}/runtime"
for arch in ${arches}; do
  tarball="node-v${NODE_VERSION}-darwin-${arch}.tar.xz"
  case "${arch}" in arm64) expected_var="NODE_SHA256_DARWIN_ARM64" ;; x64) expected_var="NODE_SHA256_DARWIN_X64" ;; esac
  expected="${!expected_var}"
  if [[ ! -f "${node_cache}/${tarball}" ]] || ! sha256_matches "${expected}" "${node_cache}/${tarball}"; then
    curl --fail --silent --show-error --location -o "${node_cache}/${tarball}.part" "https://nodejs.org/dist/v${NODE_VERSION}/${tarball}"
    mv "${node_cache}/${tarball}.part" "${node_cache}/${tarball}"
  fi
  if ! sha256_matches "${expected}" "${node_cache}/${tarball}"; then echo "Node runtime ${tarball} does not match its pinned SHA-256." >&2; exit 1; fi
  cp "${node_cache}/${tarball}" "${bundle_dir}/runtime/${tarball}"
done
cp "${repo_root}/packaging/macos/node-runtime.env" "${bundle_dir}/runtime/node-runtime.env"
printf '%s\n' "${NODE_VERSION}" > "${bundle_dir}/runtime/VERSION"

first_arch="${arches%% *}"
node_license_dir="${work_dir}/node-license"
mkdir -p "${node_license_dir}"
tar -xJf "${node_cache}/node-v${NODE_VERSION}-darwin-${first_arch}.tar.xz" -C "${node_license_dir}" --strip-components=1 "node-v${NODE_VERSION}-darwin-${first_arch}/LICENSE"
(cd "${repo_root}" && node scripts/stage-third-party-licenses.ts --bundle "${bundle_dir}" --node-license "${node_license_dir}/LICENSE")

mkdir -p "${bundle_dir}/sidecar-launchd"
cp \
  "${repo_root}/packaging/macos/sidecar-launchd/com.extynt.sidecar.plist.template" \
  "${repo_root}/packaging/macos/sidecar-launchd/install-sidecar.sh" \
  "${repo_root}/packaging/macos/sidecar-launchd/uninstall-sidecar.sh" \
  "${bundle_dir}/sidecar-launchd/"
chmod +x "${bundle_dir}/sidecar-launchd/install-sidecar.sh" "${bundle_dir}/sidecar-launchd/uninstall-sidecar.sh"

ui_manifest="${repo_root}/apps/panel/ui-manifest.json"
manifest_build_id="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).buildId)' "${ui_manifest}")"
if [[ "${manifest_build_id}" != "${panel_build_id}" ]]; then echo "ui-manifest.json (${manifest_build_id}) does not describe the built main.js (${panel_build_id}); run node scripts/build-panel.ts." >&2; exit 1; fi
mkdir -p "${bundle_dir}/ui"
ui_listing="${work_dir}/ui-files.txt"
node -e 'for (const file of JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).files) console.log(file.sha256 + "  " + file.path)' "${ui_manifest}" > "${ui_listing}"
while read -r digest path; do
  mkdir -p "$(dirname "${bundle_dir}/ui/${path}")"
  cp "${repo_root}/apps/panel/${path}" "${bundle_dir}/ui/${path}"
  sha256_matches "${digest}" "${bundle_dir}/ui/${path}" || { echo "apps/panel/${path} does not match ui-manifest.json; run node scripts/build-panel.ts." >&2; exit 1; }
done < "${ui_listing}"
cp "${ui_manifest}" "${bundle_dir}/ui/ui-manifest.json"
expected_ui="$( { cut -d' ' -f3- "${ui_listing}"; echo ui-manifest.json; } | sort)"
actual_ui="$(cd "${bundle_dir}/ui" && find . -type f | sed 's#^\./##' | sort)"
if [[ "${expected_ui}" != "${actual_ui}" ]]; then echo "The served UI directory differs from ui-manifest.json." >&2; exit 1; fi

(cd "${repo_root}" && node scripts/install-host-library.ts --dest "${bundle_dir}")
cp "${repo_root}/apps/panel/host/AEQUERY-LICENSE.txt" "${bundle_dir}/host/"
if [[ ! -f "${bundle_dir}/host/probe.jsx" || ! -f "${bundle_dir}/host/manifest.json" ]]; then echo "The host library has no probe.jsx or manifest.json." >&2; exit 1; fi

cp \
  "${repo_root}/packaging/macos/install.sh" \
  "${repo_root}/packaging/macos/verify.sh" \
  "${repo_root}/packaging/macos/verify-checksums.sh" \
  "${repo_root}/packaging/macos/uninstall.sh" \
  "${repo_root}/packaging/macos/README.md" \
  "${bundle_dir}/"
cp "${repo_root}/tools/native-spike/svg-import-probe.jsx" "${bundle_dir}/validation/"
chmod +x "${bundle_dir}"/*.sh

bundle_mb="$(du -sm "${bundle_dir}" | cut -f1)"
max_mb="${EXTYNT_MAX_BUNDLE_MB:-120}"
if (( bundle_mb > max_mb )); then
  echo "Bundle is ${bundle_mb} MB, over the ${max_mb} MB ceiling. Largest entries:" >&2
  du -sm "${bundle_dir}"/* "${bundle_dir}"/sidecar/* 2>/dev/null | sort -rn | head -10 >&2
  echo "Set EXTYNT_MAX_BUNDLE_MB to raise the ceiling deliberately." >&2
  exit 1
fi
echo "Bundle tree: ${bundle_mb} MB (ceiling ${max_mb} MB)"

(
  cd "${bundle_dir}"
  while IFS= read -r -d '' file; do
    digest="$(sha256 "${file}")"
    [[ -n "${digest}" ]] || { echo "Could not hash ${file}." >&2; exit 1; }
    printf "%s  %s\n" "${digest}" "${file}"
  done < <(find . -type f ! -name SHA256SUMS -print0 | sort -z) > "${bundle_dir}/SHA256SUMS"
)

tar -C "${work_dir}" -czf "${archive}" "${bundle_name}"
(cd "${artifact_dir}" && printf "%s  %s\n" "$(sha256 "${bundle_name}.tar.gz")" "${bundle_name}.tar.gz" > "${bundle_name}.tar.gz.sha256")

echo "Created ${archive}"
echo "Checksum ${archive}.sha256"
