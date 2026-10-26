#!/usr/bin/env bash
set -euo pipefail
# Removes everything the package installed: the sidecar login service, its runtime and served UI, both host library
# locations, the plugin in every After Effects, the installer payload and the package receipt. Your chats and settings are kept.
# The root-owned parts need sudo, which asks for the administrator password once.

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This uninstaller targets macOS only." >&2
  exit 1
fi

if [[ "${EUID}" == 0 && -n "${SUDO_USER:-}" && "${SUDO_USER}" != root ]]; then
  user_home="$(dscl . -read "/Users/${SUDO_USER}" NFSHomeDirectory | awk '{print $2}')"
  exec sudo -u "${SUDO_USER}" -H env HOME="${user_home}" "${BASH_SOURCE[0]}" "$@"
fi

script="${BASH_SOURCE[0]}"
while [[ -L "${script}" ]]; do
  target="$(readlink "${script}")"
  [[ "${target}" == /* ]] || target="$(dirname "${script}")/${target}"
  script="${target}"
done
bundle_dir="$(cd "$(dirname "${script}")" && pwd)"
state_root="${HOME}/Library/Application Support/extynt"
root_library="${EXTYNT_ROOT_HOST_DIR:-/Library/Application Support/extynt/host}"
applications="${EXTYNT_APPLICATIONS_DIR:-/Applications}"
system_root="${EXTYNT_SYSTEM_SUPPORT_DIR:-/Library/Application Support}/extynt"
read -r -a sudo_cmd <<<"${EXTYNT_SUDO:-sudo}"

# Each word shell-quoted, so a printed command can be pasted into a terminal as it is (paths hold spaces).
quote_cmd() { printf '%q ' "$@"; }

if [[ -x "${bundle_dir}/sidecar-launchd/uninstall-sidecar.sh" ]]; then
  "${bundle_dir}/sidecar-launchd/uninstall-sidecar.sh"
else
  echo "The helper's own uninstaller was not found in ${bundle_dir}; the sidecar login service was left in place." >&2
fi

if [[ -d "${state_root}/host" ]]; then
  rm -rf "${state_root:?}/host"
  echo "Removed the development host library: ${state_root}/host"
fi

remove_root_library() {
  if [[ ! -d "${root_library}" ]]; then echo "No host library at ${root_library}."; return; fi
  echo "Removing the root-owned host library needs administrator access: $(quote_cmd "${sudo_cmd[@]}" rm -rf "${root_library}")"
  if "${sudo_cmd[@]}" rm -rf "${root_library}"; then
    echo "Removed ${root_library}."
  else
    echo "Could not remove ${root_library}; run the command above in a terminal." >&2
  fi
}

remove_plugins() {
  local plugin removed=0
  for plugin in "${applications}/Adobe After Effects "*"/Plug-ins/extynt"; do
    [[ -d "${plugin}" ]] || continue
    if "${sudo_cmd[@]}" rm -rf "${plugin}/extyntcore.plugin"; then echo "Removed the plugin in ${plugin}."; removed=$((removed + 1)); else echo "Could not remove the plugin in ${plugin}." >&2; fi
    "${sudo_cmd[@]}" rmdir "${plugin}" 2>/dev/null || true
  done
  if [[ "${removed}" == 0 ]]; then echo "No extynt plugin folder found under ${applications}/Adobe After Effects */Plug-ins."; fi
}

# The payload holds this script, so it goes last; the shell has the script open and finishes it after the unlink.
remove_system_payload() {
  "${sudo_cmd[@]}" rm -rf "${system_root}/installer" "${system_root}/uninstall.sh"
  "${sudo_cmd[@]}" rmdir "${system_root}" 2>/dev/null || true
  "${sudo_cmd[@]}" pkgutil --forget com.extynt.installer >/dev/null 2>&1 || true
  echo "Removed the installer payload and the package receipt."
}

remove_root_library
remove_plugins
echo "Your chats and settings were kept in ${state_root}; delete that folder yourself to remove them too."
remove_system_payload
