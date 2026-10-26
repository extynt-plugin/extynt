#!/usr/bin/env bash
set -euo pipefail
# Authenticode-signs Windows files (the plugin .aex, the setup .exe) with Microsoft Artifact Signing through jsign.
# The signing key stays in Azure; this machine holds only a short-lived access token from `az` (az login with the
# "Artifact Signing Certificate Profile Signer" role) and jsign 5+ on PATH (Java 11+). Runs on Linux, macOS or Git Bash.
#   scripts/sign-win.sh <file>...
# Environment: EXTYNT_SIGN_ACCOUNT, EXTYNT_SIGN_PROFILE and EXTYNT_SIGN_ENDPOINT (<region>.codesigning.azure.net) are
# required; EXTYNT_SIGN_TOKEN skips az; EXTYNT_SIGN_TIMESTAMP defaults to http://timestamp.acs.microsoft.com.
# The publisher Windows shows is the certificate's subject. Inno Setup can call this per file:
# iscc /Sextynt-sign="bash scripts/sign-win.sh $f" /DSignToolName=extynt-sign ...

account="${EXTYNT_SIGN_ACCOUNT:-}"
profile="${EXTYNT_SIGN_PROFILE:-}"
endpoint="${EXTYNT_SIGN_ENDPOINT:-}"
timestamp="${EXTYNT_SIGN_TIMESTAMP:-http://timestamp.acs.microsoft.com}"

fail() { echo "sign-win: $*" >&2; exit 1; }

[[ -n "${account}" ]] || fail "set EXTYNT_SIGN_ACCOUNT to your Artifact Signing account name"
[[ -n "${profile}" ]] || fail "set EXTYNT_SIGN_PROFILE to your certificate profile name"
[[ -n "${endpoint}" ]] || fail "set EXTYNT_SIGN_ENDPOINT to your account's regional endpoint host"

[[ $# -ge 1 ]] || fail "usage: scripts/sign-win.sh <file>..."
command -v jsign >/dev/null 2>&1 || fail "jsign is not installed or not on PATH (https://ebourg.github.io/jsign/, version 5 or newer)"
if [[ -z "${EXTYNT_SIGN_TOKEN:-}" ]]; then
  command -v az >/dev/null 2>&1 || fail "the Azure CLI (az) is not installed (https://learn.microsoft.com/cli/azure/install-azure-cli)"
  az account show >/dev/null 2>&1 || fail "az is not logged in: run 'az login' as the identity that holds the signer role on account ${account}"
fi

for file in "$@"; do
  [[ -f "${file}" ]] || fail "no such file: ${file}"
  [[ "$(head -c 2 "${file}")" == "MZ" ]] || fail "${file} is not a Windows executable (no MZ header)"
done

if [[ -z "${EXTYNT_SIGN_TOKEN:-}" ]]; then
  EXTYNT_SIGN_TOKEN="$(az account get-access-token --resource https://codesigning.azure.net --query accessToken --output tsv)" \
    || fail "could not get an Artifact Signing access token from az"
  [[ -n "${EXTYNT_SIGN_TOKEN}" ]] || fail "az returned an empty access token"
fi
export EXTYNT_SIGN_TOKEN

for file in "$@"; do
  jsign --storetype TRUSTEDSIGNING --keystore "${endpoint}" --storepass env:EXTYNT_SIGN_TOKEN \
    --alias "${account}/${profile}" --alg SHA-256 --tsaurl "${timestamp}" --tsmode RFC3161 \
    --name extynt --url https://extynt.com --replace "${file}" \
    || fail "jsign failed on ${file} (account ${account}, profile ${profile}, endpoint ${endpoint})"
  echo "signed ${file}"
done

if command -v osslsigncode >/dev/null 2>&1; then
  for file in "$@"; do
    if osslsigncode verify -in "${file}" >/dev/null 2>&1; then
      echo "verified ${file}"
    else
      echo "sign-win: osslsigncode could not verify ${file} (it may not trust the Microsoft root); check on Windows with signtool verify /pa" >&2
    fi
  done
fi
