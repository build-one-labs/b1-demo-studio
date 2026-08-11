#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_ROOT="${WORKSPACE_ROOT:-$(git rev-parse --show-toplevel)}"
export WORKSPACE_ROOT

# >>> b1-user-secret-fetch (managed by @buildone/swat-cli migration; safe to re-run) >>>
# Pull this workspace's secrets from the auth server using a single API key, so
# they need not be set as individual GitHub Codespaces secrets. Accepts a
# personal B1_USER_API_KEY or a shared organization B1_ORG_API_KEY, either of
# them optionally named for the auth server it belongs to
# (B1_USER_API_KEY__AUTH_DEVELOP_TEST_BUILD_ONE); a personal key wins over a
# shared one at the same specificity, and the server decides what each can see
# from the key's owner.
#
# This block runs before `yarn install`, so node_modules does not exist and it
# cannot read the workspace manifest — but it no longer needs to. One request to
# /api/secrets/resolve-all returns every secret the caller can see, so there is
# no list here to keep in step with anything: adding a secret means storing it
# on the server, and neither this block nor the repository changes.
#
# The variable *name* therefore comes from the server too, and this file is
# sourced by the shell. Every name is accepted, by design — so whoever can write
# a global or organization secret can set PATH, NODE_OPTIONS, BASH_ENV or
# LD_PRELOAD here. Write access to shared secrets is write access to the
# workspaces that read them. Kept in step with env_name_from_secret_key() in the
# CLI's devcontainer/lib/common.sh.
#
# Values land in .b1/env/.env.fetched, rewritten whole on each successful run
# and loaded before .env.local, as `NAME=${NAME:-'value'}` so an explicitly-set
# environment variable still wins. Self-contained (curl + jq + base64); a no-op
# when no key / AUTH_URL is unset or the tools are unavailable. Wrapped in a
# function invoked via `|| true` so `set -e` cannot abort the prebuild on a
# transient fetch failure.
#
# WHY IT RECORDS WHY IT STOPPED
# Failing softly is right — this runs as onCreateCommand, and exiting non-zero
# would block container creation rather than leave a usable shell. But a bare
# `return 0` threw away the one thing anybody downstream needed. The install is
# skipped ~140 lines later, and the only fact still in scope there was whether
# AUTH_URL happened to be empty, so a *wrong* AUTH_URL was reported as a
# *missing* API key: the reader is told to set a key they have already set,
# while the 401 that actually stopped it is named nowhere. Every exit now
# records an outcome in _B1_SECRET_FETCH_STATUS and in
# .b1/env/.prebuild-status, so the CodeArtifact message below states the cause
# and later lifecycle hooks can read it instead of scraping creation.log.
#
# WHY THE KEY IS RESOLVED BELOW THE .env LOAD
# A key is a row in one auth server's database, so it is stored per server —
# B1_USER_API_KEY__<HOST>, consulted before the unqualified name (see
# lib/api-key.sh, which every *other* caller resolves through). This block
# cannot source that file: it runs before `yarn install`, which is the whole
# reason it carries its own copy of the fetch. So the resolution is inlined,
# and it has to sit *below* the point where AUTH_URL is loaded from .env —
# the suffix is AUTH_URL's host, and computing it from an empty AUTH_URL
# silently degrades to the unqualified name, which looks like it works.
_B1_SECRET_FETCH_STATUS=''

# Record why the fetch stopped, for the CodeArtifact block below and for any
# later hook. Written to a file as well as a variable because the hooks that
# need it most run in a different process, two lifecycle stages later.
_b1_secret_status() {
  _B1_SECRET_FETCH_STATUS="$1"
  local root="${WORKSPACE_ROOT:-$PWD}"
  mkdir -p "${root}/.b1/env" 2>/dev/null || true
  {
    printf '# Written by the prebuild secret fetch; rewritten on every run.\n'
    printf 'B1_SECRET_FETCH_STATUS=%s\n' "$1"
    printf 'B1_SECRET_FETCH_URL=%s\n' "${2:-}"
  } > "${root}/.b1/env/.prebuild-status" 2>/dev/null || true
}

