#!/usr/bin/env bash
set -euo pipefail
# Installs the extynt sidecar, its served UI and the host jsx library for the native After Effects plugin.
#   ./install.sh                 host library to /Library/Application Support/extynt/host (one sudo step); release plugin builds read only there
#   ./install.sh --dev-library   host library to ~/Library/Application Support/extynt/host (no sudo); for build-mac.sh --dev-library plugin builds
#   ./install.sh --system-only   the root half, run by the package postinstall as root: install the host library and the plugin
#   ./install.sh --user-only     the per-user half, run by the package postinstall as the console user: the sidecar and its login service
# A release bundle carries the signed plugin (plugin/extyntcore.plugin); a developer builds and installs it with native/extynt-core/build-mac.sh --install.

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This bundle targets macOS only." >&2
  exit 1
fi

dev_library=0
mode="all"
case "${1:-}" in
  "") ;;
  --dev-library) dev_library=1 ;;
  --system-only) mode="system" ;;
  --user-only) mode="user" ;;
  *) echo "Usage: $0 [--dev-library | --system-only | --user-only]" >&2; exit 2 ;;
esac

bundle_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
state_root="${HOME}/Library/Application Support/extynt"
root_library="${EXTYNT_ROOT_HOST_DIR:-/Library/Application Support/extynt/host}"
dev_library_dir="${state_root}/host"
applications="${EXTYNT_APPLICATIONS_DIR:-/Applications}"
supported_years="2025 2026"
read -r -a sudo_cmd <<<"${EXTYNT_SUDO:-sudo}"

"${bundle_dir}/verify-checksums.sh"
for part in sidecar sidecar-launchd ui host; do
  [[ -d "${bundle_dir}/${part}" ]] || { echo "This bundle has no ${part}/ directory." >&2; exit 1; }
done

# Each word shell-quoted, so a printed command can be pasted into a terminal as it is (paths hold spaces).
quote_cmd() { printf '%q ' "$@"; }

run_plain() { "$@"; }
run_root() {
  echo "  + $(quote_cmd "${sudo_cmd[@]}" "$@")"
  "${sudo_cmd[@]}" "$@"
}

# Replaces <destination> with the bundle's host/ directory: stage beside it, swap, remove the old one. The first
# argument names the function that runs each command (run_plain, or run_root for a root-owned destination).
copy_host_library() {
  local runner="$1" destination="$2" stage old
  stage="${destination}.new.$$"
  old="${destination}.old.$$"
  "${runner}" rm -rf "${stage}" "${old}"
  "${runner}" mkdir -p "$(dirname "${destination}")"
  "${runner}" cp -R "${bundle_dir}/host" "${stage}"
  if [[ "${runner}" == run_root ]]; then
    "${runner}" chown -R root:wheel "${stage}"
    "${runner}" chmod -R go-w,a+rX "${stage}"
  fi
  if [[ -e "${destination}" ]]; then "${runner}" mv "${destination}" "${old}"; fi
  "${runner}" mv "${stage}" "${destination}"
  "${runner}" rm -rf "${old}"
  diff -qr "${bundle_dir}/host" "${destination}" >/dev/null || { echo "The installed host library does not match the verified bundle: ${destination}" >&2; return 1; }
}

# Step 3. The release plugin reads the library only from a root-owned folder, so that nothing running as the user can
# change the scripts After Effects executes.
install_host_library() {
  local version
  version="$(sed -n 's/.*"version":"\([^"]*\)".*/\1/p' "${bundle_dir}/host/manifest.json" | head -n 1)"
  if [[ "${dev_library}" == 1 ]]; then
    copy_host_library run_plain "${dev_library_dir}"
    echo "Installed the host library ${version} for development builds: ${dev_library_dir} (no administrator access)."
    echo "Only a plugin built with build-mac.sh --dev-library reads it; a release plugin build reads ${root_library}."
    return
  fi
  if [[ "${mode}" != "system" ]]; then
    echo "Administrator access is needed for one step: a release plugin build reads the host library only from ${root_library}, which must be owned by root."
    echo "Running these commands with sudo (nothing else in this installer uses it):"
  fi
  if ! copy_host_library run_root "${root_library}"; then
    echo "The host library was not installed. Re-run ./install.sh, or use ./install.sh --dev-library with a plugin built by build-mac.sh --dev-library." >&2
    return 1
  fi
  echo "Installed the host library ${version}: ${root_library} (owner root)."
}

# Copies the signed release plugin into the Plug-ins folder of every supported After Effects, owned by root like the folder.
install_plugin_into() {
  local year="$1" destination="$2/extyntcore.plugin"
  run_root mkdir -p "$2"
  run_root rm -rf "${destination}"
  run_root ditto --norsrc --noextattr --noqtn "${bundle_dir}/plugin/extyntcore.plugin" "${destination}"
  run_root chown -R root:wheel "$2"
  run_root codesign --verify --strict "${destination}" || { echo "The installed plugin signature does not verify: ${destination}" >&2; return 1; }
  echo "Installed the plugin for After Effects ${year}: ${destination}"
}

install_plugins() {
  local year app count=0
  if [[ ! -d "${bundle_dir}/plugin/extyntcore.plugin" ]]; then
    echo "This bundle carries no plugin. Build and install it: native/extynt-core/build-mac.sh --install"
    return 0
  fi
  for year in ${supported_years}; do
    app="${applications}/Adobe After Effects ${year}"
    [[ -d "${app}/Adobe After Effects ${year}.app" ]] || continue
    install_plugin_into "${year}" "${app}/Plug-ins/extynt" || return 1
    count=$((count + 1))
  done
  if [[ "${count}" == 0 ]]; then echo "No supported After Effects (${supported_years}) is installed under ${applications}; the plugin was not installed." >&2; return 1; fi
}

report_plugin() {
  local plugin plugin_found=0
  for plugin in "${applications}/Adobe After Effects "*"/Plug-ins/extynt/extyntcore.plugin"; do
    if [[ -d "${plugin}" ]]; then echo "Native plugin found: ${plugin}"; plugin_found=1; fi
  done
  if [[ "${plugin_found}" == 0 ]]; then echo "No extyntcore.plugin found under ${applications}/Adobe After Effects */Plug-ins/extynt. Build and install it: native/extynt-core/build-mac.sh --install"; fi
}

report_restart() {
  echo "Restart After Effects, then open Window > extynt. The panel loads its page from the sidecar and pairs with it automatically."
  echo "Also restart Claude Desktop / your MCP client (Claude Code, Codex) so it loads the new extynt MCP server; a client left running keeps the old one until then, and ae_status will say so."
  echo "Check the installation with ./verify.sh."
}

install_user_part() {
  "${bundle_dir}/sidecar-launchd/install-sidecar.sh"
}

case "${mode}" in
  system)
    install_host_library
    install_plugins
    ;;
  user)
    install_user_part
    report_restart
    ;;
  *)
    install_user_part
    install_host_library
    report_plugin
    report_restart
    ;;
esac
