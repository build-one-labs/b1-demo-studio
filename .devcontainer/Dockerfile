FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

RUN apt-get update && \
  apt-get install -y --no-install-recommends \
  bubblewrap \
  python3 python3-dev python3-venv python3-pip build-essential gh && \
  rm -rf /var/lib/apt/lists/*