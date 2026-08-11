#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Codespace Startup Orchestrator
# =============================================================================
# This script orchestrates the Codespace startup sequence:
# 1. Project rename (if needed)
# 2. Stack startup
#
# All steps run sequentially in the same terminal for a clean UX.
# =============================================================================

WORKSPACE_ROOT="${WORKSPACE_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null)}"

# >>> b1-startup-toolchain-guard (managed by @buildone/swat-cli migration; safe to re-run) >>>
# Every helper this script calls - secrets_print_header, secrets_init_paths and
# the rest - comes from swat-cli, inside node_modules. When the prebuild could
# not obtain CodeArtifact credentials it skips `yarn install`, so node_modules
# never exists and none of them are defined.
#
# The shape this replaces guarded the `source` with `if [ -f … ]` and then
# called the helpers anyway, outside the guard. So the one situation the guard
# existed for - the file being absent - was precisely the situation it did not
# cover, and startup died on
#
#     secrets_print_header: command not found      (exit 127)
#
# naming neither the missing install nor its cause. Guarding a source and then
# using what it defines regardless is the bug; the file being missing has to
# stop the script.
#
# The cause was established two lifecycle stages earlier by the
# b1-user-secret-fetch block in .devcontainer/setup/prebuild.sh, which records
# it in .b1/env/.prebuild-status. Read it here rather than making the reader
# find creation.log.
#
# This decoding is duplicated in the b1-projectconfig-toolchain-guard block in
# .devcontainer/scripts/lib/project-config.sh, deliberately and not by
# oversight. Factoring it into a shared .devcontainer/scripts/lib/ file would be
# DRY-er, and would also make a guard whose entire purpose is to survive a
# missing file depend on a file that could be missing. Each block runs on
# nothing but bash and the file it lives in. The cost - a message change has to
# be made twice - is the intended trade.
SWAT_SECRETS_CONFIG="${WORKSPACE_ROOT}/node_modules/@buildone/swat-cli/scripts/devcontainer/lib/secrets-config.sh"
if [ ! -f "$SWAT_SECRETS_CONFIG" ]; then
    _b1_status=''
    _b1_url=''
    _b1_status_file="${WORKSPACE_ROOT}/.b1/env/.prebuild-status"
    if [ -f "$_b1_status_file" ]; then
        _b1_status=$(sed -n 's/^B1_SECRET_FETCH_STATUS=//p' "$_b1_status_file" 2>/dev/null)
        _b1_url=$(sed -n 's/^B1_SECRET_FETCH_URL=//p' "$_b1_status_file" 2>/dev/null)
    fi
    [ -n "$_b1_url" ] || _b1_url='(unknown)'

    echo ""
    echo "============================================================================="
    echo "  TOOLCHAIN NOT INSTALLED - STACK NOT STARTED"
    echo "============================================================================="
    echo ""
    echo "  node_modules/@buildone/swat-cli is not installed, so the startup helpers"
    echo "  this script needs do not exist."
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
    echo "  Fix the cause above, then run 'yarn install' and start the stack again."
    echo "============================================================================="
    echo ""
    exit 1
fi
source "$SWAT_SECRETS_CONFIG"
secrets_init_paths
# <<< b1-startup-toolchain-guard <<<

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# =============================================================================
# Step 1: Project Rename
# =============================================================================
run_project_setup() {
  if ! secrets_is_codespace; then
    return 0
  fi

  secrets_print_section "Step 1: Checking Project Configuration"

  "$SCRIPT_DIR/project-rename-init.sh"
}

# =============================================================================
# Step 2: Stack Startup
# =============================================================================
run_stack_startup() {
  secrets_print_section "Step 2: Starting Stack"

  local task_runner="$WORKSPACE_ROOT/node_modules/@buildone/swat-cli/scripts/devcontainer/lib/task-runner.sh"

  if [ -f "$task_runner" ]; then
    "$task_runner" start_stack
  else
    secrets_print_warning "Task runner not found. Stack startup skipped."
    secrets_print_info "Run 'yarn install' and restart the Codespace."
  fi
}

# =============================================================================
# Main
# =============================================================================
main() {
  echo ""
  secrets_print_header "Codespace Startup"

  # Step 1: Project rename (only if secrets are configured)
  run_project_setup

  # Step 2: Start the stack
  run_stack_startup
}

main "$@"
