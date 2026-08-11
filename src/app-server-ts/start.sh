#!/bin/sh

# Source Neon connection strings if available (slim standalone deployments)
[ -f /neon-config/.env.neon ] && . /neon-config/.env.neon

if [ "${NODE_ENV}" = "development" ]; then
  npm run build
fi

node dist/migrate.js

if [ "${IMPORT_DATA}" = "true" ]; then
  node dist/utils/seed.js
fi

if [ "${NODE_ENV}" = "development" ]; then
  npm run start:debug
else
  node dist/main.js
fi
