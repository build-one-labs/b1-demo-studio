#!/usr/bin/env bash
# =============================================================================
# Fetch this repository's secrets from the auth server into the job environment
# =============================================================================
# The CI half of the workspace secret fetch (see
# src/cli/scripts/devcontainer/orchestrators/fetch-user-secrets.sh). Same
# endpoint, same key, same naming rule; a different destination — $GITHUB_ENV
# rather than a sourced .env file — and one thing a workspace does not have to
# do at all:
#
# MASKING IS THE POINT
# A value fetched here is not an Actions secret, so none of GitHub's automatic
# redaction applies to it. Without ::add-mask:: the first step that runs with
# `set -x`, or any command that echoes its environment on failure, prints AWS
# credentials into a public log. So every value is masked BEFORE it is written
# anywhere, and this script never prints a value itself — only names and counts.
# Multi-line values are masked line by line as well as whole, because the runner
# matches masks against individual log lines.
#
# There are two exceptions. A value too short to mask without collateral damage
# (see min_mask_length below, which exists because masking a two-character one
# broke a release), and a value the calling workflow declares non-sensitive (see
# unmasked_keys). Both are exported in the clear; the first is warned about
# because nobody chose it, the second is not because somebody did.
#
# PRECEDENCE
# A variable already set in the job environment is left alone and reported. That
# is how a workflow pins a value (a real Actions secret, a matrix value) and how
# a job stays working when the auth server is unreachable — the same
# "explicitly set wins" rule the workspace files use.
#
# KEPT IN STEP
# The response shapes and the secret-key-to-variable-name rule are duplicated
# from fetch-user-secrets.sh and lib/common.sh deliberately: this runs before
# `yarn install`, from a checkout that may not have the CLI available, and an
# action that depends on the tree it is meant to help build is an action that
# fails first. Changes to either rule belong in both places.
# =============================================================================
set -uo pipefail

# EVERY VARIABLE IN THIS SCRIPT IS LOWERCASE, AND THAT IS LOAD-BEARING.
# The export loop decides a secret is already pinned in the job environment with
# `[[ -n "${!name:-}" ]]`, where `name` came from env_name_from_secret_key. An
# indirect expansion cannot tell a variable inherited from the job from one this
# script set a moment ago, so any local name that a secret key could also
# produce is a secret this script silently drops.
#
# That is not hypothetical. These five were once uppercase, and `auth-url` — a
# key in the default unmasked-keys list below, so plainly one we expect to
# export — resolved to the AUTH_URL assigned here. Every repository ran CI
# without it, the log said "Left 1 already set in the environment: AUTH_URL",
# and the first workflow that actually read the value failed twelve minutes
# into a stack that could not reach an auth server.
#
# env_name_from_secret_key can only ever emit ^[A-Z][A-Z0-9_]*$, so a name
# holding a lowercase letter cannot collide with one — by construction, not by
# our remembering to check. Keep them lowercase. GITHUB_ENV and GITHUB_OUTPUT
# below are the deliberate exceptions: those two are meant to come from the
# runner, and a secret named `github-env` has no business overwriting either.
# The workspace half of this fetch follows the same rule — see the `api_key`
# local in devcontainer/orchestrators/fetch-user-secrets.sh.
auth_url="${B1_SECRETS_AUTH_URL:-}"
api_key="${B1_SECRETS_API_KEY:-}"
scope="${B1_SECRETS_SCOPE:-}"
require="${B1_SECRETS_REQUIRE:-}"
unmasked_keys="${B1_SECRETS_UNMASKED_KEYS:-}"

# Outside a runner these land in throwaway files rather than failing, so the
# script can be tested and run by hand.
GITHUB_ENV="${GITHUB_ENV:-/dev/null}"
GITHUB_OUTPUT="${GITHUB_OUTPUT:-/dev/null}"

fail() {
  echo "::error title=B1 secrets::$*"
  exit 1
}

[[ -n "${auth_url}" ]] || fail "auth-url is empty. Set it to the auth server the API key was minted at."
[[ -n "${api_key}" ]] || fail "api-key is empty. Provide an organization API key (b1o_…)."

auth_url="${auth_url%/}"

# The key travels in a request header, so the transport has to be encrypted
# before the request is made — there is no undoing it afterwards. curl reads a
# scheme-less URL as http://, which would put the key on the wire in clear text
# and then fail on the redirect to https.
case "${auth_url}" in
  https://*) ;;
  http://localhost | http://localhost:* | http://127.0.0.1 | http://127.0.0.1:*) ;;
  *) fail "auth-url (${auth_url}) is not https. Refusing to send the API key over an unencrypted connection." ;;
