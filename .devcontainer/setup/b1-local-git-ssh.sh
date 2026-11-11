#!/usr/bin/env bash
# Git's local-container transport; the host SSH configuration remains read-only.
set -euo pipefail

if [[ "${1:-}" == --command ]]; then
  ssh_command="$2"
  shift 2
elif ssh_command="$(git config --get core.sshCommand)"; then
  :
elif [[ -n "${GIT_SSH:-}" ]]; then
  exec "$GIT_SSH" "$@"
else
  ssh_command=ssh
fi

# A macOS IdentityAgent in the mounted config (1Password, Secretive) names a
# socket that does not exist here, and it beats SSH_AUTH_SOCK. When the agent
# OpenSSH resolved for this host is such a path and an agent is forwarded, point
# it at the forwarded one; options given on the command line come first, so this
# wins over the config. `none`, SSH_AUTH_SOCK, a variable and a socket that does
# exist are left as they are (B1-1539). $1 is `ssh -G` output for the connection.
forwarded_agent() {
  local resolved
  agent=()
  [[ -S "${SSH_AUTH_SOCK:-}" ]] || return 0
  resolved="$(sed -n 's/^identityagent //p' <<< "$1" | head -n 1)"
  case "$resolved" in
    '' | none | SSH_AUTH_SOCK | '$'*) return 0 ;;
  esac
  [[ -S "$resolved" ]] || agent=(-o IdentityAgent=SSH_AUTH_SOCK)
}

ssh() {
  local ignore=UseKeychain option diagnostics
  local ignored_pattern='^debug1: .* line [0-9]+: Ignored unknown option "([a-z0-9_-]+)"'
  local socket=false args=() agent=()
  for argument in "$@"; do
    if [[ "$socket" == true ]]; then socket=false; continue; fi
    case "$argument" in
      -S) socket=true; continue ;;
      -S*) continue ;;
    esac
    args+=("$argument")
  done
  if [[ -z "${args[*]:-}" ]]; then exec /usr/bin/ssh; fi
  set -- "${args[@]}"
  # Let OpenSSH interpret quoted options, Include and host-specific ignore lists.
  if diagnostics=$(command /usr/bin/ssh -v -G "$@" 2>&1); then
    forwarded_agent "$diagnostics"
    exec /usr/bin/ssh ${agent[@]+"${agent[@]}"} -o ControlMaster=no -o ControlPath=none "$@"
  fi
  # shortcut: an Include that aborts this probe can hide later ignored options; fix that host config if it still fails.
  while IFS= read -r option; do
    if [[ "$option" =~ $ignored_pattern ]]; then
      ignore+=",${BASH_REMATCH[1]}"
    fi
  done <<< "$diagnostics"
  # The failed probe printed no configuration; resolve it again with the options that make it parse.
  forwarded_agent "$(command /usr/bin/ssh -o "IgnoreUnknown=$ignore" -G "$@" 2> /dev/null)"
  exec /usr/bin/ssh ${agent[@]+"${agent[@]}"} -o "IgnoreUnknown=$ignore" -o ControlMaster=no -o ControlPath=none "$@"
}

# Cover the standard absolute command regardless of the user's shell quoting.
function /usr/bin/ssh { ssh "$@"; }
# Git already treats core.sshCommand/GIT_SSH_COMMAND as trusted shell commands.
eval "$ssh_command \"\$@\""
