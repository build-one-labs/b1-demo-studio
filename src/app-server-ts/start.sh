#!/bin/sh

# Source Neon connection strings if available (slim standalone deployments)
[ -f /neon-config/.env.neon ] && . /neon-config/.env.neon

if [ "${NODE_ENV}" = "development" ]; then
  npm run build:dev
fi

# A failed migration stops the start (B1-1521). Each database's pending
# migrations run in one transaction, so the failed batch is rolled back and the
# previous image still starts. Starting this one anyway would run new code on
# the old schema. The FATAL line is what `b1 status` and `b1 wait-for-stack`
# look for, so keep its wording.
if ! node dist/migrate.js; then
  echo "FATAL: database migrations failed, so the app server is not starting. The error is above." >&2
  exit 1
fi

if [ "${IMPORT_DATA}" = "true" ]; then
  node ../../node_modules/@buildone/app-server-tslib/dist/framework/utils/seed.js
  node dist/utils/seed.js
fi

if [ "${NODE_ENV}" = "development" ]; then
  npm run start:debug
else
  node dist/main.js
fi
