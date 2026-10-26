#!/usr/bin/env bash
set -euo pipefail
# Checks an installation: the served UI, the host library, the sidecar and (when After Effects is running) the host link.
# Usage: ./verify.sh [token]        (the token is read from session.json when omitted)

state_root="${HOME}/Library/Application Support/extynt"
session_file="${state_root}/session.json"
root_library="${EXTYNT_ROOT_HOST_DIR:-/Library/Application Support/extynt/host}"
dev_library_dir="${state_root}/host"
ui_dir="${state_root}/ui"
failures=0

pass() { echo "OK    $*"; }
fail() { echo "FAIL  $*" >&2; failures=$((failures + 1)); }
info() { echo "info  $*"; }

# One field of the compact JSON the installer and the sidecar write.
json_field() { sed -n "s/.*\"$1\": *\"\\{0,1\\}\\([^\",}]*\\).*/\\1/p" | head -n 1; }

check_ui_files() {
  local manifest="${ui_dir}/ui-manifest.json" listing digest path count=0
  if [[ ! -f "${manifest}" ]]; then fail "served UI missing: ${manifest}"; return; fi
  listing="$(node_free_listing "${manifest}")"
  while read -r digest path; do
    [[ -n "${path}" ]] || continue
    count=$((count + 1))
    if [[ ! -f "${ui_dir}/${path}" ]]; then fail "served UI file missing: ${path}"; continue; fi
    if [[ "$(shasum -a 256 "${ui_dir}/${path}" | awk '{print $1}')" != "${digest}" ]]; then fail "served UI file differs from ui-manifest.json: ${path}"; fi
  done <<<"${listing}"
  if [[ "${count}" == 0 ]]; then fail "ui-manifest.json lists no files"; return; fi
  if [[ "$(find "${ui_dir}" -type f | wc -l | tr -d ' ')" != "$((count + 1))" ]]; then fail "${ui_dir} holds files that ui-manifest.json does not list"; fi
  pass "served UI: ${count} files in ${ui_dir} (build $(json_field buildId <"${manifest}"))"
}

# ui-manifest.json is pretty-printed: "path" and "sha256" sit on consecutive lines inside each file entry.
node_free_listing() {
  awk '/"path":/ { gsub(/[",]/, "", $2); path = $2 } /"sha256":/ { gsub(/[",]/, "", $2); print $2, path }' "$1"
}

check_library_at() {
  local label="$1" directory="$2" manifest="$2/manifest.json" entry version owner
  if [[ ! -f "${manifest}" ]]; then info "${label} host library: not installed (${directory})"; return 1; fi
  entry="$(json_field entry <"${manifest}")"
  version="$(json_field version <"${manifest}")"
  if [[ ! -f "${directory}/${entry}" ]]; then fail "${label} host library: entry ${entry} missing in ${directory}"; return 0; fi
  if [[ -z "$(find "${directory}" -maxdepth 1 -name '*.jsx' ! -name "${entry}" -print -quit)" ]]; then fail "${label} host library: no part files beside ${entry}"; return 0; fi
  owner="$(stat -f %Su "${manifest}" 2>/dev/null || true)"
  pass "${label} host library ${version}: ${directory} ($(find "${directory}" -maxdepth 1 -name '*.jsx' | wc -l | tr -d ' ') jsx files, owner ${owner:-unknown})"
  LIBRARY_OWNER="${owner}"
  LIBRARY_VERSION="${version}"
}

check_host_library() {
  local root_found=0 dev_found=0 root_owner="" root_version="" dev_version=""
  LIBRARY_OWNER=""; LIBRARY_VERSION=""
  if check_library_at "release (root)" "${root_library}"; then root_found=1; root_owner="${LIBRARY_OWNER}"; root_version="${LIBRARY_VERSION}"; fi
  if check_library_at "development (user)" "${dev_library_dir}"; then dev_found=1; dev_version="${LIBRARY_VERSION}"; fi
  if [[ "${root_found}" == 0 && "${dev_found}" == 0 ]]; then fail "no host library installed; run ./install.sh (or ./install.sh --dev-library)"; fi
  if [[ "${root_found}" == 1 && "${root_owner}" != "root" ]]; then fail "the release host library is not owned by root (owner ${root_owner:-unknown}); a release plugin build may refuse it"; fi
  if [[ "${root_found}" == 1 && "${dev_found}" == 1 && "${root_version}" != "${dev_version}" ]]; then info "the two host libraries differ (${root_version} against ${dev_version}); a --dev-library plugin build reads the first one it finds"; fi
}

