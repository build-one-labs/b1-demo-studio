#!/usr/bin/env bash
# =============================================================================
# Project Configuration
# =============================================================================
# Central definition for project rename detection and configuration.
# Source this file from any script that needs to check or rename the project.
# =============================================================================

# >>> b1-projectconfig-toolchain-guard (managed by @buildone/swat-cli migration; safe to re-run) >>>
# The colour, print and secrets helpers this library is built on come from
# swat-cli, inside node_modules. When the prebuild could not obtain CodeArtifact
# credentials it skips `yarn install`, so node_modules never exists.
#
# The shape this replaces sourced that path with no check at all, so the failure
# was a bare
#
#     No such file or directory
#
# against a 120-character path, naming neither the missing install nor its
# cause. The cause was established two lifecycle stages earlier by the
# b1-user-secret-fetch block in .devcontainer/setup/prebuild.sh, which records
# it in .b1/env/.prebuild-status - read here rather than making the reader find
# creation.log.
#
# WHY return, NOT exit
# This is a library. project-rename-init.sh and project-rename-setup.sh source
# it, and `exit` here would reach into a shell that merely sourced a file.
# `return` hands a non-zero status to the caller's `source`, which under their
# `set -e` ends them - with the message already printed. The `|| exit 1` covers
# being run directly, where bash rejects a top-level `return`, and 2>/dev/null
# suppresses bash's complaint in that case.
#
# WHY stderr
# get_suggested_project_name() and its neighbours in this file return values on
# stdout. A diagnostic written there would be captured as a project name.
#
# WHY THE DUPLICATION
# This decoding also appears in the b1-startup-toolchain-guard block in
# .devcontainer/scripts/orchestrators/codespace-startup.sh, deliberately. A
# shared .devcontainer/scripts/lib/ file would be DRY-er and would also make a
# guard whose entire purpose is to survive a missing file depend on a file that
# could be missing. Each block runs on nothing but bash and the file it lives
# in. The cost - a message change has to be made twice - is the intended trade.
#
# The workspace root is computed into this file's own variable, with a pwd
# fallback, because this library is sourced from directories where the
# git rev-parse can fail. Do not normalise it to the startup script's variable.
_WORKSPACE_ROOT_PROJECT_CONFIG="${WORKSPACE_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
_B1_PROJECT_CONFIG_LIB="${_WORKSPACE_ROOT_PROJECT_CONFIG}/node_modules/@buildone/swat-cli/scripts/devcontainer/lib/secrets-config.sh"
if [ ! -f "$_B1_PROJECT_CONFIG_LIB" ]; then
    _b1_status=''
    _b1_url=''
    _b1_status_file="${_WORKSPACE_ROOT_PROJECT_CONFIG}/.b1/env/.prebuild-status"
    if [ -f "$_b1_status_file" ]; then
        _b1_status=$(sed -n 's/^B1_SECRET_FETCH_STATUS=//p' "$_b1_status_file" 2>/dev/null)
        _b1_url=$(sed -n 's/^B1_SECRET_FETCH_URL=//p' "$_b1_status_file" 2>/dev/null)
    fi
    [ -n "$_b1_url" ] || _b1_url='(unknown)'

    {
        echo ""
        echo "============================================================================="
        echo "  TOOLCHAIN NOT INSTALLED - PROJECT RENAME UNAVAILABLE"
        echo "============================================================================="
        echo ""
        echo "  node_modules/@buildone/swat-cli is not installed, so the helpers this"
        echo "  library is built on do not exist."
        echo ""
        case "$_b1_status" in
            http-401|http-403)
                echo "  Cause: the auth server at ${_b1_url} rejected the API key"
                echo "  (HTTP ${_b1_status#http-}) during the prebuild, so the CodeArtifact"
                echo "  credentials were never fetched and 'yarn install' was skipped."
                echo "  Either the key has expired, or it was minted in a different"
                echo "  environment than AUTH_URL names - a key and a URL from two"
                echo "  environments produce exactly this."
                ;;
            http-*)
                echo "  Cause: the auth server at ${_b1_url} answered HTTP"
                echo "  ${_b1_status#http-} to the prebuild's secret fetch, so the"
                echo "  CodeArtifact credentials never arrived and 'yarn install' was"
                echo "  skipped."
                ;;
            bad-url)
                echo "  Cause: AUTH_URL (${_b1_url}) is not an https:// URL, so the prebuild"
                echo "  refused to send the API key over an unencrypted connection and"
                echo "  'yarn install' was skipped. Note a value with no scheme at all is"
                echo "  read as http:// and hits this."
                ;;
            network)
                echo "  Cause: the auth server at ${_b1_url} could not be reached during the"
                echo "  prebuild (network, DNS or TLS failure), so the CodeArtifact"
                echo "  credentials never arrived and 'yarn install' was skipped."
                ;;
            empty)
                echo "  Cause: the auth server at ${_b1_url} returned no secrets this key can"
                echo "  see. The key is valid, but nothing is provisioned for it - ask an"
                echo "  org owner to grant the CodeArtifact credentials."
                ;;
            no-url)
                echo "  Cause: a B1 API key is set but AUTH_URL is not, so the prebuild could"
                echo "  not contact the auth server. Set AUTH_URL as a Codespaces secret"
                echo "  alongside the key."
                ;;
            no-key)
                echo "  Cause: no B1 API key was set for the auth server this workspace"
                echo "  points at, so the prebuild had no way to fetch the CodeArtifact"
                echo "  credentials. Set one as a Codespaces secret and rebuild:"
                echo ""
                echo "    B1_USER_API_KEY__<HOST>  your key for one auth server - <HOST> is"
                echo "                             the host of AUTH_URL, dots and dashes as"
                echo "                             underscores, uppercased"
                echo "    B1_USER_API_KEY          your key, used for any auth server"
                echo "    B1_ORG_API_KEY           the shared organization key"
                echo ""
                echo "  A key only works at the auth server that minted it, so a key held"
                echo "  under another host's name is deliberately not used here. The"
                echo "  prebuild log names any that were set."
                ;;
            no-tools)
                echo "  Cause: curl, jq or base64 is missing from this image, so the"
                echo "  prebuild's secret fetch could not run."
                ;;
            write-failed)
                echo "  Cause: the prebuild fetched the secrets but could not write"
                echo "  .b1/env/.env.fetched. Check the permissions on .b1/env/."
                ;;
            ok:*)
                echo "  The prebuild's secret fetch succeeded (${_b1_status#ok:} secret(s)"
                echo "  from ${_b1_url}), so the API key and AUTH_URL are not the problem -"
                echo "  the install itself did not complete. Run 'yarn install' and read"
                echo "  its output."
                ;;
            *)
                echo "  No prebuild status was recorded, so the cause is not known here."
                echo "  If this container was just created, the reason is in the [WARN]"
                echo "  lines of the creation log. Otherwise run 'yarn install' and read"
                echo "  its output."
                ;;
        esac
        echo ""
        echo "  Fix the cause above, then run 'yarn install' and try again."
        echo "============================================================================="
        echo ""
    } >&2
    return 1 2>/dev/null || exit 1
