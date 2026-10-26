#!/usr/bin/env bash
set -euo pipefail

# Installs the sidecar as a per-user launchd login service on macOS: copies the bundle's runtime and code,
# writes the launcher and plist, and rolls back to the previous install if the new one fails.

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer targets macOS only." >&2
  exit 1
fi

bundle_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
install_root="${HOME}/Library/Application Support/extynt"
label="com.extynt.sidecar"
plist_path="${HOME}/Library/LaunchAgents/${label}.plist"

if [[ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" == "1" ]]; then node_arch="arm64"; else node_arch="x64"; fi
node_tarball=""
if [[ -f "${bundle_dir}/runtime/node-runtime.env" ]]; then
  # shellcheck source=/dev/null
  source "${bundle_dir}/runtime/node-runtime.env"
  candidate="${bundle_dir}/runtime/node-v${NODE_VERSION}-darwin-${node_arch}.tar.xz"
  [[ -f "${candidate}" ]] && node_tarball="${candidate}"
fi
if [[ -z "${node_tarball}" ]] && ! command -v node >/dev/null 2>&1; then
  echo "This bundle has no Node.js runtime for darwin-${node_arch} and node is not on PATH." >&2
  echo "Downloads are per architecture: this Mac needs the ${node_arch} build of extynt." >&2
  exit 1
fi

if [[ ! -d "${bundle_dir}/sidecar" ]]; then
  echo "No sidecar/ directory found next to this script; nothing to install." >&2
  exit 1
fi
if [[ ! -f "${bundle_dir}/ui/index.html" || ! -f "${bundle_dir}/ui/main.js" || ! -f "${bundle_dir}/ui/ui-manifest.json" ]]; then
  echo "No served UI (ui/index.html, ui/main.js, ui/ui-manifest.json) found next to this script; nothing to install." >&2
  exit 1
fi

mkdir -p "${install_root}" "${HOME}/Library/LaunchAgents"
launchctl bootout "gui/$(id -u)" "${plist_path}" >/dev/null 2>&1 || true
rm -f "${install_root}/session.json"

sidecar_backup=""
if [[ -d "${install_root}/sidecar" ]]; then
  sidecar_backup="${install_root}/.sidecar.backup.$$"
  mv "${install_root}/sidecar" "${sidecar_backup}"
fi
ui_backup=""
ui_changed=0
runtime_backup=""
runtime_changed=0
launcher_backup=""
launcher_changed=0
plist_backup=""
plist_changed=0
rollback_installation() {
  launchctl bootout "gui/$(id -u)" "${plist_path}" >/dev/null 2>&1 || true
  if [[ -n "${sidecar_backup}" && -d "${sidecar_backup}" ]]; then
    rm -rf "${install_root}/sidecar"
    mv "${sidecar_backup}" "${install_root}/sidecar"
  fi
  if [[ "${ui_changed}" == 1 ]]; then
    rm -rf "${install_root}/ui"
    [[ -n "${ui_backup}" && -d "${ui_backup}" ]] && mv "${ui_backup}" "${install_root}/ui"
  fi
  if [[ "${runtime_changed}" == 1 ]]; then
    rm -rf "${install_root}/runtime"
    [[ -n "${runtime_backup}" && -d "${runtime_backup}" ]] && mv "${runtime_backup}" "${install_root}/runtime"
  fi
  if [[ "${launcher_changed}" == 1 ]]; then
    rm -f "${install_root}/bin/extynt-mcp"
    [[ -n "${launcher_backup}" && -f "${launcher_backup}" ]] && mv "${launcher_backup}" "${install_root}/bin/extynt-mcp"
  fi
  if [[ "${plist_changed}" == 1 ]]; then
    rm -f "${plist_path}"
    [[ -n "${plist_backup}" && -f "${plist_backup}" ]] && mv "${plist_backup}" "${plist_path}"
  fi
  if [[ -n "${sidecar_backup}" ]]; then
    [[ -f "${plist_path}" ]] && launchctl bootstrap "gui/$(id -u)" "${plist_path}" >/dev/null 2>&1 || true
    echo "Rolled back to the previous sidecar installation." >&2
  fi
}
trap rollback_installation EXIT

cp -R "${bundle_dir}/sidecar" "${install_root}/sidecar"
if ! diff -qr "${bundle_dir}/sidecar" "${install_root}/sidecar" >/dev/null; then
  echo "Installed sidecar assets do not match the verified bundle." >&2
  exit 1
fi

if [[ ! -f "${bundle_dir}/NOTICE" || ! -d "${bundle_dir}/licenses" ]]; then
  echo "This bundle has no NOTICE or licenses/ folder; nothing to install." >&2
  exit 1
fi
rm -rf "${install_root}/licenses"
cp -R "${bundle_dir}/licenses" "${install_root}/licenses"
cp "${bundle_dir}/NOTICE" "${install_root}/NOTICE"

if [[ -d "${install_root}/ui" ]]; then
  ui_backup="${install_root}/.ui.backup.$$"
  mv "${install_root}/ui" "${ui_backup}"
fi
ui_changed=1
cp -R "${bundle_dir}/ui" "${install_root}/ui"
if ! diff -qr "${bundle_dir}/ui" "${install_root}/ui" >/dev/null; then
  echo "Installed UI assets do not match the verified bundle." >&2
  exit 1
fi

if [[ -n "${node_tarball}" ]]; then
  expected_var="NODE_SHA256_DARWIN_$(printf %s "${node_arch}" | tr '[:lower:]' '[:upper:]')"
  expected="${!expected_var:-}"
  if [[ -z "${expected}" ]] || [[ "$(shasum -a 256 "${node_tarball}" | awk '{print $1}')" != "${expected}" ]]; then
    echo "The bundled Node.js runtime does not match its pinned SHA-256; refusing to install it." >&2
    exit 1
  fi
  if [[ -d "${install_root}/runtime" ]]; then
    runtime_backup="${install_root}/.runtime.backup.$$"
    mv "${install_root}/runtime" "${runtime_backup}"
  fi
  runtime_changed=1
  mkdir -p "${install_root}/runtime"
  node_top="node-v${NODE_VERSION}-darwin-${node_arch}"
  tar -xJf "${node_tarball}" -C "${install_root}/runtime" --strip-components=1 "${node_top}/bin/node" "${node_top}/LICENSE"
  chmod +x "${install_root}/runtime/bin/node"
  cp "${bundle_dir}/runtime/VERSION" "${install_root}/runtime/VERSION" 2>/dev/null || true
  xattr -dr com.apple.quarantine "${install_root}/runtime" 2>/dev/null || true
  node_bin="${install_root}/runtime/bin/node"
else
  node_bin="$(command -v node)"
fi
if ! "${node_bin}" --version >/dev/null 2>&1; then
  echo "The Node.js runtime at ${node_bin} would not start." >&2
  exit 1
fi
mkdir -p "${install_root}/bin"
if [[ -f "${install_root}/bin/extynt-mcp" ]]; then
  launcher_backup="${install_root}/bin/.extynt-mcp.backup.$$"
  mv "${install_root}/bin/extynt-mcp" "${launcher_backup}"
fi
launcher_changed=1
cat > "${install_root}/bin/extynt-mcp" <<MCPLAUNCHER
#!/bin/sh
exec "${node_bin}" --no-sparkplug "${install_root}/sidecar/packages/mcp-server/dist/src/stdio.js" "\$@"
MCPLAUNCHER
chmod 755 "${install_root}/bin/extynt-mcp"

if [[ -f "${plist_path}" ]]; then
  plist_backup="${install_root}/.sidecar-plist.backup.$$"
  mv "${plist_path}" "${plist_backup}"
fi
plist_changed=1
node_env="development"
if [[ "${EXTYNT_INSTALL_CONTEXT:-}" == "pkg" ]]; then node_env="production"; fi
sed -e "s#__NODE_BIN__#${node_bin}#g" -e "s#__INSTALL_ROOT__#${install_root}#g" -e "s#__NODE_ENV__#${node_env}#g" \
  "${bundle_dir}/sidecar-launchd/com.extynt.sidecar.plist.template" > "${plist_path}"

llm_env="${install_root}/llm.env"
if [[ ! -f "${llm_env}" ]]; then
  umask 077
  cat > "${llm_env}" <<'LLMENV'
# extynt in-panel agent. Easiest: set the model in the panel under Diagnostics > Model.
# AE_LLM_PROVIDER=deepseek
# DEEPSEEK_API_KEY=
# Optional: a stronger model that takes over only when the first one fails.
# AE_LLM_FALLBACK_PROVIDER=anthropic
# ANTHROPIC_API_KEY=
LLMENV
  umask 022
fi
chmod 600 "${llm_env}"

if ! launchctl bootstrap "gui/$(id -u)" "${plist_path}"; then
  if [[ "${EXTYNT_INSTALL_CONTEXT:-}" == "pkg" && -z "${sidecar_backup}" ]]; then trap - EXIT; echo "Could not start the sidecar now; it starts at your next login." >&2; exit 0; fi
  exit 1
fi
launchctl enable "gui/$(id -u)/${label}"

expected_build="$("${node_bin}" --input-type=module -e "import('${install_root}/sidecar/apps/sidecar/dist/src/server-build.js').then(m=>process.stdout.write(m.SIDECAR_BUILD_ID))")"
installed_health=""
for _ in $(seq 1 30); do
  if [[ -f "${install_root}/session.json" ]]; then
    session_port="$(sed -n 's/.*"port":\([0-9]*\).*/\1/p' "${install_root}/session.json" | head -n 1)"
    session_token="$(sed -n 's/.*"token":"\([^"]*\)".*/\1/p' "${install_root}/session.json" | head -n 1)"
    if [[ -n "${session_port}" && -n "${session_token}" ]]; then
      installed_health="$(curl --fail --silent -H "Authorization: Bearer ${session_token}" "http://127.0.0.1:${session_port}/health" 2>/dev/null || true)"
      [[ "${installed_health}" == *"\"build\":\"${expected_build}\""* ]] && break
    fi
  fi
  sleep 1
done
if [[ "${installed_health}" != *"\"build\":\"${expected_build}\""* ]]; then
  echo "The newly installed sidecar build did not become the active listener." >&2
  exit 1
fi
trap - EXIT
[[ -n "${sidecar_backup}" ]] && rm -rf "${sidecar_backup}"
[[ -n "${ui_backup}" ]] && rm -rf "${ui_backup}"
[[ -n "${runtime_backup}" ]] && rm -rf "${runtime_backup}"
[[ -n "${launcher_backup}" ]] && rm -f "${launcher_backup}"
[[ -n "${plist_backup}" ]] && rm -f "${plist_backup}"

health_version="$(sed -n 's/.*"version":"\([^"]*\)".*/\1/p' <<<"${installed_health}" | head -n 1)"
echo "Health check: ok (sidecar ${health_version:-unknown}, build ${expected_build}) at http://127.0.0.1:${session_port}/health"
echo "Installed and started the extynt sidecar as a per-user login service."
echo "It listens on 127.0.0.1 only and requires no administrator access."
echo "Logs: ${install_root}/sidecar.log and ${install_root}/sidecar.error.log"
echo "MCP clients: open the extynt panel > Settings > Agents, or point any MCP client at sh \"${install_root}/bin/extynt-mcp\"."
if ! grep -q '^AE_LLM_PROVIDER=' "${llm_env}"; then
  echo "No chat model configured yet: edit ${llm_env} (AE_LLM_PROVIDER=deepseek and DEEPSEEK_API_KEY=...), then run:"
  echo "  launchctl kickstart -k gui/$(id -u)/${label}"
fi
