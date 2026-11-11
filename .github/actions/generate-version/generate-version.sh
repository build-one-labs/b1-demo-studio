#!/usr/bin/env bash
# Computes this commit's version with GitVersion's native binary. The one place
# GitVersion runs: `b1 genver`, `b1 tag` and the generate-version action all come here.
#
# Run from the repository root. Writes GitVersion's output to version.json, prints
# the version, and adds it to $GITHUB_OUTPUT as `version` when that is set.
#
# Config, first found wins:
#   1. GitVersion.yml in the repository, which is how Vanguard keeps its VG label.
#   2. $B1_CLI_WORKSPACE/GitVersion.yml, when the CLI is installed: what `b1` passes.
#   3. The same file from the CLI version in yarn.lock, downloaded with the token an
#      install would use. This is a CI job with no install, and it needs AWS credentials.
# Running with no config would give wrong versions and no error, so that fails instead.
#
# .github/actions/generate-version has a copy of this file, because a job using the
# action has no CLI to run it from. `b1 update` owns that copy in an application
# repository. In Vanguard, generate-version.test.mjs fails if the two differ, and a
# change to them reaches customers through a new migration.
set -euo pipefail

GITVERSION=5.11.1

fail() {
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    echo "::error title=Generate version::$1"
  else
    echo "generate-version: $1" >&2
  fi
  exit 1
}

# The binary this machine needs, and the checksum of its release download.
platform() {
  local os arch
  os=$(uname -s)
  arch=$(uname -m)
  if [ "${os}" = "Linux" ] && { [ -f /etc/alpine-release ] || ldd --version 2>&1 | grep -qi musl; }; then
    os=Musl
  fi
  case "${os}/${arch}" in
    Linux/x86_64) echo "linux-x64 5e41df65591276075a677469d11cd57fdcb87cd858033728c2862e8af8ee5e57" ;;
    Linux/aarch64 | Linux/arm64) echo "linux-arm64 728ef6cfb4f5f84dc0b8c00e137fa9d29cae04b621335dcccb194be7e02b7ca0" ;;
    Musl/x86_64) echo "linux-musl-x64 0719ffe3256d758d0fd80fd62adad04a9c986288801e484c8911800380b1f52f" ;;
    Musl/aarch64 | Musl/arm64) echo "linux-musl-arm64 5893377c55fb6aa3414b06240e3db63d92efe56a3250ede11810b9f664933011" ;;
    Darwin/x86_64) echo "osx-x64 1a84f34dd23938ad5e00510b4bedaa8992307e9c63384bb6b52806b709bd5c19" ;;
    Darwin/arm64) echo "osx-arm64 9c80251917e97f683aba7b452907505bc0035d2318af19156c23abf13abddd1b" ;;
  esac
}

checksum_of() {
  if command -v sha256sum >/dev/null; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

work=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/gitversion.XXXXXX")
trap 'rm -rf "${work}"' EXIT

# Downloaded once per machine. Moved into place only after its checksum passed, so an
# interrupted or tampered download is never run.
home="${GITVERSION_HOME:-${XDG_CACHE_HOME:-${HOME}/.cache}/build-one/gitversion-${GITVERSION}}"
if [ ! -x "${home}/gitversion" ]; then
  read -r name checksum <<<"$(platform)"
  [ -n "${checksum:-}" ] || fail "GitVersion has no binary for $(uname -s)/$(uname -m)."
  asset="gitversion-${name}-${GITVERSION}.tar.gz"
  curl -fsSL --retry 3 -o "${work}/${asset}" \
    "https://github.com/GitTools/GitVersion/releases/download/${GITVERSION}/${asset}" ||
    fail "Could not download ${asset} from github.com."
  [ "$(checksum_of "${work}/${asset}")" = "${checksum}" ] || fail "${asset} does not match its pinned checksum."
  tar xzf "${work}/${asset}" -C "${work}" gitversion
  mkdir -p "${home}"
  mv "${work}/gitversion" "${home}/gitversion"
fi

config_args=()
if [ -f GitVersion.yml ]; then
  : # GitVersion reads it from the repository root by itself.
elif [ -n "${B1_CLI_WORKSPACE:-}" ] && [ -f "${B1_CLI_WORKSPACE}/GitVersion.yml" ]; then
  config_args=(/config "${B1_CLI_WORKSPACE}/GitVersion.yml")
else
  [ -f yarn.lock ] && [ -f .yarnrc.yml ] || fail "No GitVersion.yml, and no yarn.lock and .yarnrc.yml to find the CLI's with."
  cli_version=$(awk '/^"@buildone\/swat-cli@/ { found = 1 } found && /^  version:/ { print $2; exit }' yarn.lock)
  registry=$(awk '/^  buildone:/ { found = 1 } found && /npmRegistryServer:/ { gsub(/["\047]/, "", $2); print $2; exit }' .yarnrc.yml)
  if [ -z "${cli_version}" ] || [ -z "${registry}" ]; then
    fail "No GitVersion.yml, and no @buildone/swat-cli in yarn.lock or registry in .yarnrc.yml to read one from."
  fi
  token=$(aws codeartifact get-authorization-token --domain buildone --domain-owner 653306034207 \
    --region "${AWS_REGION:-eu-central-1}" --query authorizationToken --output text) ||
    fail "Could not get a CodeArtifact token to read the CLI's GitVersion.yml. Are AWS credentials configured?"
  [ -z "${GITHUB_ACTIONS:-}" ] || echo "::add-mask::${token}"
  curl -fsSL --retry 3 -H "Authorization: Bearer ${token}" -o "${work}/cli.tgz" \
    "${registry}@buildone/swat-cli/-/swat-cli-${cli_version}.tgz" ||
    fail "Could not download @buildone/swat-cli ${cli_version} to read its GitVersion.yml."
  tar xzf "${work}/cli.tgz" -C "${work}" package/workspace/GitVersion.yml
  config_args=(/config "${work}/package/workspace/GitVersion.yml")
fi

# GitVersion needs the whole history to count from the last tag.
if [ "$(git rev-parse --is-shallow-repository 2>/dev/null || echo false)" = "true" ]; then
  git fetch --unshallow 2>/dev/null || echo "generate-version: could not unshallow, so the version may be wrong." >&2
fi

# Without this the binary needs ICU, and version numbers do not depend on a locale.
if ! DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1 "${home}/gitversion" . /nonormalize /nocache /output json \
  "${config_args[@]}" >"${work}/version.json"; then
  tail -n 40 "${work}/version.json" >&2
  fail "GitVersion failed."
fi

version=$(jq -r '.SemVer // empty' "${work}/version.json" 2>/dev/null) || version=""
[ -n "${version}" ] || fail "GitVersion returned no SemVer."

cp "${work}/version.json" version.json
echo "Generated version: ${version}"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "version=${version}" >>"${GITHUB_OUTPUT}"
fi
