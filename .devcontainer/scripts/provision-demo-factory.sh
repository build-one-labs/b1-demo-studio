#!/usr/bin/env bash
#
# Make the Demo Factory Studio's pipeline runnable in this workspace, on every
# Codespace start.
#
# The Studio spawns the pipeline inside the *app server's* container, which in a
# workspace is a stock slim node image with the repository bind-mounted: no
# factory dependencies, no browser, no ffmpeg, no API key. Every stage button —
# `Run full demo` first among them — is therefore disabled with a reason, and
# stays disabled until somebody remembers to run `npm run provision` by hand.
# This is that command, wired to the container's lifecycle instead.
#
# Two things it must not do: fail the attach, and run too early. Hence the
# unconditional `exit 0` at the end, and the wait below.
set -uo pipefail

WORKSPACE_ROOT="${WORKSPACE_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
FACTORY="${WORKSPACE_ROOT}/src/demo-factory"
LOGFILE="${WORKSPACE_ROOT}/logs/workspace/demo-factory-provision.log"

log() { echo "[demo-factory] $*"; }

# Nothing to provision in a checkout without the factory (it is one product of
# this repository, not a fixture of the template).
[ -d "$FACTORY" ] || exit 0

# Two things launch this: the "Demo Factory" postAttachCommand, and the catch-up
# prebuild that start_stack runs when the workspace was fast-forwarded past the
# commit its prebuild image was built from. In that second case the postAttach
# configuration Codespaces resolved is the *old* devcontainer.json's — the hook
# is not in it — which is why the prebuild launches this as well. When both do
# fire (a fresh prebuild that also catches up), one is enough: whoever loses the
# lock leaves, and the winner does the whole job.
mkdir -p "${WORKSPACE_ROOT}/tmp/workspace"
exec 9>"${WORKSPACE_ROOT}/tmp/workspace/demo-factory-provision.lock"
if ! flock -n 9; then
  log "another provisioning run is already in progress — leaving it to that one"
  exit 0
fi

# Step 3 installs apt packages into a running container, and `build-one up`
# recreates that container — so this waits for the marker the stack start writes
# when the stack is operational rather than for the container to merely exist,
# which would race a compose recreate and lose the install. The markers are
# cleared at the top of each start, so a stale one cannot satisfy this.
#
# 30 minutes: a cold Codespace does a catch-up prebuild, a Neon branch and an
# image pull before the stack is up, and waiting quietly costs nothing. A stack
# that never comes up leaves a line in the log and a button that still explains
# itself on hover.
MARKER="${WORKSPACE_ROOT}/tmp/workspace/markers/stack_operational.done"
DEADLINE=$(( $(date +%s) + 1800 ))
while [ ! -f "$MARKER" ]; do
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then
    log "the stack did not become operational within 30m — skipping"
    log "run 'npm run provision' in src/demo-factory once it is up"
    exit 0
  fi
  sleep 5
done

# The API key the provisioner writes into .env.app-server, so the recording
# browser can sign in. Codespaces secrets are already in this environment; the
# fetched and local files are where a workspace that resolves its secrets from
# the auth server keeps them, and they are not sourced for a postAttachCommand.
for env_file in "${WORKSPACE_ROOT}/.b1/env/.env.fetched" "${WORKSPACE_ROOT}/.b1/env/.env.local"; do
  if [ -f "$env_file" ]; then
    set -a
    # shellcheck source=/dev/null
    . "$env_file"
    set +a
  fi
done

mkdir -p "$(dirname "$LOGFILE")"
log "provisioning (full log: ${LOGFILE})"
node "${FACTORY}/tools/provision-workspace.mjs" 2>&1 | tee -a "$LOGFILE"

# `${PIPESTATUS[0]}` rather than `$?`: the exit status of the pipeline above is
# tee's. Reported, not propagated — a workspace whose Demo Factory could not be
# provisioned is still a working workspace.
status="${PIPESTATUS[0]}"
[ "$status" -eq 0 ] || log "provisioning exited ${status} — see ${LOGFILE}"
exit 0
