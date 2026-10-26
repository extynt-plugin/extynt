#!/usr/bin/env bash
set -euo pipefail

# Removes the per-user sidecar login service and its installed runtime on macOS.

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This uninstaller targets macOS only." >&2
  exit 1
fi

label="com.extynt.sidecar"
plist_path="${HOME}/Library/LaunchAgents/${label}.plist"
install_root="${HOME}/Library/Application Support/extynt"

launchctl bootout "gui/$(id -u)" "${plist_path}" >/dev/null 2>&1 || true
rm -f "${plist_path}"
rm -rf "${install_root:?}/sidecar" "${install_root:?}/ui" "${install_root:?}/runtime" "${install_root:?}/bin"

echo "Stopped and removed the extynt sidecar login service."
echo "The MCP launcher ${install_root}/bin/extynt-mcp was removed with its runtime. Unregister the MCP server in each agent that has it (remove the extynt entry from its MCP configuration), or it will report a missing command."
echo "The pairing file and logs under \"${install_root}\" were left in place; remove that directory manually if you want a clean slate."