# Resolve this workspace's repository as `owner/name`, for use as a secret
# scope; empty when it cannot be determined, which means unscoped.
# GITHUB_REPOSITORY is set in a Codespace but not in a local devcontainer, so
# the git remote is the fallback — it needs no network, no gh CLI and no
# authentication, and yields the identical string, which matters because a
# scope that differed between the two would silently resolve to nothing.
# Kept in step with repo_scope() in the CLI's devcontainer/lib/common.sh.
_b1_repo_scope() {
  local scope="${GITHUB_REPOSITORY:-}" root="${WORKSPACE_ROOT:-$PWD}" url owner name
  if [ -z "$scope" ] && url=$(git -C "$root" remote get-url origin 2>/dev/null) && [ -n "$url" ]; then
    url="${url%.git}"; url="${url%/}"
    # A URL keeps the host as a path segment; the scp-like form ends it at ':'.
    case "$url" in
      *://*) url="${url#*://}"; url="${url#*@}"; url="${url#*/}" ;;
      *:*)   url="${url#*@}"; url="${url#*:}" ;;
    esac
    name="${url##*/}"; owner="${url%/*}"; owner="${owner##*/}"
    if [ -n "$owner" ] && [ -n "$name" ] && [ "$owner" != "$name" ]; then scope="${owner}/${name}"; fi
  fi
  # Mirror the auth server's scope rules: an unexpected remote yields no scope
  # rather than a request the server rejects.
  if [ -n "$scope" ] && [[ "$scope" =~ ^[A-Za-z0-9._/-]{1,200}$ ]] && [[ ! "$scope" =~ (^|/)\.\.?(/|$) ]]; then
    printf '%s' "$scope"
  fi
}

# Map a secret key (lowercase with dashes) to the environment variable name it
# is exposed as. The only rejection is a key that could not be a variable name:
# an '=' or a space would put two lines into a sourced file, and a leading digit
# cannot be assigned. No list beyond that — every secret becomes a variable.
_b1_env_name() {
  local name
  name=$(printf '%s' "$1" | tr 'a-z.-' 'A-Z__')
  [[ "$name" =~ ^[A-Z][A-Z0-9_]*$ ]] || return 1
  printf '%s' "$name"
}

# Single-quote a value for a file that will be sourced: '\'' closes, escapes and
# reopens around an embedded quote. Without this a value containing $(…), a
# backtick or a newline would be executed rather than assigned.
_b1_quote() {
  printf "'%s'" "${1//\'/\'\\\'\'}"
}

# The API key travels in a request header, so the transport has to be encrypted
# before the request is made — there is no undoing it afterwards. curl infers
# `http://` when AUTH_URL carries no scheme at all, which is the case that
# matters: `AUTH_URL=auth.example.com` sends the key in clear text and then
# fails on the 301 that redirects to https, so the key is spent on a plain-text
# hop for a request that was never going to succeed. Refuse instead of asking.
# Loopback over http is allowed, for an auth server running on this machine.
_b1_url_is_safe() {
  case "$1" in
    https://*) return 0 ;;
    http://localhost|http://localhost:*|http://localhost/*) return 0 ;;
    http://127.0.0.1|http://127.0.0.1:*|http://127.0.0.1/*) return 0 ;;
    http://[::1]|http://[::1]:*|http://[::1]/*) return 0 ;;
    *) return 1 ;;
  esac
}

