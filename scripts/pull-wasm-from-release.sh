#!/usr/bin/env bash
# Download kbsink wasm bundle from a kbsink-cli GitHub release and install into wasm/.
#
# Release asset: kbsink_<tag>_wasm_js.tar.gz (contains wasm_exec.js + kbsink.wasm).
#
# Usage:
#   ./scripts/pull-wasm-from-release.sh v1.0.2
#   KBSINK_CLI_TAG=v1.0.2 ./scripts/pull-wasm-from-release.sh
#   npm run wasm:pull -- v1.0.2
#
# Optional:
#   KBSINK_CLI_REPO=owner/kbsink-cli   (default: kbsink-org/kbsink-cli)
#   SKIP_CHECKSUM=1                   skip SHA256SUMS.txt verification

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="${KBSINK_CLI_REPO:-kbsink-org/kbsink-cli}"

raw_tag="${1:-${KBSINK_CLI_TAG:-}}"
if [[ -z "${raw_tag}" ]]; then
	echo "usage: $0 <release-tag>" >&2
	echo "  example: $0 v1.0.2" >&2
	echo "or: KBSINK_CLI_TAG=v1.0.2 $0" >&2
	exit 1
fi

# Normalize to vX.Y.Z
if [[ "${raw_tag}" == v* ]]; then
	TAG="${raw_tag}"
else
	TAG="v${raw_tag}"
fi

ASSET="kbsink_${TAG}_wasm_js.tar.gz"
DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${TAG}/${ASSET}"
SUMS_URL="https://github.com/${REPO}/releases/download/${TAG}/SHA256SUMS.txt"

sha256_file() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" | awk '{print $1}'
	else
		shasum -a 256 "$1" | awk '{print $1}'
	fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

echo "Fetching ${DOWNLOAD_URL}"
curl -fL --retry 3 --retry-delay 2 -o "${TMP}/${ASSET}" "${DOWNLOAD_URL}"

if [[ "${SKIP_CHECKSUM:-}" != "1" ]]; then
	if curl -fL --retry 2 -o "${TMP}/SHA256SUMS.txt" "${SUMS_URL}" 2>/dev/null; then
		line="$(grep -F "${ASSET}" "${TMP}/SHA256SUMS.txt" | head -n 1 || true)"
		want=""
		if [[ -n "${line}" ]]; then
			want="$(echo "${line}" | awk '{print $1}')"
		fi
		if [[ -z "${want}" ]]; then
			echo "warning: ${ASSET} not listed in SHA256SUMS.txt; skipping checksum (use SKIP_CHECKSUM=1 to silence)" >&2
		else
			got="$(sha256_file "${TMP}/${ASSET}")"
			want_lc="$(echo "${want}" | tr '[:upper:]' '[:lower:]')"
			got_lc="$(echo "${got}" | tr '[:upper:]' '[:lower:]')"
			if [[ "${want_lc}" != "${got_lc}" ]]; then
				echo "SHA256 mismatch for ${ASSET}" >&2
				echo "  expected: ${want}" >&2
				echo "  actual:   ${got}" >&2
				exit 1
			fi
			echo "SHA256 OK (${ASSET})"
		fi
	else
		echo "warning: could not download SHA256SUMS.txt; skipping checksum" >&2
	fi
fi

tar -xzf "${TMP}/${ASSET}" -C "${TMP}"
if [[ ! -f "${TMP}/wasm_exec.js" ]] || [[ ! -f "${TMP}/kbsink.wasm" ]]; then
	echo "error: archive must contain wasm_exec.js and kbsink.wasm at top level" >&2
	ls -la "${TMP}" >&2
	exit 1
fi

mkdir -p "${ROOT}/wasm"
cp "${TMP}/wasm_exec.js" "${TMP}/kbsink.wasm" "${ROOT}/wasm/"
echo "Installed into ${ROOT}/wasm/ (from ${REPO} ${TAG})."