fi
source "$_B1_PROJECT_CONFIG_LIB"
# <<< b1-projectconfig-toolchain-guard <<<

# =============================================================================
# Project Name Detection
# =============================================================================

# The template project name that should be replaced
readonly TEMPLATE_PROJECT_NAME="starter"

# Files that contain the project name and need to be updated
readonly PROJECT_NAME_FILES=(
  "package.json"
  ".deploy/standalone.deployment.config.json"
  ".build/deploy/standalone.deployment.config.json"
  ".circleci/config.yml"
)

# Check if this is the original starter repository (not a fork)
is_original_starter_repo() {
  local repo_name=""

  # Get repo name from GITHUB_REPOSITORY (available in Codespaces)
  if [ -n "${GITHUB_REPOSITORY:-}" ]; then
    repo_name=$(echo "$GITHUB_REPOSITORY" | cut -d'/' -f2)
  else
    # Fall back to git remote
    local remote_url=$(git remote get-url origin 2>/dev/null || echo "")
    if [ -n "$remote_url" ]; then
      repo_name=$(basename "$remote_url" .git)
    fi
  fi

  # If the repo is named "starter", this is the original template
  [ "$repo_name" = "$TEMPLATE_PROJECT_NAME" ]
}

# Check if project is a fork that still has template name and needs renaming
is_template_project() {
  # Don't prompt on the original starter repo
  if is_original_starter_repo; then
    return 1  # false - no rename needed
  fi

  local workspace_root="${SECRETS_WORKSPACE_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null)}"

  # Check if package.json contains the template name in repository URL
  if [ -f "$workspace_root/package.json" ]; then
    if grep -q "/${TEMPLATE_PROJECT_NAME}\.git" "$workspace_root/package.json" 2>/dev/null; then
      return 0  # true - still template
    fi
    if grep -q "/${TEMPLATE_PROJECT_NAME}\"" "$workspace_root/package.json" 2>/dev/null; then
      return 0  # true - still template
    fi
  fi

  # Check CircleCI config for template app name
  if [ -f "$workspace_root/.circleci/config.yml" ]; then
    if grep -q "\"app-name\":\"${TEMPLATE_PROJECT_NAME}\"" "$workspace_root/.circleci/config.yml" 2>/dev/null; then
      return 0  # true - still template
    fi
  fi

  return 1  # false - already renamed
}

