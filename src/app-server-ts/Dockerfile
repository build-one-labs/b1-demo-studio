FROM node:24-alpine

ARG BUILD_VERSION
ARG BUILD_DATE
ARG BUILD_NAME
ARG BUILD_IMAGE

LABEL maintainer="Build.One"
LABEL version=${BUILD_VERSION}
LABEL date=${BUILD_DATE}
LABEL name=${BUILD_NAME}
LABEL image=${BUILD_IMAGE}

ENV NODE_ENV=production
ENV BUILD_VERSION=${BUILD_VERSION}
ENV BUILD_TIME=${BUILD_DATE}

WORKDIR /workspace/src/app-server-ts

COPY --chown=node:node ./node_modules /workspace/node_modules
COPY --chown=node:node ./*.json /workspace/
COPY --chown=node:node ./src/app-server-ts/*.json ./
COPY --chown=node:node ./src/app-server-ts/dist ./dist
COPY --chown=node:node ./src/app-server-ts/start.sh ./
COPY --chown=node:node ./src/app-server-ts/drizzle ./drizzle

RUN chmod +x ./start.sh

# ---------------------------------------------------------------------------
# Demo Factory runtime
#
# The Demo Factory Studio screen runs its pipeline through this server, and two
# of its four stages shell out: Record drives a browser through Playwright,
# Render composes the video with Remotion and normalises clips with ffmpeg.
# Without the tools below the Studio disables both stages (see the
# `capabilities` action) and only Validate and Prepare work.
#
# One Chromium, three users. Playwright's managed download does not support
# musl, and Remotion fetches its own Chrome Headless Shell at render time —
# which needs network from inside a running container. So the image installs
# the distribution's Chromium once and points both at it, the same way
# FFMPEG_PATH has always worked in media.mjs.
#
# This is not free: Chromium, ffmpeg and the factory's own dependencies add
# several hundred megabytes to what was a slim node image. An operator who
# never records from the deployed app can drop this whole block, and the Studio
# will say so on screen instead of failing.
# ---------------------------------------------------------------------------
RUN apk add --no-cache chromium ffmpeg font-noto ttf-freefont

ENV DEMO_FACTORY_ROOT=/workspace/src/demo-factory     PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1     PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser     REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium-browser

# The factory is a standalone npm project, deliberately outside the yarn
# workspaces, so it brings its own lockfile and its own node_modules.
COPY --chown=node:node ./src/demo-factory/package.json ./src/demo-factory/package-lock.json /workspace/src/demo-factory/
RUN cd /workspace/src/demo-factory && npm ci --omit=dev --no-audit --no-fund
COPY --chown=node:node ./src/demo-factory /workspace/src/demo-factory

USER node
CMD ["./start.sh"]
