#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  echo 'Usage: start-agent-desktop <display-number> <owner-id>' >&2
  exit 1
fi

display_number=$1
owner_id=$2
case "$display_number" in
  ''|0*|*[!0-9]*)
    echo 'display-number must be an integer' >&2
    exit 1
    ;;
esac
if [ "$display_number" -lt 2 ] || [ "$display_number" -gt 56313 ]; then
  echo 'display-number must be between 2 and 56313' >&2
  exit 1
fi
case "$owner_id" in
  ''|*[!A-Za-z0-9._:-]*)
    echo 'owner-id contains unsupported characters' >&2
    exit 1
    ;;
esac
case "$owner_id" in
  [A-Za-z0-9]*) ;;
  *)
    echo 'owner-id must start with a letter or number' >&2
    exit 1
    ;;
esac
if [ "${#owner_id}" -gt 200 ]; then
  echo 'owner-id must not exceed 200 characters' >&2
  exit 1
fi

display=:$display_number
rfb_port=$((5900 + display_number))
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
session_root=$runtime_dir/openbot/agent-desktops
session_dir=$session_root/display-$display_number
panel_profile=openbot-display-$display_number
data_dir=$(readlink -m -- "${OPENBOT_DATA_DIR:-/var/lib/openbot}")
profile_dir=$data_dir/chrome-profiles/$owner_id
window_state=$window_state_root/display-$display_number.json
mkdir -p "$session_dir" "$profile_dir"
if [ -L "$session_root" ] || [ -L "$session_dir" ] || [ -L "$profile_dir" ]; then
  echo 'Desktop runtime and profile paths must not be symbolic links' >&2
  exit 1
fi
chmod 0700 "$session_root" "$session_dir" "$profile_dir"

database=${OPENBOT_DATA_DIR:-/var/lib/openbot}/store.db
if [ -f "$database" ]; then
  timezone=$(sqlite3 -noheader -batch "$database" \
    'SELECT timezone FROM profile WHERE id = 1' 2>/dev/null || true)
  case "$timezone" in
    ''|*..*|.*|/*|*[!A-Za-z0-9_+/-]*) timezone= ;;
  esac
  if [ -n "$timezone" ] && [ -f "/usr/share/zoneinfo/$timezone" ]; then
    export TZ=$timezone
  fi
fi

exec 9>"$session_dir/setup.lock"
if ! flock -w 30 9; then
  echo "Timed out waiting to configure desktop $display" >&2
  exit 1
fi

export DISPLAY=$display
started_openbox=0
started_panel=0
started_vnc=0
xvfb_was_running=0
metadata=$session_dir/session.json
metadata_backup=$session_dir/session.json.rollback.$$
metadata_was_present=0

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

process_has_argument() {
  process_id=$1
  argument=$2
  tr '\0' '\n' 2>/dev/null <"/proc/$process_id/cmdline" | grep -Fxq -- "$argument"
}

recorded_process_matches() {
  name=$1
  process_id=$2
  case "$process_id" in
    ''|0|*[!0-9]*) return 1 ;;
  esac
  kill -0 "$process_id" 2>/dev/null || return 1
  executable=$(basename "$(readlink -f "/proc/$process_id/exe" 2>/dev/null || true)")
  case "$name:$executable" in
    vnc:X0tigervnc)
      process_has_argument "$process_id" "$display"
      ;;
    panel:lxpanel)
      process_has_argument "$process_id" "$panel_profile" \
        && tr '\0' '\n' 2>/dev/null <"/proc/$process_id/environ" | grep -Fxq "DISPLAY=$display"
      ;;
    openbox:openbox)
      tr '\0' '\n' 2>/dev/null <"/proc/$process_id/environ" | grep -Fxq "DISPLAY=$display"
      ;;
    xvfb:Xvfb)
      process_has_argument "$process_id" "$display"
      ;;
    *) return 1 ;;
  esac
}

stop_recorded_process() {
  name=$1
  pid_file=$session_dir/$name.pid
  if [ ! -f "$pid_file" ]; then
    return
  fi
  pid=$(cat "$pid_file")
  stop_matching_process "$name" "$pid"
  rm -f "$pid_file"
}

stop_matching_process() {
  name=$1
  pid=$2
  if ! recorded_process_matches "$name" "$pid"; then
    return
  fi
  kill -TERM "$pid" 2>/dev/null || true
  attempts=0
  while [ "$attempts" -lt 50 ] && recorded_process_matches "$name" "$pid"; do
    attempts=$((attempts + 1))
    sleep 0.1
  done
  if recorded_process_matches "$name" "$pid"; then
    kill -KILL "$pid" 2>/dev/null || true
    attempts=0
    while [ "$attempts" -lt 20 ] && recorded_process_matches "$name" "$pid"; do
      attempts=$((attempts + 1))
      sleep 0.05
    done
  fi
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
    if [ "$started_vnc" -eq 1 ]; then stop_recorded_process vnc; fi
    if [ "$started_panel" -eq 1 ]; then stop_recorded_process panel; fi
    if [ "$started_openbox" -eq 1 ]; then stop_recorded_process openbox; fi
    if [ "$xvfb_was_running" -eq 0 ] && [ -f "$window_state" ]; then
      xvfb_pid=$(jq -r '.pid // empty' "$window_state" 2>/dev/null || true)
      case "$xvfb_pid" in
        ''|0|*[!0-9]*) xvfb_pid= ;;
      esac
      if [ -n "$xvfb_pid" ] && recorded_process_matches xvfb "$xvfb_pid"; then
        stop_matching_process xvfb "$xvfb_pid"
      fi
      rm -f "/tmp/.X$display_number-lock" "/tmp/.X11-unix/X$display_number"
      rm -f "$window_state"
    fi
    if [ "$metadata_was_present" -eq 1 ] && [ -f "$metadata_backup" ]; then
      mv -f "$metadata_backup" "$metadata"
    else
      rm -f "$metadata" "$metadata_backup"
    fi
  else
    rm -f "$metadata_backup"
  fi
  if [ -n "${metadata_temp:-}" ]; then
    rm -f "$metadata_temp"
  fi
  exit "$status"
}
trap cleanup_failed_start EXIT

if [ -f "$metadata" ]; then
  cp -p "$metadata" "$metadata_backup"
  metadata_was_present=1
fi
metadata_temp=$session_dir/session.json.$$.tmp
umask 077
jq -n \
  --argjson displayNumber "$display_number" \
  --arg ownerId "$owner_id" \
  --arg profileDir "$profile_dir" \
  '{version: 1, displayNumber: $displayNumber, ownerId: $ownerId, profileDir: $profileDir}' \
  >"$metadata_temp"
chmod 0600 "$metadata_temp"
mv -f "$metadata_temp" "$metadata"

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

if ! xdotool search --onlyvisible --class Lxpanel >/dev/null 2>&1; then
  stop_recorded_process panel
  panel_config_dir=$HOME/.config/lxpanel/$panel_profile/panels
  mkdir -p "$panel_config_dir"
  cp /etc/xdg/lxpanel/openbot/panels/panel "$panel_config_dir/panel"
  start_process panel lxpanel --profile "$panel_profile"
  started_panel=1
  attempts=0
  while [ "$attempts" -lt 100 ]; do
    if xdotool search --onlyvisible --class Lxpanel >/dev/null 2>&1; then
      break
    fi
    attempts=$((attempts + 1))
    sleep 0.1
  done
  if [ "$attempts" -eq 100 ]; then
    echo "LXPanel did not become ready on $display" >&2
    exit 1
  fi
fi

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

/usr/local/bin/box-chrome --prepare 9>&-