# The auth server a URL names, as an environment-variable-name fragment: host
# only (no scheme, userinfo, port or path), dots and dashes to underscores,
# uppercased. Empty when the URL carries no host to speak of, which the caller
# reads as "no suffixed name to look for". Kept in step with b1_auth_host_slug()
# in the CLI's devcontainer/lib/api-key.sh.
_b1_auth_host_slug() {
  local url="${1:-}" host
  host="${url#*://}"  # scheme
  host="${host%%/*}"  # path
  host="${host%%\?*}"
  host="${host##*@}"  # userinfo
  host="${host%%:*}"  # port
  [ -n "$host" ] || return 1
  host=$(printf '%s' "$host" | tr 'a-z.-' 'A-Z__')
  [[ "$host" =~ ^[A-Z0-9_]+$ ]] || return 1
  printf '%s' "$host"
}

# The variable holding the credential for the auth server this workspace points
# at, most specific first: the personal key named for that host, the unqualified
# personal key, then the same two for the organization key. Echoes the variable
# NAME, not its value, so a log line can say which one was used. Returns 1 when
# none of them is set. Kept in step with b1_api_key_candidates() in the CLI's
# devcontainer/lib/api-key.sh — same order, same names.
_b1_api_key_var() {
  local slug="${1:-}" name
  for name in ${slug:+"B1_USER_API_KEY__${slug}"} B1_USER_API_KEY \
    ${slug:+"B1_ORG_API_KEY__${slug}"} B1_ORG_API_KEY; do
    if [ -n "${!name:-}" ]; then
      printf '%s' "$name"
      return 0
    fi
  done
  return 1
}

# Every B1 key set here under any name, one per line. Two callers: the cheap
# "is there a key at all" test that keeps the no-key exit above the .env load,
# and the diagnosis when a key is set but belongs to another auth server —
# which is the whole message in one line ("you have a key for try-auth, and
# this workspace points at auth-develop").
_b1_api_key_vars_set() {
  local name
  for name in $(compgen -v 2>/dev/null | grep -E '^B1_(USER|ORG)_API_KEY(__[A-Z0-9_]+)?$' | sort); do
    [ -n "${!name:-}" ] && printf '%s\n' "$name"
  done
  return 0
}

