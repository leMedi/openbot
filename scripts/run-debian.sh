#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

export NODE_ENV=production
export PATH="$root/runtime/bin:$PATH"

exec "$root/runtime/bin/node" \
  "$root/node_modules/srvx/bin/srvx.mjs" serve \
  --entry "$root/dist/server/server.js" \
  --static "$root/dist/client" \
  --prod