esac

command -v jq >/dev/null 2>&1 || fail "jq is required and is not on PATH."

query=''
if [[ -n "${scope}" ]]; then
  # Percent-encode the '/' so owner/name cannot be read as a path segment.
  query="?scope=${scope//\//%2F}"
  echo "Resolving secrets from ${auth_url} for scope ${scope}"
else
  echo "Resolving secrets from ${auth_url} (unscoped)"
fi

response=$(curl -sS --connect-timeout 10 --max-time 30 -w '\n%{http_code}' \
  -H "x-api-key: ${api_key}" \
  "${auth_url}/api/secrets/resolve-all${query}" 2>/dev/null) ||
  fail "Could not reach ${auth_url}. Check the auth server is up and the runner has network access."

http_code="${response##*$'\n'}"
body="${response%$'\n'*}"

case "${http_code}" in
  200) ;;
  401 | 403)
    fail "The auth server rejected the API key. A key only works at the server that minted it — check the key was minted at ${auth_url}, and that it has not been revoked."
    ;;
  *) fail "The auth server answered HTTP ${http_code}." ;;
esac

# `.secret` may be a plain string, a JSON object, or a JSON-encoded string
# wrapping { secret | value } — the write routes JSON.stringify whatever body
# they were given, so all three shapes exist in the store. Emit `key<TAB>base64`
# so a value holding spaces or newlines survives the read loop intact; tab
# because the server's key charset has no tab in it, so a malformed key keeps
# its whole self on the left of the split instead of being silently cut in half.
secret_stream_filter='
  .secrets[]
  | .key as $k
  | .secret as $s
  | ( if ($s | type) == "object" then ($s.secret // $s.value // "")
      elif ($s | type) == "string" then
        ( (try ($s | fromjson) catch null) as $inner
          | if ($inner | type) == "object" then ($inner.secret // $inner.value // $s) else $s end )
      else ($s | tostring) end ) as $v
  | select($v != null and $v != "")
  | "\($k)\t\($v | @base64)"
'

# Secrets are stored under the variable name lowercased with dashes
# (NEON_API_KEY -> neon-api-key); this reverses that. Dots map to underscores
# too, since the key charset allows them. A name that could not be a variable at
# all is refused — and named, because "my secret is on the server but not in my
# environment" is otherwise a silent and very confusing failure.
env_name_from_secret_key() {
  local name
  name=$(printf '%s' "$1" | tr 'a-z.-' 'A-Z__')
  [[ "${name}" =~ ^[A-Z][A-Z0-9_]*$ ]] || return 1
  printf '%s' "${name}"
}

# Below this, masking does more harm than good — see the note at the mask.
min_mask_length=8

# The values declared non-sensitive by the caller — see the `unmasked-keys` input
# in action.yml, which carries the default list and the reasoning for it. These
# are deployment coordinates: a Portainer account name, a registry path, an
# environment name. They live in the secret store only because that is where
# provisioning puts them, and they are masked today only because everything here
# is. Masking one protects nothing (the credential beside it is what matters) and
# costs the same global search-and-replace over the run's output that the
# short-value note below describes.
#
# THE DECLARATION LIVES IN THIS REPOSITORY, NOT THE STORE.
# That is the whole point of putting it here. Whoever can write a shared
# organization or global secret can already set any variable in any job that
# reads one — but they cannot decide that their value stops being masked, because
# that takes a change to a reviewed file. A flag on the secret itself would hand
# the same person both halves.
#
# Accepts either form of a name — `portainer-account` as the store holds it, or
# `PORTAINER_ACCOUNT` as the job sees it — since both are what someone reading
# the log has in front of them. Entries are normalised to the variable name and
# matched against that. A name no secret answers to is simply inert: the list is
# shared by every caller, so most jobs declare more than they fetch.
declared_unmasked=' '
for entry in ${unmasked_keys}; do
  if entry_name=$(env_name_from_secret_key "${entry}"); then
    declared_unmasked+="${entry_name} "
  else
    fail "unmasked-keys entry '${entry}' is not a usable secret key or variable name."
  fi
done

exported=0
kept=0
skipped_keys=()
unmasked_names=()
declared_names=()
exported_names=()
kept_names=()

while IFS=$'\t' read -r key encoded; do
  [[ -n "${key}" ]] || continue

  if ! name=$(env_name_from_secret_key "${key}"); then
    skipped_keys+=("${key}")
    continue
  fi

  value=$(printf '%s' "${encoded}" | base64 -d 2>/dev/null) || continue
  [[ -n "${value}" ]] || continue

  if [[ -n "${!name:-}" ]]; then
    kept=$((kept + 1))
    kept_names+=("${name}")
    continue
  fi

  # Mask first — the whole value, and, because the runner matches masks per log
  # line, each line of a multi-line one.
  #
  # EXCEPT WHEN THE VALUE IS TOO SHORT TO MASK SAFELY.
  # A mask is a global search-and-replace over everything the run emits, so a
  # two-character value turns every occurrence of those two characters into
  # ***, everywhere. That is not a hypothetical: `portainer-account` holds "b1",
  # and masking it redacted "b1" out of image names, package names and branch
  # names across the whole workflow — and, because GitHub drops any job output
  # containing a masked value, silently emptied the version output that every
  # publish job depends on. The images were then tagged with a branch name,
  # which is not a valid Docker tag, and the publish failed a long way from the
  # cause.
  #
  # So a value below min_mask_length is exported unmasked and named in a warning.
  # This is the same rule GitLab enforces on masked variables, and for the same
  # reason: a secret that short cannot be masked without breaking the log, and
  # cannot be kept secret by masking anyway — it appears by chance in ordinary
  # output. If such a value really is sensitive, it needs to be longer; if it is
  # not, it belongs in an Actions variable rather than the secret store.
  #
  # A value the workflow declared non-sensitive is not masked either, and not
  # warned about — the warning exists to surface a decision nobody made, and
  # here somebody made it. It is still reported by name below, because a value
  # leaving this step in the clear should never be something you have to read
  # the workflow file to discover.
  if [[ "${declared_unmasked}" == *" ${name} "* ]]; then
    declared_names+=("${name}")
  elif ((${#value} >= min_mask_length)); then
    echo "::add-mask::${value}"
    if [[ "${value}" == *$'\n'* ]]; then
      while IFS= read -r line; do
        [[ -n "${line}" ]] && echo "::add-mask::${line}"
      done <<<"${value}"
    fi
  else
    unmasked_names+=("${name}")
  fi

  # Heredoc form, so a value containing newlines or '=' survives. The delimiter
  # is randomised per value: a fixed one appearing inside a secret would let that
  # secret write arbitrary further variables into the job environment.
  delimiter="B1_SECRET_EOF_${RANDOM}${RANDOM}"
  if [[ "${value}" == *"${delimiter}"* ]]; then
    skipped_keys+=("${key} (value collides with its own delimiter)")
    continue
  fi
  {
    printf '%s<<%s\n' "${name}" "${delimiter}"
    printf '%s\n' "${value}"
    printf '%s\n' "${delimiter}"
  } >>"${GITHUB_ENV}"

  exported=$((exported + 1))
  exported_names+=("${name}")
done < <(printf '%s' "${body}" | jq -r "${secret_stream_filter}" 2>/dev/null)

# Names only — never values.
echo "Exported ${exported} secret(s): ${exported_names[*]:-none}"
if [[ ${kept} -gt 0 ]]; then
  echo "Left ${kept} already set in the environment: ${kept_names[*]}"
fi
if [[ ${#declared_names[@]} -gt 0 ]]; then
  echo "Exported unmasked, declared non-sensitive: ${declared_names[*]}"
fi
if [[ ${#unmasked_names[@]} -gt 0 ]]; then
  echo "::warning title=B1 secrets::Exported without masking, being shorter than ${min_mask_length} characters: ${unmasked_names[*]}. A value this short cannot be masked without redacting ordinary text from the whole run. Store it as an Actions variable if it is not sensitive, or make it longer if it is."
fi
if [[ ${#skipped_keys[@]} -gt 0 ]]; then
  echo "::warning title=B1 secrets::Skipped ${#skipped_keys[@]} secret(s) whose name cannot be an environment variable: ${skipped_keys[*]}"
fi

printf 'count=%s\n' "${exported}" >>"${GITHUB_OUTPUT}"

# A job that names what it needs fails here, with the names, rather than three
# steps later inside a tool that only says it could not authenticate.
if [[ -n "${require}" ]]; then
  missing=()
  for name in ${require}; do
    # An exported value is not in this shell's environment — it reaches the job
    # through $GITHUB_ENV, which the runner applies after this step. So check
    # what was exported here as well as what was already set.
    if [[ -z "${!name:-}" ]] && [[ ! " ${exported_names[*]:-} " == *" ${name} "* ]]; then
      missing+=("${name}")
    fi
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    fail "Required secret(s) not available from ${auth_url}: ${missing[*]}. Provision them for this organization (or this repository's scope), or set them as Actions secrets."
  fi
fi
