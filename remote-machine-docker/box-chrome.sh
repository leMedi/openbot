#!/bin/sh
set -eu

usage() {
  echo 'Usage: box-chrome --prepare | --new-window | <http-or-https-url>' >&2
  exit 1
}

if [ "$#" -ne 1 ]; then
  usage
fi

mode=$1
case "$mode" in
  --prepare|--new-window) ;;
  http://?*|https://?*) ;;
  *) usage ;;
esac

case "${DISPLAY:-}" in
  :*) display_number=${DISPLAY#:} ;;
  *)
    echo 'DISPLAY must identify an agent display such as :2' >&2
    exit 1
    ;;
esac
case "$display_number" in
  ''|0*|*.*|*[!0-9]*)
    echo 'DISPLAY must identify an agent display such as :2' >&2
    exit 1
    ;;
esac
if [ "$display_number" -lt 2 ] || [ "$display_number" -gt 56313 ]; then
  echo 'DISPLAY must be between :2 and :56313' >&2
  exit 1
fi

if [ -n "${XDG_RUNTIME_DIR:-}" ]; then
  runtime_dir=$XDG_RUNTIME_DIR
  case "$runtime_dir" in
    /*) ;;
    *)
      echo 'XDG_RUNTIME_DIR must be an absolute path' >&2
      exit 1
      ;;
  esac
  window_state_root=$runtime_dir/openbot/agent-window-management
else
  runtime_dir=/tmp
  window_state_root=/tmp/openbot-agent-window-management-$(id -u)
fi
session_dir=$runtime_dir/openbot/agent-desktops/display-$display_number
metadata=$session_dir/session.json
window_state=$window_state_root/display-$display_number.json

if [ ! -d "$runtime_dir/openbot/agent-desktops" ] \
  || [ -L "$runtime_dir/openbot/agent-desktops" ] \
  || [ ! -d "$session_dir" ] || [ -L "$session_dir" ] \
  || [ "$(stat -c %u "$session_dir" 2>/dev/null || true)" != "$(id -u)" ]; then
  echo "Desktop session metadata directory is not trusted for DISPLAY=$DISPLAY" >&2
  exit 1
fi
umask 077
exec 8>"$session_dir/chrome.lock"
if ! flock -w 30 8; then
  echo "Timed out waiting for Chrome on DISPLAY=$DISPLAY" >&2
  exit 1
fi
if [ ! -f "$metadata" ] || [ -L "$metadata" ] \
  || [ "$(stat -c %u "$metadata" 2>/dev/null || true)" != "$(id -u)" ] \
  || [ "$(stat -c %a "$metadata" 2>/dev/null || true)" != 600 ]; then
  echo "Desktop session metadata is unavailable for DISPLAY=$DISPLAY" >&2
  exit 1
fi
if [ ! -f "$window_state" ] || [ -L "$window_state" ] \
  || [ "$(stat -c %u "$window_state" 2>/dev/null || true)" != "$(id -u)" ]; then
  echo "Desktop ownership state is unavailable for DISPLAY=$DISPLAY" >&2
  exit 1
fi

owner_id=$(jq -r '.ownerId // empty' "$metadata" 2>/dev/null || true)
profile_dir=$(jq -r '.profileDir // empty' "$metadata" 2>/dev/null || true)
metadata_display=$(jq -r '.displayNumber // empty' "$metadata" 2>/dev/null || true)
state_owner=$(jq -r '.ownerId // empty' "$window_state" 2>/dev/null || true)
state_display=$(jq -r '.displayNumber // empty' "$window_state" 2>/dev/null || true)
state_status=$(jq -r '.status // empty' "$window_state" 2>/dev/null || true)
case "$owner_id" in
  ''|*[!A-Za-z0-9._:-]*) owner_id= ;;
esac
case "$owner_id" in
  [A-Za-z0-9]*) ;;
  *) owner_id= ;;
esac
if [ "${#owner_id}" -gt 200 ]; then
  owner_id=
fi
data_dir=$(readlink -m -- "${OPENBOT_DATA_DIR:-/var/lib/openbot}")
expected_profile=$data_dir/chrome-profiles/$owner_id
if [ -z "$owner_id" ] \
  || [ "$(jq -r '.version // empty' "$metadata" 2>/dev/null || true)" != 1 ] \
  || [ "$metadata_display" != "$display_number" ] \
  || [ "$state_display" != "$display_number" ] \
  || [ "$state_owner" != "$owner_id" ] \
  || [ "$state_status" != running ] \
  || [ "$profile_dir" != "$expected_profile" ] \
  || [ ! -d "$profile_dir" ] \
  || [ -L "$profile_dir" ] \
  || [ "$(stat -c %u "$profile_dir" 2>/dev/null || true)" != "$(id -u)" ]; then
  echo "Desktop session metadata does not match DISPLAY=$DISPLAY" >&2
  exit 1
fi

cdp_port=$((9222 + display_number))
pid_file=$session_dir/chrome.pid
log_file=$session_dir/chrome.log

process_has_argument() {
  process_id=$1
  argument=$2
  tr '\0' '\n' 2>/dev/null <"/proc/$process_id/cmdline" | grep -Fxq -- "$argument"
}

managed_chrome_is_running() {
  process_id=$1
  case "$process_id" in
    ''|*[!0-9]*) return 1 ;;
  esac
  kill -0 "$process_id" 2>/dev/null || return 1
  executable=$(basename "$(readlink -f "/proc/$process_id/exe" 2>/dev/null || true)")
  case "$executable" in
    chrome|google-chrome|google-chrome-stable) ;;
    *) return 1 ;;
  esac
  process_has_argument "$process_id" "--user-data-dir=$profile_dir" \
    && process_has_argument "$process_id" "--remote-debugging-port=$cdp_port" \
    && tr '\0' '\n' 2>/dev/null <"/proc/$process_id/environ" | grep -Fxq "DISPLAY=$DISPLAY"
}

cdp_is_ready() {
  curl --fail --silent --show-error --max-time 1 \
    "http://127.0.0.1:$cdp_port/json/version" 2>/dev/null \
    | jq -e '.Browser | strings | startswith("Chrome/")' >/dev/null 2>&1
}

visible_window_count() {
  xdotool search --onlyvisible --class Google-chrome 2>/dev/null \
    | wc -l \
    | tr -d ' '
}

page_target_ids() {
  curl --fail --silent --show-error --max-time 1 \
    "http://127.0.0.1:$cdp_port/json/list" 2>/dev/null \
    | jq -r '.[] | select(.type == "page") | .id' 2>/dev/null
}

run_chrome() {
  google-chrome-stable \
    --no-first-run \
    --no-default-browser-check \
    --password-store=basic \
    --disable-session-crashed-bubble \
    --lang=en-US \
    --force-device-scale-factor=1 \
    --ozone-platform=x11 \
    --start-maximized \
    --window-position=0,0 \
    --window-size=1280,800 \
    --remote-debugging-address=127.0.0.1 \
    --remote-debugging-port="$cdp_port" \
    --user-data-dir="$profile_dir" \
    "$@"
}

stop_failed_chrome() {
  process_id=$1
  if managed_chrome_is_running "$process_id"; then
    kill -TERM "$process_id" 2>/dev/null || true
    attempts=0
    while [ "$attempts" -lt 50 ] && managed_chrome_is_running "$process_id"; do
      attempts=$((attempts + 1))
      sleep 0.1
    done
    if managed_chrome_is_running "$process_id"; then
      kill -KILL "$process_id" 2>/dev/null || true
    fi
  fi
  rm -f "$pid_file"
}

ensure_chrome_ready() {
  process_id=
  if [ -f "$pid_file" ]; then
    process_id=$(cat "$pid_file" 2>/dev/null || true)
  fi
  if managed_chrome_is_running "$process_id"; then
    attempts=0
    while [ "$attempts" -lt 50 ]; do
      if cdp_is_ready; then
        return
      fi
      attempts=$((attempts + 1))
      sleep 0.1
    done
    stop_failed_chrome "$process_id"
    rm -f "$profile_dir/SingletonCookie" "$profile_dir/SingletonLock" \
      "$profile_dir/SingletonSocket"
  else
    rm -f "$pid_file"
  fi

  if cdp_is_ready || nc -z 127.0.0.1 "$cdp_port" >/dev/null 2>&1; then
    echo "CDP port $cdp_port is not owned by DISPLAY=$DISPLAY" >&2
    exit 1
  fi

  run_chrome --no-startup-window 8>&- </dev/null >>"$log_file" 2>&1 &
  process_id=$!
  printf '%s\n' "$process_id" >"$pid_file"
  attempts=0
  while [ "$attempts" -lt 200 ]; do
    if managed_chrome_is_running "$process_id" && cdp_is_ready; then
      return
    fi
    if ! kill -0 "$process_id" 2>/dev/null; then
      break
    fi
    attempts=$((attempts + 1))
    sleep 0.1
  done
  stop_failed_chrome "$process_id"
  echo "Google Chrome did not become ready on DISPLAY=$DISPLAY" >&2
  exit 1
}

ensure_chrome_ready
if [ "$mode" = --prepare ]; then
  exit 0
fi

if [ "$mode" = --new-window ]; then
  target=about:blank
else
  target=$mode
fi
targets_before=" $(page_target_ids | tr '\n' ' ') "
run_chrome --new-window "$target" 8>&- </dev/null >>"$log_file" 2>&1 &
opener_pid=$!
attempts=0
while [ "$attempts" -lt 200 ]; do
  if cdp_is_ready && [ "$(visible_window_count)" -gt 0 ]; then
    for target_id in $(page_target_ids); do
      case "$targets_before" in
        *" $target_id "*) ;;
        *) exit 0 ;;
      esac
    done
  fi
  attempts=$((attempts + 1))
  sleep 0.1
done
if kill -0 "$opener_pid" 2>/dev/null; then
  kill -TERM "$opener_pid" 2>/dev/null || true
fi
echo "Google Chrome did not open a visible window on DISPLAY=$DISPLAY" >&2
exit 1