# Get the current repository name from git remote or GITHUB_REPOSITORY
get_suggested_project_name() {
  local suggested_name=""

  # Try GITHUB_REPOSITORY first (available in Codespaces)
  if [ -n "${GITHUB_REPOSITORY:-}" ]; then
    suggested_name=$(echo "$GITHUB_REPOSITORY" | cut -d'/' -f2)
  else
    # Fall back to git remote
    local remote_url=$(git remote get-url origin 2>/dev/null || echo "")
    if [ -n "$remote_url" ]; then
      # Extract repo name from URL (handles both HTTPS and SSH)
      suggested_name=$(basename "$remote_url" .git)
    fi
  fi

  # Don't suggest "starter" as the new name
  if [ "$suggested_name" = "$TEMPLATE_PROJECT_NAME" ]; then
    suggested_name=""
  fi

  echo "$suggested_name"
}

# Validate project name (lowercase, alphanumeric, hyphens)
validate_project_name() {
  local name="$1"

  # Check not empty
  if [ -z "$name" ]; then
    return 1
  fi

  # Check format: lowercase letters, numbers, hyphens only
  if [[ ! "$name" =~ ^[a-z][a-z0-9-]*[a-z0-9]$ ]] && [[ ! "$name" =~ ^[a-z]$ ]]; then
    return 1
  fi

  # Check no consecutive hyphens
  if [[ "$name" =~ -- ]]; then
    return 1
  fi

  return 0
}

# =============================================================================
# Instructions
# =============================================================================
show_project_rename_instructions() {
  echo -e "${SECRETS_COLOR_BOLD}${SECRETS_COLOR_YELLOW}This repository was forked from the Build.One Starter template.${SECRETS_COLOR_NC}"
  echo ""
  echo -e "${SECRETS_COLOR_CYAN}The project name 'starter' appears in several configuration files${SECRETS_COLOR_NC}"
  echo -e "${SECRETS_COLOR_CYAN}and should be replaced with your project's actual name.${SECRETS_COLOR_NC}"
  echo ""
  echo -e "${SECRETS_COLOR_BOLD}Files that will be updated:${SECRETS_COLOR_NC}"
  for file in "${PROJECT_NAME_FILES[@]}"; do
    echo "  • $file"
  done
}
