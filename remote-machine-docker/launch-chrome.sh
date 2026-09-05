#!/bin/sh
set -eu

if [ -z "${OPENBOT_CHROME_PROFILE_DIR:-}" ]; then
  echo 'OPENBOT_CHROME_PROFILE_DIR is not configured' >&2
  exit 1
fi

exec google-chrome-stable \
  --no-first-run \
  --no-default-browser-check \
  --password-store=basic \
  --disable-session-crashed-bubble \
  --force-device-scale-factor=1 \
  --ozone-platform=x11 \
  --user-data-dir="$OPENBOT_CHROME_PROFILE_DIR" \
  --new-window \
  about:blank
