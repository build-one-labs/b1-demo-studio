#!/usr/bin/env bash
# PreToolUse(Bash) guard: refuse a web-app production build while the stack's
# dev server is running against `src/web-app/.nuxt`.
#
# `nuxt build` clears Nuxt's buildDir as it starts, and the dev server watches
# that directory — the checkout is bind-mounted, so the container's dev server
# and anything run in the devcontainer share one `.nuxt`. The dev server reacts
# with a full restart, reloading the app in every browser that has it open, and
# says so only in the container log:
#
#     ℹ .nuxt/dist directory has been removed. Restarting Nuxt...
#
# Nothing in the build's output mentions it, which is what makes it hard to
# attribute — so the guard exists to make the cause visible at the moment of
# the mistake rather than after it.
#
# Fail-open by design: no docker, no dev server, an unparseable payload or a
# command shape this does not recognise all allow the call. It is a guard
# against an easy mistake, not a security boundary.
#
# Contract: exit 0 allows the command, exit 2 blocks it and shows stderr to
# Claude. Reads the hook payload as JSON on stdin.
set -uo pipefail

payload=$(cat 2>/dev/null || true)
[ -n "${payload}" ] || exit 0

command=$(printf '%s' "${payload}" | jq -r '.tool_input.command // empty' 2>/dev/null || true)
[ -n "${command}" ] || exit 0

# An explicit build directory is the supported way to build alongside a dev
# server, so anything that sets one has already answered the question.
case "${command}" in
  *NUXT_BUILD_DIR=*) exit 0 ;;
esac

# Everything from the first heredoc marker on is data, not commands — a commit
# message or a doc that quotes the build command must not trip the guard.
command=${command%%<<*}

# Only a segment that actually *invokes* a package runner counts. Mentioning
# the command — `echo`, `grep`, `git commit -m "… yarn … build …"` — must not
# block, so each segment is judged by its first word, not by its content.
builds=0
while IFS= read -r segment; do
  # Strip leading whitespace, then any `VAR=value` prefixes, then read the verb.
  segment=${segment#"${segment%%[![:space:]]*}"}
  while :; do
    case "${segment}" in
      [A-Za-z_]*=*) segment=${segment#* } ;;
      *) break ;;
    esac
  done
  verb=${segment%% *}
  case "${verb##*/}" in
    yarn | npm | pnpm | npx | nuxt) ;;
    *) continue ;;
  esac

  case "${segment}" in
    *@buildone/web-app*)
      case "${segment}" in
        *" build"* | *"build:ci"* | *" generate"* | *" preview"*) builds=1 ;;
      esac
      ;;
  esac
  case "${segment}" in
    *"nuxt build"* | *"nuxt generate"*) builds=1 ;;
  esac
done <<EOF
$(printf '%s' "${command}" | sed 's/&&/\n/g; s/||/\n/g; s/|/\n/g; s/;/\n/g')
EOF
[ "${builds}" -eq 1 ] || exit 0

# Only a running dev server makes it destructive. Without one — CI, a plain
# checkout, a stopped stack — a build is exactly the right thing to do.
docker ps --filter "name=web-app" --format '{{.Names}}' 2>/dev/null | grep -q . || exit 0

cat >&2 <<'MESSAGE'
Blocked: this builds the web-app while the stack's dev server is running.

`nuxt build` clears the build directory the dev server is watching, so the
server fully restarts and the app reloads in every browser that has it open —
not just yours. The cause appears only in the container log, never in the build
output, so it is hard for anyone else to attribute.

Verify the change instead:
  - the dev server has already compiled it — watch the web-app container log
  - `b1 inspect <screen>` checks a screen at runtime
  - CI builds every push

If a local production build is genuinely needed, give it its own directory:
  NUXT_BUILD_DIR=.nuxt-build yarn workspace @buildone/web-app build
MESSAGE
exit 2
