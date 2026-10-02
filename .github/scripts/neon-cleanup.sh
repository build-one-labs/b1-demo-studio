#!/bin/bash
# =============================================================================
# Neon dev-branch cleanup (B1-972)
# =============================================================================
# In Neon DB mode every git branch spawns a per-user Neon branch named
# "{github-user}/{sanitized-git-branch}" (see neon-bootstrap.sh). Those branches
# are not removed when the git branch goes away, so they accrue storage cost.
# This script prunes them. Two modes:
#
#   by-ref <git-head-ref>   Delete Neon branches for one (merged/closed) git ref.
#   ttl-sweep               Delete dev Neon branches unused for NEON_BRANCH_TTL_DAYS.
#
# Requires: NEON_API_KEY (env). Reads NEON_PROJECT_ID, NEON_PARENT_BRANCH and
# NEON_BRANCH_TTL_DAYS from the environment, falling back to repo-root .env.
# Safe by design: never deletes top-level branches (no "/" in the name) nor the
# parent/main/develop branches.
#
# Shipped to customer repositories, with neon-branch-cleanup.yml and
# neon-branch-sweep.yml, by the 24.3.0-VG.467 migration. Their copy is this file
# byte for byte (a test fails when the two drift), so a change here reaches
# them only through a new migration.
#
# Missing config is an error in CI and a no-op elsewhere (B1-1255). It used to
# be a no-op everywhere, and the jobs that run this went green for two and a
# half months while deleting nothing — first without NEON_API_KEY, then with
# NEON_PROJECT_ID overwritten by an empty step env — until the branches they
# should have pruned showed up on the Neon bill.
# =============================================================================
set -euo pipefail

MODE="${1:-}"

log() { echo "[neon-cleanup] $*"; }

