#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  echo 'Usage: stop-agent-desktop <display-number> <owner-id>' >&2
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
case "$owner_id" in
  [A-Za-z0-9]*) ;;
  *)
    echo 'owner-id must start with a letter or number' >&2
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
if [ "${#owner_id}" -gt 200 ]; then
  echo 'owner-id must not exceed 200 characters' >&2
  exit 1
fi

display=:$display_number
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
window_state=$window_state_root/display-$display_number.json
metadata=$session_dir/session.json

mkdir -p "$session_dir"
if [ -L "$session_root" ] || [ -L "$session_dir" ] \
  || [ "$(stat -c %u "$session_dir" 2>/dev/null || true)" != "$(id -u)" ]; then
  echo "Desktop session directory is not trusted for $display" >&2
  exit 1
fi
chmod 0700 "$session_root" "$session_dir"
exec 9>"$session_dir/setup.lock"
if ! flock -w 30 9; then
  echo "Timed out waiting to stop desktop $display" >&2
  exit 1
fi
exec 8>"$session_dir/chrome.lock"
if ! flock -w 30 8; then
  echo "Timed out waiting to stop Chrome on desktop $display" >&2
  exit 1
fi

if [ ! -f "$window_state" ] || [ -L "$window_state" ] \
  || [ "$(stat -c %u "$window_state" 2>/dev/null || true)" != "$(id -u)" ]; then
  artifacts=0
  if [ -e "$metadata" ] || [ -e "/tmp/.X$display_number-lock" ] \
    || [ -e "/tmp/.X11-unix/X$display_number" ]; then
    artifacts=1
  fi
  for pid_file in "$session_dir"/*.pid; do
    [ -e "$pid_file" ] && artifacts=1
  done
  if [ "$artifacts" -eq 0 ]; then
    exit 0
  fi
  echo "Desktop $display has unmanaged artifacts and cannot be stopped safely" >&2
  exit 1
fi
state_version=$(jq -r '.version // empty' "$window_state" 2>/dev/null || true)
state_status=$(jq -r '.status // empty' "$window_state" 2>/dev/null || true)
state_display=$(jq -r '.displayNumber // empty' "$window_state" 2>/dev/null || true)
state_owner=$(jq -r '.ownerId // empty' "$window_state" 2>/dev/null || true)
state_pid=$(jq -r '.pid // empty' "$window_state" 2>/dev/null || true)
if [ "$state_version" != 1 ] \
  || { [ "$state_status" != starting ] && [ "$state_status" != running ]; } \
  || [ "$state_display" != "$display_number" ] \
  || [ "$state_owner" != "$owner_id" ]; then
  echo "Desktop $display is not owned by $owner_id" >&2
  exit 1
fi
case "$state_pid" in
  ''|0|*[!0-9]*)
    echo "Ownership state for desktop $display is invalid" >&2
    exit 1
    ;;
esac

profile_dir=$(readlink -m -- "${OPENBOT_DATA_DIR:-/var/lib/openbot}/chrome-profiles/$owner_id")
if [ -f "$metadata" ] && [ ! -L "$metadata" ]; then
  metadata_version=$(jq -r '.version // empty' "$metadata" 2>/dev/null || true)
  metadata_display=$(jq -r '.displayNumber // empty' "$metadata" 2>/dev/null || true)
  metadata_owner=$(jq -r '.ownerId // empty' "$metadata" 2>/dev/null || true)
  metadata_profile=$(jq -r '.profileDir // empty' "$metadata" 2>/dev/null || true)
  if [ "$(stat -c %u "$metadata" 2>/dev/null || true)" != "$(id -u)" ] \
    || [ "$(stat -c %a "$metadata" 2>/dev/null || true)" != 600 ] \
    || [ "$metadata_version" != 1 ] \
    || [ "$metadata_display" != "$display_number" ] \
    || [ "$metadata_owner" != "$owner_id" ] \
    || [ "$metadata_profile" != "$profile_dir" ]; then
    echo "Desktop session metadata does not match $display" >&2
    exit 1
  fi
fi

process_has_argument() {
  process_id=$1
  argument=$2
  tr '\0' '\n' 2>/dev/null <"/proc/$process_id/cmdline" | grep -Fxq -- "$argument"
}

process_has_display() {
  process_id=$1
  tr '\0' '\n' 2>/dev/null <"/proc/$process_id/environ" | grep -Fxq "DISPLAY=$display"
}

process_matches() {
  kind=$1
  process_id=$2
  case "$process_id" in
    ''|*[!0-9]*) return 1 ;;
  esac
  kill -0 "$process_id" 2>/dev/null || return 1
  [ "$(stat -c %u "/proc/$process_id" 2>/dev/null || true)" = "$(id -u)" ] || return 1
  executable=$(basename "$(readlink -f "/proc/$process_id/exe" 2>/dev/null || true)")
  case "$kind:$executable" in
    chrome:chrome|chrome:google-chrome|chrome:google-chrome-stable)
      process_has_display "$process_id"
      ;;
    vnc:X0tigervnc)
      process_has_argument "$process_id" "$display"
      ;;
    panel:lxpanel)
      process_has_display "$process_id" \
        && process_has_argument "$process_id" "openbot-display-$display_number"
      ;;
    openbox:openbox)
      process_has_display "$process_id"
      ;;
    xvfb:Xvfb)
      process_has_argument "$process_id" "$display"
      ;;
    *) return 1 ;;
  esac
}

matching_pids() {
  kind=$1
  recorded=
  if [ "$kind" = xvfb ]; then
    recorded=$state_pid
  elif [ -f "$session_dir/$kind.pid" ]; then
    recorded=$(cat "$session_dir/$kind.pid" 2>/dev/null || true)
  fi
  if process_matches "$kind" "$recorded"; then
    printf '%s\n' "$recorded"
  fi
  for process_path in /proc/[0-9]*; do
    process_id=${process_path#/proc/}
    [ "$process_id" != "$recorded" ] || continue
    if process_matches "$kind" "$process_id"; then
      printf '%s\n' "$process_id"
    fi
  done
}

stop_processes() {
  kind=$1
  process_ids=$(matching_pids "$kind")
  [ -n "$process_ids" ] || return 0
  for process_id in $process_ids; do
    if process_matches "$kind" "$process_id"; then
      kill -TERM "$process_id" 2>/dev/null || true
    fi
  done
  attempts=0
  while [ "$attempts" -lt 50 ]; do
    running=0
    for process_id in $process_ids; do
      if process_matches "$kind" "$process_id"; then
        running=1
      fi
    done
    [ "$running" -eq 1 ] || return 0
    attempts=$((attempts + 1))
    sleep 0.1
  done
  for process_id in $process_ids; do
    if process_matches "$kind" "$process_id"; then
      kill -KILL "$process_id" 2>/dev/null || true
    fi
  done
}

stop_processes chrome
stop_processes vnc
stop_processes panel
stop_processes openbox
stop_processes xvfb

rm -f "$session_dir"/*.pid "$metadata" "$window_state"
rm -f "/tmp/.X$display_number-lock" "/tmp/.X11-unix/X$display_number"
if [ -d "$profile_dir" ] && [ ! -L "$profile_dir" ]; then
  rm -f "$profile_dir/SingletonCookie" "$profile_dir/SingletonLock" "$profile_dir/SingletonSocket"
fi
