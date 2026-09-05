#!/bin/sh
set -eu

install_root=/opt/openbot
release_root=$install_root/releases
active_release=$install_root/active

clear_stale_desktop_runtime() {
  if [ -n "${XDG_RUNTIME_DIR:-}" ]; then
    runtime_dir=$(readlink -m -- "$XDG_RUNTIME_DIR")
    case "$runtime_dir" in
      /run|/run/*|/tmp|/tmp/*)
        rm -f "$runtime_dir/openbot/agent-desktops"/display-*/*.pid
        rm -f "$runtime_dir/openbot/agent-window-management"/display-*.json
        ;;
      *)
        echo "XDG_RUNTIME_DIR must be under /run or /tmp" >&2
        exit 1
        ;;
    esac
  else
    rm -f /tmp/openbot/agent-desktops/display-*/*.pid
    rm -f "/tmp/openbot-agent-window-management-$(id -u)"/display-*.json
  fi
  rm -f /tmp/.X[0-9]*-lock /tmp/.X11-unix/X[0-9]*

  case "${OPENBOT_DATA_DIR:-/var/lib/openbot}" in
    /*) profile_root=${OPENBOT_DATA_DIR:-/var/lib/openbot}/chrome-profiles ;;
    *) profile_root=$active_release/${OPENBOT_DATA_DIR}/chrome-profiles ;;
  esac
  if [ -d "$profile_root" ]; then
    for profile in "$profile_root"/*; do
      [ -d "$profile" ] || continue
      rm -f "$profile/SingletonCookie" "$profile/SingletonLock" "$profile/SingletonSocket"
    done
  fi
}

github_get() {
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    curl --fail --silent --show-error --location \
      --header "Authorization: Bearer $GITHUB_TOKEN" \
      --header 'Accept: application/vnd.github+json' \
      --header 'User-Agent: openbot-remote-machine' \
      "$@"
  else
    curl --fail --silent --show-error --location \
      --header 'Accept: application/vnd.github+json' \
      --header 'User-Agent: openbot-remote-machine' \
      "$@"
  fi
}

install_latest_openbot() {
  repo=${OPENBOT_GITHUB_REPO:-leMedi/openbot}
  stage=$(mktemp -d "$install_root/.download.XXXXXX")
  trap 'rm -rf "$stage"' EXIT HUP INT TERM

  github_get "https://api.github.com/repos/$repo/releases?per_page=100" >"$stage/releases.json"
  tag=$(jq -r \
    '[.[] | select(.prerelease and (.tag_name | test("^main-[0-9a-f]{12}$")))] | sort_by(.published_at) | last | .tag_name // empty' \
    "$stage/releases.json")
  asset_url=$(jq -r --arg tag "$tag" \
    '.[] | select(.tag_name == $tag) | .assets[] | select(.name == "openbot-debian-x64.tar.gz") | .browser_download_url' \
    "$stage/releases.json")
  checksum_url=$(jq -r --arg tag "$tag" \
    '.[] | select(.tag_name == $tag) | .assets[] | select(.name == "openbot-debian-x64.tar.gz.sha256") | .browser_download_url' \
    "$stage/releases.json")
  if [ -z "$tag" ] || [ -z "$asset_url" ] || [ -z "$checksum_url" ]; then
    echo "No published OpenBot main Debian release was found" >&2
    exit 1
  fi

  expected_short_sha=${tag#main-}
  if [ -f "$active_release/VERSION" ]; then
    installed_version=$(cat "$active_release/VERSION")
    case "$installed_version" in
      "$expected_short_sha"*)
        echo "OpenBot $tag is already installed"
        rm -rf "$stage"
        trap - EXIT HUP INT TERM
        return
        ;;
    esac
  fi

  echo "Downloading OpenBot $tag"
  github_get "$asset_url" >"$stage/openbot-debian-x64.tar.gz"
  github_get "$checksum_url" >"$stage/openbot-debian-x64.tar.gz.sha256"
  (cd "$stage" && sha256sum --check openbot-debian-x64.tar.gz.sha256)
  mkdir "$stage/extracted"
  tar -xzf "$stage/openbot-debian-x64.tar.gz" -C "$stage/extracted"

  extracted=$stage/extracted/openbot
  if [ ! -x "$extracted/run" ] \
    || [ ! -x "$extracted/runtime/bin/node" ] \
    || [ ! -x "$extracted/runtime/bin/start-window" ] \
    || [ ! -x "$extracted/runtime/bin/openbot-desktop-driver" ] \
    || [ ! -f "$extracted/VERSION" ]; then
    echo "The downloaded OpenBot artifact is incomplete" >&2
    exit 1
  fi

  version=$(cat "$extracted/VERSION")
  case "$version" in
    "$expected_short_sha"*) ;;
    *)
      echo "The downloaded OpenBot version does not match $tag" >&2
      exit 1
      ;;
  esac

  release_dir=$release_root/$version
  if [ ! -d "$release_dir" ]; then
    mv "$extracted" "$release_dir"
  fi
  ln -sfn "$release_dir" "$install_root/active.next"
  mv -Tf "$install_root/active.next" "$active_release"

  rm -rf "$stage"
  trap - EXIT HUP INT TERM
  echo "Installed OpenBot $tag"
}

wait_for_server() {
  attempts=0
  while [ "$attempts" -lt 60 ]; do
    if curl --fail --silent --show-error "http://127.0.0.1:${PORT:-3000}/" >/dev/null 2>&1; then
      return 0
    fi
    if ! kill -0 "$server_pid" 2>/dev/null; then
      return 1
    fi
    attempts=$((attempts + 1))
    sleep 1
  done
  return 1
}

restore_agent_desktops() {
  if [ "${OPENBOT_DESKTOP_MODE:-per-agent}" != per-agent ]; then
    return
  fi

  case "$OPENBOT_DATA_DIR" in
    /*) database=$OPENBOT_DATA_DIR/store.db ;;
    *) database=$active_release/$OPENBOT_DATA_DIR/store.db ;;
  esac
  if [ ! -f "$database" ]; then
    return
  fi

  desktop_list=$(mktemp)
  if ! sqlite3 -separator '|' "$database" \
    'SELECT x_display_number, id FROM agents WHERE x_display_number IS NOT NULL ORDER BY x_display_number' \
    >"$desktop_list"; then
    echo "Could not read existing agent desktops from $database" >&2
    rm -f "$desktop_list"
    return
  fi
  while IFS='|' read -r display_number owner_id; do
    if ! /usr/local/bin/start-agent-desktop "$display_number" "$owner_id"; then
      echo "Could not restore desktop :$display_number for $owner_id" >&2
    fi
  done <"$desktop_list"
  rm -f "$desktop_list"
}

stop_server() {
  kill -TERM "$server_pid" 2>/dev/null || true
}

clear_stale_desktop_runtime
install_latest_openbot
cd "$active_release"

"$active_release/run" &
server_pid=$!
trap stop_server HUP INT TERM

if ! wait_for_server; then
  echo "OpenBot did not become ready" >&2
  stop_server
  if wait "$server_pid"; then
    exit 1
  else
    exit $?
  fi
fi

restore_agent_desktops

if wait "$server_pid"; then
  status=0
else
  status=$?
fi
trap - HUP INT TERM
exit "$status"
