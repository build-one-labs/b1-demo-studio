FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

RUN apt-get update && \
  apt-get install -y --no-install-recommends \
  bubblewrap \
  python3 python3-dev python3-venv python3-pip build-essential gh && \
  rm -rf /var/lib/apt/lists/*

# Install the AWS CLI v2.
#
# Deliberately not ghcr.io/devcontainers/features/aws-cli: that feature's
# manifest force-installs AmazonWebServices.aws-toolkit-vscode and offers no way
# to decline it. The toolkit costs ~75 MB of extension, plus a CloudFormation
# language server it downloads on activation - 213 MB into ~/.cache/aws, ~246 MB
# resident - to support a CLI this workspace calls twice, both in poststart.sh:
# `aws codeartifact get-authorization-token` and `aws ecr get-login-password`.
#
# The version is pinned rather than tracked at latest, so rebuilding an old
# commit installs what that commit was tested with. Bump it deliberately.
#
# On the signature check: AWS still signs releases with a key whose stated
# expiry has lapsed (extended twice, most recently to 2026-07-07, and in use
# after it). `gpg --verify` exits 0 on an expired key, so the exit code alone
# would not distinguish a valid signature from that state - or notice a
# downgrade to no signature at all. Matching the status line instead accepts a
# good signature from this one key, tolerating only its expiry, and leaves
# BADSIG, REVKEYSIG and an unknown signer failing the build.
ARG AWSCLI_VERSION=2.36.31
COPY setup/awscli-team.gpg.asc /tmp/awscli-team.gpg.asc
RUN set -eux; \
  url="https://awscli.amazonaws.com/awscli-exe-linux-x86_64-${AWSCLI_VERSION}.zip"; \
  curl -fsSL "${url}" -o /tmp/awscli.zip; \
  curl -fsSL "${url}.sig" -o /tmp/awscli.zip.sig; \
  export GNUPGHOME=/tmp/awscli-gnupg; \
  mkdir -m 700 -p "${GNUPGHOME}"; \
  gpg --batch --quiet --import /tmp/awscli-team.gpg.asc; \
  gpg --batch --status-fd 1 --verify /tmp/awscli.zip.sig /tmp/awscli.zip 2>/dev/null \
    | grep -qE '^\[GNUPG:\] (GOODSIG|EXPKEYSIG) A6310ACC4672475C '; \
  unzip -q /tmp/awscli.zip -d /tmp/awscli-dist; \
  /tmp/awscli-dist/aws/install; \
  mkdir -p /etc/bash_completion.d /usr/local/share/zsh/site-functions; \
  echo 'complete -C aws_completer aws' > /etc/bash_completion.d/aws; \
  printf '#compdef aws\nautoload -U +X bashcompinit && bashcompinit\ncomplete -C aws_completer aws\n' \
    > /usr/local/share/zsh/site-functions/_aws; \
  rm -rf /tmp/awscli.zip /tmp/awscli.zip.sig /tmp/awscli-dist /tmp/awscli-team.gpg.asc "${GNUPGHOME}"; \
  aws --version