_b1_fetch_user_secrets() {
  local root="${WORKSPACE_ROOT:-$PWD}"

  # Asked before .env is read, so a workspace with no key at all still records
  # 'no-key' without this block having sourced or exported anything — the
  # pre-existing behaviour exactly. It covers the suffixed names too, which is
  # the point: a workspace whose only key is B1_USER_API_KEY__<HOST> must not
  # be reported as having none.
  local keys_set
  keys_set=$(_b1_api_key_vars_set)
  [ -n "$keys_set" ] || { _b1_secret_status 'no-key'; return 0; }

  # AUTH_URL usually lives in .env; load it non-fatally if not already exported.
  if [ -z "${AUTH_URL:-}" ] && [ -f "${root}/.env" ]; then
    set -a; . "${root}/.env" 2>/dev/null || true; set +a
  fi
  [ -n "${AUTH_URL:-}" ] || { _b1_secret_status 'no-url'; return 0; }

  local auth="${AUTH_URL%/}"
  if ! _b1_url_is_safe "$auth"; then
    echo "[WARN] AUTH_URL (${auth}) is not https, so the API key would cross the network in clear text - request refused"
    echo "[WARN] Set AUTH_URL to an https:// URL. A value with no scheme at all is read as http:// and hits this."
    _b1_secret_status 'bad-url' "$auth"
    return 0
  fi

  if ! command -v curl >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1 || ! command -v base64 >/dev/null 2>&1; then
    echo "[WARN] curl, jq and base64 are required to fetch secrets - skipping"
    _b1_secret_status 'no-tools' "$auth"
    return 0
  fi

  # Only now is the host known, so only now can the host-specific name be looked
  # up. Which variable was chosen is logged, because "the key is set but it is
  # the wrong one" and "the key is set and is being used" are otherwise the same
  # output.
  local slug b1_api_key_var b1_api_key set_it_as
  slug=$(_b1_auth_host_slug "$auth" 2>/dev/null) || slug=''
  if ! b1_api_key_var=$(_b1_api_key_var "$slug"); then
    # Reached only when a key IS set and none of it is for this server: the
    # failure lib/api-key.sh exists to end, and the one the reader cannot see
    # for themselves. Saying "no key is set" here would be false.
    set_it_as='B1_USER_API_KEY'
    [ -n "$slug" ] && set_it_as="B1_USER_API_KEY__${slug}"
    echo "[WARN] No API key for ${auth} - the keys set here belong to other auth servers: $(printf '%s' "$keys_set" | tr '\n' ' ')"
    echo "[WARN] A key only works at the auth server that minted it. Sign in at ${auth}, mint a key (Account > API keys) and set it as ${set_it_as}."
    _b1_secret_status 'no-key' "$auth"
    return 0
  fi
  b1_api_key="${!b1_api_key_var}"
  echo "[INFO] Using ${b1_api_key_var} for ${auth}"

  local env_fetched="${root}/.b1/env/.env.fetched"
  mkdir -p "${root}/.b1/env" 2>/dev/null || true
  local key encoded var val resp code body tmp n=0

  # Secrets may be stored for a specific repository as well as generally; the
  # scope is this workspace's repository. Empty means unscoped — exactly the
  # pre-scope behaviour.
  local scope query=''
  scope=$(_b1_repo_scope)
  if [ -n "$scope" ]; then
    # Percent-encode the '/' so it cannot be read as a path segment.
    query="?scope=${scope//\//%2F}"
    echo "[INFO] Resolving secrets for scope ${scope}"
  fi

  # /resolve-all walks user -> organization -> global for a user key (a personal
  # value wins) and organization -> global for an org key, so a shared credential
  # set once at org (or global) level serves every developer. With ?scope=, each
  # level prefers a value stored for this repository over its general one.
  #
  # Timeouts because this is onCreateCommand: an AUTH_URL naming a host that
  # drops packets rather than refusing them would otherwise stall container
  # creation indefinitely instead of failing and letting the prebuild continue.
  resp=$(curl -sS --connect-timeout 10 --max-time 30 -w '\n%{http_code}' \
    -H "x-api-key: ${b1_api_key}" \
    "${auth}/api/secrets/resolve-all${query}" 2>/dev/null) || {
    # Curl could not complete the request at all: DNS, TLS, connection refused,
    # timeout. This used to be the one failure that said nothing whatsoever.
    echo "[WARN] Secret fetch could not reach ${auth} (network, DNS or TLS failure) - leaving ${env_fetched} as it is"
    _b1_secret_status 'network' "$auth"
    return 0
  }
  code="${resp##*$'\n'}"; body="${resp%$'\n'*}"
  # Anything but success leaves any existing file alone: an expired key or an
  # auth server still starting must not empty a workspace's secrets.
  [ "$code" = "200" ] || {
    echo "[WARN] Secret fetch returned HTTP ${code} from ${auth} - leaving ${env_fetched} as it is"
    _b1_secret_status "http-${code}" "$auth"
    return 0
  }

  tmp="${env_fetched}.tmp.$$"
  : > "$tmp"; chmod 600 "$tmp" 2>/dev/null || true
  echo "# Secrets fetched from ${auth} - rewritten on every start, do not edit." >> "$tmp"

  # `.secret` may be a plain string, a JSON-encoded string, or an object wrapping
  # { secret | value }. Normalise all of these to the raw value, and carry it as
  # base64 so spaces and newlines survive the read loop. Tab-separated: the
  # server's key charset has no tab, so a malformed key stays whole and gets
  # reported rather than being cut in half by the split.
  while IFS=$'\t' read -r key encoded; do
    [ -n "$key" ] || continue
    var=$(_b1_env_name "$key") || { echo "[WARN] Skipped secret '${key}': not usable as a variable name"; continue; }
    val=$(printf '%s' "$encoded" | base64 -d 2>/dev/null) || continue
    [ -n "$val" ] || continue
    printf '%s=${%s:-%s}\n' "$var" "$var" "$(_b1_quote "$val")" >> "$tmp"
    n=$((n + 1))
  done < <(printf '%s' "$body" | jq -r '
    .secrets[] | .key as $k | .secret as $s
    | ( if ($s|type)=="object" then ($s.secret // $s.value // "")
        elif ($s|type)=="string" then ((try ($s|fromjson) catch null) as $i
          | if ($i|type)=="object" then ($i.secret // $i.value // $s) else $s end)
        else ($s|tostring) end ) as $v
    | select($v != null and $v != "")
    | "\($k)\t\($v|@base64)"' 2>/dev/null)

  # A 200 carrying nothing readable must not overwrite a good file either. The
  # non-200 guard above already says so, but it did not cover the two ways a
  # *successful* response yields no secrets: a valid key with no grants (or a
  # scope matching nothing), and a body jq cannot parse — a proxy or captive
  # portal answering 200 with HTML. Both used to reach the `mv` below and move a
  # file holding only the header comment over a working one, then report
  # "Fetched 0 secret(s)", which reads as success. A workspace that had its
  # secrets lost them on the next start.
  if [ "$n" -eq 0 ]; then
    rm -f "$tmp"
    echo "[WARN] Secret fetch returned no readable secrets - leaving ${env_fetched} as it is"
    _b1_secret_status 'empty' "$auth"
    return 0
  fi

  mv "$tmp" "$env_fetched" 2>/dev/null || {
    rm -f "$tmp"
    echo "[WARN] Could not write ${env_fetched}"
    _b1_secret_status 'write-failed' "$auth"
    return 0
  }
  _b1_secret_status "ok:${n}" "$auth"
  echo "[INFO] Fetched ${n} secret(s) into .b1/env/.env.fetched"
}
_b1_fetch_user_secrets || true

# Load what the fetch just wrote into this shell. The block above only *writes*
# .env.fetched, while everything below still reads the environment — including
# the CodeArtifact step, which needs B1_ACCESS_KEY_ID to obtain the token that
# lets `yarn install` see the private @buildone packages. Until 24.3.0-VG.375
# this was implicit: the older block exported each secret as it fetched it.
#
# `set -a` because .env.fetched assigns `NAME=${NAME:-'value'}` without export,
# and .env.local second so a local override still wins — the precedence
# start_stack.sh and build-one apply. Sourced with `|| true` so a malformed file
# cannot abort the prebuild. .b1/env/ first, the workspace root second, for a
# workspace that predates 24.3.0-VG.376.
_b1_load_env_files() {
  local root="${WORKSPACE_ROOT:-$PWD}" env_file resolved
  for env_file in .env.fetched .env.local; do
    resolved="${root}/.b1/env/${env_file}"
    [ -f "$resolved" ] || resolved="${root}/${env_file}"
    if [ -f "$resolved" ]; then
      set -a; . "$resolved" || true; set +a
    fi
  done
}
_b1_load_env_files || true
# <<< b1-user-secret-fetch <<<


# =============================================================================
# Codespace Secrets Check
# =============================================================================
# In GitHub Codespaces, check if required secrets are configured.
# If missing, skip the prebuild entirely - the secrets setup wizard will run
# during postAttach to guide the user through configuration.
# =============================================================================

# Source secrets configuration from swat-cli (available after yarn install)
SECRETS_CONFIG="${WORKSPACE_ROOT}/node_modules/@buildone/swat-cli/scripts/devcontainer/lib/secrets-config.sh"
if [ -f "$SECRETS_CONFIG" ]; then
    source "$SECRETS_CONFIG"
    secrets_init_paths

    if secrets_is_codespace; then
        missing_secrets=()
        secrets_get_missing missing_secrets

        if [ ${#missing_secrets[@]} -gt 0 ]; then
            echo ""
            echo "============================================================================="
            echo "  CODESPACE SECRETS NOT CONFIGURED"
            echo "============================================================================="
            echo ""
            echo "  Missing ${#missing_secrets[@]} required secret(s):"
            for secret in "${missing_secrets[@]}"; do
                echo "    - $secret"
            done
            echo ""
            echo "  Skipping prebuild. The secrets setup wizard will run when you attach."
            echo "============================================================================="
            echo ""
            exit 0
        fi

        echo "[INFO] All required secrets are configured, proceeding with prebuild..."
    fi
fi

# Ensure packages are installed before running prebuild
# Skip install during prebuild check (triggered at stack startup) - will be installed by dedicated task
if [[ "${PREBUILD_CHECK:-}" != "true" ]]; then
    cd "${WORKSPACE_ROOT}"

    # >>> b1-codeartifact-auth (managed by @buildone/swat-cli migration; safe to re-run) >>>
    # Map B1_* credentials to the AWS_* names the AWS CLI requires. Only export
    # when a value is actually present: exporting empty strings makes the AWS CLI
    # fail with NoCredentials even when a cached token could have been used.
    if [[ -z "${AWS_ACCESS_KEY_ID:-}" && -n "${B1_ACCESS_KEY_ID:-}" ]]; then
        export AWS_ACCESS_KEY_ID="${B1_ACCESS_KEY_ID}"
        export AWS_SECRET_ACCESS_KEY="${B1_SECRET_ACCESS_KEY:-}"
    fi

    # Obtain the CodeArtifact auth token for the private @buildone registry
    # (required by .yarnrc.yml). Guarded so a Codespace without credentials cannot
    # abort container creation (this script runs under `set -e` as onCreateCommand):
    # fall back to a previously cached token, and otherwise skip the install with
    # instructions naming the API key that fetches them.
    if [[ -z "${CODEARTIFACT_AUTH_TOKEN:-}" ]]; then
        if command -v aws >/dev/null 2>&1 && [[ -n "${AWS_ACCESS_KEY_ID:-}" && -n "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
            echo "[INFO] Obtaining CodeArtifact auth token..."
            if CODEARTIFACT_AUTH_TOKEN=$(aws codeartifact get-authorization-token \
                --domain buildone --domain-owner 653306034207 \
                --region "${AWS_REGION:-eu-central-1}" --query authorizationToken --output text) \
                && [[ -n "${CODEARTIFACT_AUTH_TOKEN}" ]]; then
                export CODEARTIFACT_AUTH_TOKEN
                mkdir -p "${WORKSPACE_ROOT}/.b1/env" 2>/dev/null || true
                echo "export CODEARTIFACT_AUTH_TOKEN=${CODEARTIFACT_AUTH_TOKEN}" > "${WORKSPACE_ROOT}/.b1/env/.aws-token.env"
                echo "[INFO] CodeArtifact token obtained"
            else
                CODEARTIFACT_AUTH_TOKEN=""
                echo "[WARN] Could not obtain a CodeArtifact token with the provided credentials"
            fi
        fi
        if [[ -z "${CODEARTIFACT_AUTH_TOKEN:-}" && -f "${WORKSPACE_ROOT}/.b1/env/.aws-token.env" ]]; then
            source "${WORKSPACE_ROOT}/.b1/env/.aws-token.env" || true
            if [[ -n "${CODEARTIFACT_AUTH_TOKEN:-}" ]]; then
                echo "[INFO] Using cached CodeArtifact token"
            fi
        fi
    fi

    if [[ -z "${CODEARTIFACT_AUTH_TOKEN:-}" ]]; then
        echo ""
        echo "============================================================================="
        echo "  NPM CREDENTIALS NOT CONFIGURED - SKIPPING PACKAGE INSTALL"
        echo "============================================================================="
        echo ""
        echo "  No CodeArtifact token could be obtained, so private @buildone packages"
        echo "  cannot be downloaded."
        # State the cause the secret fetch actually established, rather than
        # inferring one from what happens to be unset here. Without this the only
        # testable fact left is whether AUTH_URL is empty, so a *wrong* AUTH_URL is
        # reported as a *missing* API key and the reader is told to set a key they
        # have already set. _B1_SECRET_FETCH_STATUS is set by the
        # b1-user-secret-fetch block above; on a workspace that has migrated only
        # one of the two blocks it is unset, no arm matches, and this says nothing
        # rather than something wrong.
        case "${_B1_SECRET_FETCH_STATUS:-}" in
            http-401|http-403)
                echo ""
                echo "  Cause: the auth server at ${AUTH_URL:-(unset)} rejected the API key"
                echo "  (HTTP ${_B1_SECRET_FETCH_STATUS#http-}). Either the key has expired, or it was minted in a"
                echo "  different environment than AUTH_URL names - a key and a URL from two"
                echo "  environments produce exactly this."
                ;;
            http-*)
                echo ""
                echo "  Cause: the auth server at ${AUTH_URL:-(unset)} answered HTTP"
                echo "  ${_B1_SECRET_FETCH_STATUS#http-} to the secret fetch, so no secrets were retrieved."
                ;;
            bad-url)
                echo ""
                echo "  Cause: AUTH_URL (${AUTH_URL:-(unset)}) is not an https:// URL, so the"
                echo "  secret fetch refused to send the API key over an unencrypted"
                echo "  connection. Note a value with no scheme at all is read as http://."
                ;;
            network)
                echo ""
                echo "  Cause: the auth server at ${AUTH_URL:-(unset)} could not be reached"
                echo "  (network, DNS or TLS failure), so no secrets were retrieved."
                ;;
            empty)
                echo ""
                echo "  Cause: the auth server at ${AUTH_URL:-(unset)} returned no secrets this"
                echo "  key can see. The key is valid, but nothing is provisioned for it -"
                echo "  ask an org owner to grant the CodeArtifact credentials."
                ;;
            no-url)
                echo ""
                echo "  Cause: a B1 API key is set, but AUTH_URL is not, so the automatic"
                echo "  secret fetch could not contact the auth server. Set AUTH_URL as a"
                echo "  Codespaces secret alongside the key."
                ;;
            no-tools)
                echo ""
                echo "  Cause: curl, jq or base64 is missing from this image, so the"
                echo "  automatic secret fetch could not run."
                ;;
            write-failed)
                echo ""
                echo "  Cause: the secrets were fetched but .b1/env/.env.fetched could not be"
                echo "  written. Check the permissions on .b1/env/."
                ;;
            ok:*)
                echo ""
                echo "  Note: the secret fetch succeeded (${_B1_SECRET_FETCH_STATUS#ok:} secret(s) from ${AUTH_URL:-(unset)}),"
                echo "  so the API key and AUTH_URL are not the problem. Either"
                echo "  B1_ACCESS_KEY_ID / B1_SECRET_ACCESS_KEY were not among the secrets"
                echo "  this key can see - ask an org owner to provision them - or the AWS"
                echo "  CLI is unavailable. The [WARN] lines above say which."
                ;;
        esac
        echo ""
        echo "  These credentials are provisioned for you. Set ONE API key as a"
        echo "  Codespaces secret and rebuild the container:"
        echo ""
        echo "    B1_ORG_API_KEY   organization-level - every repository, every"
        echo "                     member, and what CI workflows use"
        echo "    B1_USER_API_KEY  user-level - your own key, takes precedence"
        echo ""
        echo "  Mint one in the web app: Account -> API keys, or"
        echo "  My Organization -> API keys."
        echo ""
        echo "  Setting B1_ACCESS_KEY_ID and B1_SECRET_ACCESS_KEY directly still"
        echo "  works and always wins over a fetched value."
        echo "============================================================================="
        echo ""
        exit 0
    fi
    # <<< b1-codeartifact-auth <<<

    echo "[INFO] Installing packages..."
    yarn install

    echo "[INFO] Clearing yarn cache..."
    yarn cache clear
