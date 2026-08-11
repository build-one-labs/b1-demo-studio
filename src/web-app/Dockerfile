FROM node:24-alpine

ARG BUILD_VERSION
ARG BUILD_DATE
ARG BUILD_NAME
ARG VERSION
ARG BUILD_IMAGE

LABEL maintainer="Build.One"
LABEL version=${BUILD_VERSION}
LABEL date=${BUILD_DATE}
LABEL name=${BUILD_NAME}
LABEL image=${BUILD_IMAGE}

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

WORKDIR /workspace/src/web-app

COPY --chown=node:node ./src/web-app/.output ./dist

USER node
CMD ["node", "dist/server/index.mjs"]
