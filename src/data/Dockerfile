FROM alpine:latest

ARG BUILD_VERSION=unversioned
ARG BUILD_DATE=undated
ARG BUILD_NAME
ARG BUILD_IMAGE

LABEL maintainer="Build.One"
LABEL version=${BUILD_VERSION}
LABEL date=${BUILD_DATE}
LABEL name=${BUILD_NAME}
LABEL image=${BUILD_IMAGE}

WORKDIR /workspace/src/data

COPY ./src/data /workspace/src/data
COPY ./node_modules/@buildone/swat-data /workspace/node_modules/@buildone/swat-data

RUN apk add --no-cache bash

VOLUME [ "/workspace/src/data" ]