else
    echo "[INFO] Skipping package install during prebuild check"
fi
# >>> b1-framework-prebuild-guard (managed by @buildone/swat-cli migration; safe to re-run) >>>
# Everything below this point reaches into node_modules — a find over it, then
# an exec of the framework prebuild inside it. It is missing whenever the
# install above was skipped, which is precisely the case worth explaining, and
# whenever PREBUILD_CHECK=true skips that block outright. Without this check the
# run ends on a bare "No such file or directory" (exit 127) that names nothing.
# Exits 0 because this is onCreateCommand: a non-zero exit blocks container
# creation rather than leaving a shell to fix things from.
if [ ! -d "${WORKSPACE_ROOT}/node_modules/@buildone/swat-cli" ]; then
    # The fetch sets this when it ran in this shell; the file carries it when
    # this guard is reached from a later process.
    _b1_status="${_B1_SECRET_FETCH_STATUS:-}"
    if [ -z "$_b1_status" ] && [ -f "${WORKSPACE_ROOT}/.b1/env/.prebuild-status" ]; then
        _b1_status=$(sed -n 's/^B1_SECRET_FETCH_STATUS=//p' "${WORKSPACE_ROOT}/.b1/env/.prebuild-status" 2>/dev/null)
    fi
    echo ""
    echo "============================================================================="
    echo "  TOOLCHAIN NOT INSTALLED - SKIPPING THE FRAMEWORK PREBUILD"
    echo "============================================================================="
    echo ""
    echo "  node_modules/@buildone/swat-cli is not present, so the framework"
    echo "  prebuild cannot run. Nothing below this point would work either."
    case "$_b1_status" in
        http-401|http-403)
            echo ""
            echo "  Cause: the auth server at ${AUTH_URL:-(unset)} rejected the API key"
            echo "  (HTTP ${_b1_status#http-}), so the CodeArtifact credentials were never"
            echo "  fetched and the package install was skipped. Either the key has"
            echo "  expired, or it was minted in a different environment than AUTH_URL"
            echo "  names."
            ;;
        bad-url)
            echo ""
            echo "  Cause: AUTH_URL (${AUTH_URL:-(unset)}) is not an https:// URL, so the"
            echo "  secret fetch refused to send the API key over an unencrypted"
            echo "  connection, and the package install was skipped."
            ;;
        network)
            echo ""
            echo "  Cause: the auth server at ${AUTH_URL:-(unset)} could not be reached,"
            echo "  so the CodeArtifact credentials were never fetched."
            ;;
        http-*|empty|no-url|no-key|no-tools|write-failed)
            echo ""
            echo "  Cause: the secret fetch did not complete ($_b1_status), so the"
            echo "  CodeArtifact credentials were never fetched and the install was"
            echo "  skipped. See the [WARN] lines earlier in this log."
            ;;
        *)
            echo ""
            echo "  If the install was skipped for want of credentials, the reason is in"
            echo "  the [WARN] lines earlier in this log. If PREBUILD_CHECK=true, the"
            echo "  install is skipped by design and a dedicated task performs it."
            ;;
    esac
    echo ""
    echo "  Run 'yarn install' once credentials are configured, then rebuild."
    echo "============================================================================="
    echo ""
    exit 0
fi
# <<< b1-framework-prebuild-guard <<<


# Ensure the workspace scripts are executable
find "${WORKSPACE_ROOT}/node_modules/@buildone/swat-cli/scripts/devcontainer" -type f -name "*.sh" -exec chmod +x {} \;

# Now call the actual prebuild script from the installed package
exec "${WORKSPACE_ROOT}/node_modules/@buildone/swat-cli/scripts/devcontainer/orchestrators/prebuild.sh" "$@"