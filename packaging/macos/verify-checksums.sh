#!/usr/bin/env bash
set -euo pipefail

# Verifies every file of an unpacked bundle against its SHA256SUMS and prints only failures.

bundle_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${bundle_dir}"
if report="$(shasum -a 256 -c SHA256SUMS 2>&1)"; then
  echo "Bundle checksums: OK ($(wc -l < SHA256SUMS | tr -d ' ') files)"
  exit 0
fi
printf '%s\n' "${report}" | grep -v ': OK$' >&2 || true
echo "Bundle checksum verification failed; re-download the archive." >&2
exit 1