read_session() {
  if [[ -f "${session_file}" && -z "${AE_BRIDGE_URL:-}" ]]; then
    session_port="$(json_field port <"${session_file}")"
  fi
  if [[ -z "${AE_BRIDGE_TOKEN:-${1:-}}" && -f "${session_file}" ]]; then
    token="$(json_field token <"${session_file}")"
  fi
  endpoint="${AE_BRIDGE_URL:-http://127.0.0.1:${session_port:-3210}}"
}

wait_for_sidecar() {
  health=""
  for attempt in $(seq 1 30); do
    read_session "${1:-}"
    if [[ -n "${token}" ]]; then
      health="$(curl --fail --silent --show-error -H "Authorization: Bearer ${token}" "${endpoint}/health" 2>/dev/null || true)"
      [[ -n "${health}" ]] && break
    fi
    sleep 1
  done
  if [[ -z "${token}" ]]; then fail "no extynt session token was readable at ${session_file} within 30 s"; return 1; fi
  if [[ -z "${health}" ]]; then fail "${endpoint}/health did not answer within 30 s"; return 1; fi
  printf '%s\n' "${health}"
  pass "sidecar answers /health (after ${attempt} attempt(s))"
}

check_served_page() {
  local headers expected_build served_build manifest_main
  headers="$(curl --silent --show-error --dump-header - --output /dev/null "${endpoint}/ui/" 2>/dev/null || true)"
  if ! grep -q '^HTTP/[0-9.]* 200' <<<"${headers}"; then fail "${endpoint}/ui/ did not answer 200 without a token"; return; fi
  if ! grep -qi '^content-security-policy:' <<<"${headers}"; then fail "${endpoint}/ui/ carries no Content-Security-Policy"; fi
  manifest_main="$(node_free_listing "${ui_dir}/ui-manifest.json" | awk '$2 == "main.js" {print $1}')"
  if [[ "$(curl --silent "${endpoint}/ui/main.js" | shasum -a 256 | awk '{print $1}')" != "${manifest_main}" ]]; then fail "${endpoint}/ui/main.js is not the installed main.js (a different sidecar may hold the port)"; fi
  expected_build="$(json_field buildId <"${ui_dir}/ui-manifest.json")"
  served_build="$(curl --silent -H "Authorization: Bearer ${token}" "${endpoint}/v1/ui/bootstrap" | json_field uiBuild)"
  if [[ "${served_build}" == "${expected_build}" ]]; then pass "the sidecar serves UI build ${served_build} from ${ui_dir}"; else fail "bootstrap reports UI build '${served_build}', the installed manifest says '${expected_build}'"; fi
}

report_host() {
  local plugin found=0
  for plugin in "/Applications/Adobe After Effects "*"/Plug-ins/extynt/extyntcore.plugin"; do
    if [[ -d "${plugin}" ]]; then info "native plugin installed: ${plugin}"; found=1; fi
  done
  if [[ "${found}" == 0 ]]; then info "no extyntcore.plugin under /Applications/Adobe After Effects */Plug-ins/extynt (native/extynt-core/build-mac.sh --install)"; fi
  if [[ -f "${state_root}/native.json" ]]; then info "native.json present: After Effects with the plugin is (or was) running"; else info "native.json absent: After Effects is not running with the plugin; the sidecar reports HOST_OFFLINE until it is"; fi
}

session_port=""
token="${AE_BRIDGE_TOKEN:-${1:-}}"
endpoint=""
check_ui_files
check_host_library
if wait_for_sidecar "${1:-}"; then
  check_served_page
fi
report_host
if [[ "${failures}" != 0 ]]; then echo "${failures} check(s) failed." >&2; exit 1; fi
echo "All checks passed."