# Read a KEY=value from repo-root .env if the var is not already set.
#
# Undoes the quoting the CLI's upsert_env_var applies (see read_env_var in
# scripts/devcontainer/lib/common.sh — not sourced here, to keep this CI script
# independent of the CLI tree). A bare `cut -d= -f2-` returns a quoted value
# with its quotes still attached, and a project id wearing quotes matches no
# project. Unquoted values, as the tracked .env writes them, pass through.
env_from_file() {
  local key="$1" current line value
  current="${!key:-}"
  if [[ -n "$current" ]]; then
    printf '%s' "$current"
    return 0
  fi
  [[ -f .env ]] || return 0

  line=$(grep -E "^${key}=" .env | tail -n1) || return 0
  [[ -n "$line" ]] || return 0
  value="${line#*=}"

  if [[ "$value" == \'*\' ]]; then
    value="${value:1:${#value}-2}"
    value="${value//\'\\\'\'/\'}"
  elif [[ "$value" == \"*\" ]]; then
    value="${value:1:${#value}-2}"
  fi

  printf '%s' "$value"
}

# A job that was asked to clean up and could not must not report success.
# Outside CI (someone running this by hand) there is nobody to alert, and
# skipping is the useful answer.
missing_config() {
  if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
    echo "::error title=Neon branch cleanup::$1 not set — no branches can be cleaned up."
    log "ERROR: $1 not set. In CI it comes from the B1 secret store via"
    log "       .github/actions/b1-secrets (or the Actions secret/variable fallback)."
    exit 1
  fi
  log "$1 not set — skipping Neon branch cleanup."
  exit 0
}

# --- Configuration -----------------------------------------------------------
[[ -n "${NEON_API_KEY:-}" ]] || missing_config NEON_API_KEY
export NEON_API_KEY

# The environment wins; the repo-root .env is a fallback for workspaces that
# still pin these. NEON_PROJECT_ID is no longer in the tracked .env — it is
# per-repository — so CI passes it in as a variable (see the workflows).
NEON_PROJECT_ID="${NEON_PROJECT_ID:-$(env_from_file NEON_PROJECT_ID)}"
NEON_PARENT_BRANCH="${NEON_PARENT_BRANCH:-$(env_from_file NEON_PARENT_BRANCH)}"
NEON_PARENT_BRANCH="${NEON_PARENT_BRANCH:-develop}"
NEON_BRANCH_TTL_DAYS="${NEON_BRANCH_TTL_DAYS:-$(env_from_file NEON_BRANCH_TTL_DAYS)}"
NEON_BRANCH_TTL_DAYS="${NEON_BRANCH_TTL_DAYS:-7}"

[[ -n "$NEON_PROJECT_ID" ]] || missing_config NEON_PROJECT_ID

# --- Guards ------------------------------------------------------------------
# A branch is protected if it has no "/" (top-level, e.g. main/develop/parent)
# or its suffix after "/" is a protected name.
is_protected() {
  local name="$1"
  [[ "$name" != */* ]] && return 0
  case "${name#*/}" in
    main | develop | "$NEON_PARENT_BRANCH") return 0 ;;
  esac
  return 1
}

DELETED=0
FAILED=0
KEPT=0

delete_branch() {
  local id="$1" name="$2"
  log "Deleting Neon branch: $name ($id)"
  if neonctl branches delete "$id" --project-id "$NEON_PROJECT_ID" >/dev/null; then
    DELETED=$((DELETED + 1))
  else
    FAILED=$((FAILED + 1))
    log "WARN: failed to delete $name ($id) — continuing"
  fi
}

# One line in the job summary, so the result is visible without opening the
# log — a sweep that deletes nothing night after night should look odd.
write_summary() {
  log "Deleted ${DELETED}, kept ${KEPT}, failed ${FAILED}."
  [[ -n "${GITHUB_STEP_SUMMARY:-}" ]] || return 0
  echo "Neon branch cleanup (${MODE}): deleted **${DELETED}**, kept ${KEPT}, failed ${FAILED}." \
    >>"$GITHUB_STEP_SUMMARY"
}

# --- Tooling -----------------------------------------------------------------
# Pinned: this script reads neonctl's JSON, and a new major landing here would
# make the nightly sweep fail — or worse, misread — without warning. Keep in
# step with B1_NEONCTL_VERSION in the CLI's scripts/devcontainer/lib/common.sh
# (not sourced here, to keep this script independent of the CLI tree).
NEONCTL_VERSION="3.1.0"
if ! command -v neonctl &>/dev/null; then
  log "Installing neonctl ${NEONCTL_VERSION}"
  # The install failure was discarded, leaving the next neonctl call to fail
  # confusingly instead.
  if ! NPM_OUTPUT=$(npm install -g "neonctl@${NEONCTL_VERSION}" 2>&1); then
    log "ERROR: failed to install neonctl ${NEONCTL_VERSION}"
    log "npm: ${NPM_OUTPUT}"
    exit 1
  fi
fi

BRANCHES_JSON="$(neonctl branches list --project-id "$NEON_PROJECT_ID" --output json)"

# --- Modes -------------------------------------------------------------------
case "$MODE" in
  by-ref)
    HEAD_REF="${2:-}"
    if [[ -z "$HEAD_REF" ]]; then
      log "ERROR: by-ref requires a git head ref argument."
      exit 1
    fi
    # Same sanitisation as neon-bootstrap.sh.
    SANITIZED="$(echo "$HEAD_REF" | sed 's/[^a-zA-Z0-9_-]/-/g')"
    log "Head ref '$HEAD_REF' -> sanitized '$SANITIZED'"

    MATCHES="$(echo "$BRANCHES_JSON" \
      | jq -r --arg suffix "/$SANITIZED" \
        '.[] | select(.name | endswith($suffix)) | "\(.id)\t\(.name)"')"

    if [[ -z "$MATCHES" ]]; then
      log "No Neon branch matching '*/$SANITIZED' — nothing to delete."
      exit 0
    fi

    while IFS=$'\t' read -r id name; do
      [[ -z "$name" ]] && continue
      if is_protected "$name"; then
        log "Skipping protected branch: $name"
        KEPT=$((KEPT + 1))
        continue
      fi
      delete_branch "$id" "$name"
    done <<<"$MATCHES"
    ;;

  ttl-sweep)
    log "Sweeping dev branches unused for ${NEON_BRANCH_TTL_DAYS} day(s)"
    CUTOFF_EPOCH=$(( $(date -u +%s) - NEON_BRANCH_TTL_DAYS * 86400 ))

    # Last use, not age. A branch's compute endpoint records when it last ran
    # (last_active); a workspace that has been on one git branch for weeks is
    # still using its database, and sweeping by created_at deleted it from under
    # the running stack. A branch whose compute never ran falls back to its
    # creation time. Read from a file, not --argjson: the endpoint list runs to
    # hundreds of kilobytes, past the kernel's per-argument limit.
    ENDPOINTS_FILE="$(mktemp)"
    trap 'rm -f "$ENDPOINTS_FILE"' EXIT
    if ! neonctl api "/projects/${NEON_PROJECT_ID}/endpoints" --output json >"$ENDPOINTS_FILE"; then
      log "ERROR: could not list the project's compute endpoints — deleting nothing."
      exit 1
    fi

    # Process substitution, not a pipe: a pipe runs the loop in a subshell and
    # the counters for the summary would be lost with it.
    while IFS=$'\t' read -r id name last_used; do
      [[ -z "$name" ]] && continue
      if is_protected "$name"; then
        log "Skipping protected branch: $name"
        KEPT=$((KEPT + 1))
        continue
      fi
      last_epoch=$(date -u -d "$last_used" +%s 2>/dev/null || echo 0)
      if [[ "$last_epoch" -eq 0 ]]; then
        log "WARN: could not parse last use '$last_used' for $name — skipping"
        KEPT=$((KEPT + 1))
        continue
      fi
      if [[ "$last_epoch" -lt "$CUTOFF_EPOCH" ]]; then
        delete_branch "$id" "$name"
      else
        log "Keeping recently used branch: $name (last used $last_used)"
        KEPT=$((KEPT + 1))
      fi
    done < <(echo "$BRANCHES_JSON" | jq -r --slurpfile ep "$ENDPOINTS_FILE" '
      .[] | select(.name | contains("/")) | . as $b
      | ([$ep[0].endpoints[]? | select(.branch_id == $b.id) | .last_active // empty]
         + [$b.created_at] | max) as $last
      | "\(.id)\t\(.name)\t\($last)"')
    ;;

  *)
    log "ERROR: unknown mode '$MODE' (expected 'by-ref <ref>' or 'ttl-sweep')."
    exit 1
    ;;
esac

write_summary
log "Done."
