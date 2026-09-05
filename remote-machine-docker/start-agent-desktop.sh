#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  echo 'Usage: start-agent-desktop <display-number> <owner-id>' >&2
  exit 1
fi

display_number=$1
owner_id=$2
case "$display_number" in
  ''|*[!0-9]*)
    echo 'display-number must be an integer' >&2
    exit 1
    ;;
esac
if [ "$display_number" -lt 2 ] || [ "$display_number" -gt 59635 ]; then
  echo 'display-number must be between 2 and 59635' >&2
  exit 1
fi
case "$owner_id" in
  ''|*[!A-Za-z0-9._:-]*)
    echo 'owner-id contains unsupported characters' >&2
    exit 1
    ;;
esac

display=:$display_number
rfb_port=$((5900 + display_number))
session_root=${XDG_RUNTIME_DIR:-/tmp}/openbot/agent-desktops
session_dir=$session_root/display-$display_number
profile_dir=${OPENBOT_DATA_DIR:-/var/lib/openbot}/chrome-profiles/$owner_id
window_state_root=${XDG_RUNTIME_DIR:-/tmp}/openbot/agent-window-management
window_state=$window_state_root/display-$display_number.json
mkdir -p "$session_dir" "$profile_dir"
chmod 0700 "$session_root" "$session_dir" "$profile_dir"

exec 9>"$session_dir/setup.lock"
if ! flock -w 30 9; then
  echo "Timed out waiting to configure desktop $display" >&2
  exit 1
fi

export DISPLAY=$display
started_openbox=0
started_vnc=0
started_chrome=0
xvfb_was_running=0

if [ -f "$window_state" ]; then
  existing_owner=$(jq -r '.ownerId // empty' "$window_state" 2>/dev/null || true)
  existing_pid=$(jq -r '.pid // empty' "$window_state" 2>/dev/null || true)
  if [ "$existing_owner" = "$owner_id" ] \
    && [ -n "$existing_pid" ] \
    && kill -0 "$existing_pid" 2>/dev/null \
    && [ "$(basename "$(readlink -f "/proc/$existing_pid/exe" 2>/dev/null || true)")" = Xvfb ] \
    && tr '\0' '\n' <"/proc/$existing_pid/cmdline" | grep -Fxq "$display"; then
    xvfb_was_running=1
  fi
fi

bundled_start_window=/opt/openbot/active/runtime/bin/start-window
if [ ! -x "$bundled_start_window" ]; then
  echo "OpenBot start-window executable is unavailable: $bundled_start_window" >&2
  exit 1
fi

"$bundled_start_window" "$display_number" "$owner_id"

stop_recorded_process() {
  name=$1
  pid_file=$session_dir/$name.pid
  if [ ! -f "$pid_file" ]; then
    return
  fi
  pid=$(cat "$pid_file")
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
  fi
  rm -f "$pid_file"
}

start_process() {
  name=$1
  shift
  pid_file=$session_dir/$name.pid
  log_file=$session_dir/$name.log
  "$@" 9>&- </dev/null >>"$log_file" 2>&1 &
  pid=$!
  printf '%s\n' "$pid" >"$pid_file"
}

cleanup_failed_start() {
  status=$?
  trap - EXIT
  if [ "$status" -ne 0 ]; then
    if [ "$started_chrome" -eq 1 ]; then stop_recorded_process chrome; fi
    if [ "$started_vnc" -eq 1 ]; then stop_recorded_process vnc; fi
    if [ "$started_openbox" -eq 1 ]; then stop_recorded_process openbox; fi
    if [ "$xvfb_was_running" -eq 0 ] && [ -f "$window_state" ]; then
      xvfb_pid=$(jq -r '.pid // empty' "$window_state" 2>/dev/null || true)
      if [ -n "$xvfb_pid" ] && kill -0 "$xvfb_pid" 2>/dev/null; then
        kill -TERM -- "-$xvfb_pid" 2>/dev/null || true
        attempts=0
        while [ "$attempts" -lt 20 ] \
          && { [ -e "/tmp/.X$display_number-lock" ] || [ -S "/tmp/.X11-unix/X$display_number" ]; }; do
          attempts=$((attempts + 1))
          sleep 0.05
        done
        if [ -e "/tmp/.X$display_number-lock" ] || [ -S "/tmp/.X11-unix/X$display_number" ]; then
          kill -KILL -- "-$xvfb_pid" 2>/dev/null || true
        fi
      fi
      rm -f "$window_state"
    fi
  fi
  exit "$status"
}
trap cleanup_failed_start EXIT

if ! xprop -root _NET_SUPPORTING_WM_CHECK 2>/dev/null | grep -q 'window id'; then
  stop_recorded_process openbox
  start_process openbox openbox --sm-disable
  started_openbox=1
  attempts=0
  while [ "$attempts" -lt 100 ]; do
    if xprop -root _NET_SUPPORTING_WM_CHECK 2>/dev/null | grep -q 'window id'; then
      break
    fi
    attempts=$((attempts + 1))
    sleep 0.1
  done
  if [ "$attempts" -eq 100 ]; then
    echo "Openbox did not become ready on $display" >&2
    exit 1
  fi
fi
xsetroot -solid '#202124'

if ! nc -z 127.0.0.1 "$rfb_port" >/dev/null 2>&1; then
  stop_recorded_process vnc
  start_process vnc X0tigervnc \
    -display "$display" \
    -rfbport "$rfb_port" \
    -interface 127.0.0.1 \
    -SecurityTypes None \
    -AlwaysShared
  started_vnc=1
  attempts=0
  while [ "$attempts" -lt 100 ]; do
    if nc -z 127.0.0.1 "$rfb_port" >/dev/null 2>&1; then
      break
    fi
    attempts=$((attempts + 1))
    sleep 0.1
  done
  if [ "$attempts" -eq 100 ]; then
    echo "TigerVNC did not become ready on port $rfb_port" >&2
    exit 1
  fi
fi

if ! xdotool search --onlyvisible --class Google-chrome >/dev/null 2>&1; then
  stop_recorded_process chrome
  start_process chrome google-chrome-stable \
    --no-first-run \
    --no-default-browser-check \
    --password-store=basic \
    --disable-session-crashed-bubble \
    --force-device-scale-factor=1 \
    --ozone-platform=x11 \
    --start-maximized \
    --window-position=0,0 \
    --window-size=1280,800 \
    --user-data-dir="$profile_dir" \
    about:blank
  started_chrome=1
  attempts=0
  while [ "$attempts" -lt 200 ]; do
    if xdotool search --onlyvisible --class Google-chrome >/dev/null 2>&1; then
      break
    fi
    attempts=$((attempts + 1))
    sleep 0.1
  done
  if [ "$attempts" -eq 200 ]; then
    echo "Google Chrome did not become visible on $display" >&2
    exit 1
  fi
fi
