FROM node:24-bookworm-slim

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
# One Chromium, three users. Without an explicit executable, Playwright and
# Remotion each resolve or download their own browser, including at runtime.
# The image installs the distribution's Chromium once and points both at it,
# the same way FFMPEG_PATH has always worked in media.mjs.
#
# This is not free: Chromium and ffmpeg add a few hundred megabytes to what was
# a slim node image. An operator who never records from the deployed app can
# drop this whole block, and the Studio will say so on screen instead of
# failing.
# ---------------------------------------------------------------------------
# The `&&` chain is the point: an image that reaches ECR without a working
# ffmpeg or Chromium is one whose Studio shows "no browser · no ffmpeg" to an
# operator with no way to tell why. Prove both run here, at build time, where
# the failure is a red job instead of a dead button.
#
# Playwright's recordVideo implementation does not use FFMPEG_PATH. It resolves
# the FFmpeg revision from its own browser registry, so install that small
# binary into a cache shared with the runtime node user even though the image
# also has system ffmpeg for rendering.
#
# Remotion's renderer includes a native compositor. Its musl build segfaults
# while extracting frame 0 on Alpine even when the normalized H.264 input is
# valid, so this image deliberately uses Debian/glibc. util-linux supplies the
# `setpriv --pdeathsig` wrapper Remotion uses to tie Chromium to its parent.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium \
    ffmpeg \
    fonts-freefont-ttf \
    fonts-noto-core \
    util-linux \
  && rm -rf /var/lib/apt/lists/* \
  && ffmpeg -version > /dev/null \
  && ffprobe -version > /dev/null \
  && /usr/bin/chromium --version > /dev/null \
  && setpriv --help 2>&1 | grep -q -- '--pdeathsig' \
  && PLAYWRIGHT_BROWSERS_PATH=/ms-playwright npx playwright install ffmpeg \
  && chown -R node:node /ms-playwright

# Absolute paths rather than a bare command name: these are handed to Playwright
# as `executablePath` and to Remotion as its browser, and neither searches PATH.
# They match what demo-factory/tools/provision-workspace.mjs writes for a
# workspace, so the pipeline reads the same variables wherever it runs.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
    REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe

# The pipeline itself: ESM sources the actions spawn, the Remotion composition
# they bundle at render time, and the demo storyboards. Its dependencies are
# this server's own, already in /workspace/node_modules above.
COPY --chown=node:node ./src/app-server-ts/demo-factory ./demo-factory

USER node
CMD ["./start.sh"]
