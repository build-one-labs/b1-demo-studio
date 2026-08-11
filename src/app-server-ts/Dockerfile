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

USER node
CMD ["./start.sh"]
