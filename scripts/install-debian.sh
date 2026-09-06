#!/bin/sh
set -eu

service_name=openbot
install_root=/opt/openbot
data_dir=/var/lib/openbot
config_dir=/etc/openbot
backup_dir=/var/backups/openbot
artifact_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
run_user_file=$config_dir/run-user

if [ "$(id -u)" -eq 0 ]; then
  echo "Run this installer as the login user that should run OpenBot, not as root." >&2
  echo "The installer will use sudo when system-wide access is required." >&2
  exit 1
fi

case "$(uname -s):$(uname -m)" in
  Linux:x86_64) ;;
  *)
    echo "This artifact supports Debian Linux on x86_64 only." >&2
    exit 1
    ;;
esac

for command in sudo curl tar apt-get dpkg-query; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command is missing: $command" >&2
    exit 1
  fi
done

install_desktop_dependencies() {
  missing_packages=
  for package in xvfb imagemagick xdotool x11-xserver-utils; do
    if ! dpkg-query -W -f='${Status}\n' "$package" 2>/dev/null |
      grep -q '^install ok installed$'; then
      missing_packages="$missing_packages $package"
    fi
  done
  if [ -z "$missing_packages" ]; then
    return
  fi

  echo "Installing desktop runtime dependencies:$missing_packages"
  sudo apt-get update
  # Word splitting is intentional: this contains only fixed package names.
  # shellcheck disable=SC2086
  sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y $missing_packages
}

if [ ! -x "$artifact_root/run" ] ||
  [ ! -x "$artifact_root/runtime/bin/node" ] ||
  [ ! -x "$artifact_root/runtime/bin/start-window" ] ||
  [ ! -x "$artifact_root/runtime/bin/stop-window" ] ||
  [ ! -x "$artifact_root/runtime/bin/openbot-desktop-driver" ]; then
  echo "Run this script from the extracted OpenBot artifact directory." >&2
  exit 1
fi

run_user=$(id -un)
run_group=$(id -gn)
version=$(cat "$artifact_root/VERSION")
release_dir="$install_root/releases/$version"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_file="$backup_dir/openbot-$timestamp.tar.gz"
previous_release=

if [ -L "$install_root/current" ]; then
  previous_release=$(readlink -f "$install_root/current")
fi

wait_until_healthy() {
  attempt=0
  while [ "$attempt" -lt 30 ]; do
    if curl --fail --silent --show-error "$health_url" >/dev/null 2>&1; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
  return 1
}

switch_current_release() {
  target=$1
  sudo ln -sfn "$target" "$install_root/current.next" &&
    sudo mv -Tf "$install_root/current.next" "$install_root/current"
}

echo "Installing OpenBot $version as $run_user:$run_group"
install_desktop_dependencies
sudo install -d -m 0755 "$install_root/releases"
sudo install -d -m 0755 "$config_dir"
sudo install -d -m 0700 "$backup_dir"

if [ -f "$run_user_file" ]; then
  installed_user=$(sudo cat "$run_user_file")
  if [ "$installed_user" != "$run_user" ]; then
    echo "OpenBot is installed for $installed_user; run updates as that user." >&2
    exit 1
  fi
else
  run_user_tmp=$(mktemp)
  trap 'rm -f "$run_user_tmp"' EXIT HUP INT TERM
  printf '%s\n' "$run_user" >"$run_user_tmp"
  sudo install -o root -g root -m 0644 "$run_user_tmp" "$run_user_file"
  rm -f "$run_user_tmp"
  trap - EXIT HUP INT TERM
fi

if [ ! -d "$release_dir" ]; then
  release_stage="$install_root/releases/.$version.tmp-$$"
  sudo install -d -m 0755 "$release_stage"
  if ! sudo cp -a "$artifact_root/." "$release_stage/" ||
    ! sudo chown -R root:root "$release_stage" ||
    ! sudo chmod 0755 \
      "$release_stage/run" \
      "$release_stage/install-debian.sh" \
      "$release_stage/runtime/bin/node" \
      "$release_stage/runtime/bin/start-window" \
      "$release_stage/runtime/bin/stop-window" \
      "$release_stage/runtime/bin/openbot-desktop-driver" ||
    ! sudo mv -T "$release_stage" "$release_dir"; then
    sudo rm -rf "$release_stage" || true
    echo "Could not stage release $version; installation aborted." >&2
    exit 1
  fi
fi
if [ ! -x "$release_dir/run" ] ||
  [ ! -x "$release_dir/runtime/bin/node" ] ||
  [ ! -x "$release_dir/runtime/bin/start-window" ] ||
  [ ! -x "$release_dir/runtime/bin/stop-window" ] ||
  [ ! -x "$release_dir/runtime/bin/openbot-desktop-driver" ] ||
  [ ! -f "$release_dir/dist/server/server.js" ] ||
  [ ! -d "$release_dir/packages/db/drizzle" ]; then
  echo "Release directory is incomplete: $release_dir" >&2
  exit 1
fi

sudo install -d -o "$run_user" -g "$run_group" -m 0700 "$data_dir"

if [ ! -f "$config_dir/openbot.env" ]; then
  config_tmp=$(mktemp)
  trap 'rm -f "$config_tmp"' EXIT HUP INT TERM
  cat >"$config_tmp" <<'EOF'
OPENBOT_DATA_DIR=/var/lib/openbot
OPENBOT_PUBLIC_URL=http://localhost:3000
OPENBOT_AI_BASE_URL=
OPENBOT_AI_API_KEY=
OPENBOT_AI_MODEL=
OPENBOT_DESKTOP_DRIVER=/opt/openbot/current/runtime/bin/openbot-desktop-driver
OPENBOT_DESKTOP_DRIVER_ARGS=[]
OPENBOT_COMPUTER_TIMEOUT_MS=120000
OPENBOT_START_WINDOW=/opt/openbot/current/runtime/bin/start-window
OPENBOT_STOP_WINDOW=/opt/openbot/current/runtime/bin/stop-window
HOST=127.0.0.1
PORT=3000
EOF
  sudo install -o root -g "$run_group" -m 0640 "$config_tmp" "$config_dir/openbot.env"
  rm -f "$config_tmp"
  trap - EXIT HUP INT TERM
  echo "Created $config_dir/openbot.env; configure the AI values after installation."
fi
if ! sudo grep -q '^OPENBOT_STOP_WINDOW=' "$config_dir/openbot.env"; then
  printf '%s\n' 'OPENBOT_STOP_WINDOW=/opt/openbot/current/runtime/bin/stop-window' |
    sudo tee -a "$config_dir/openbot.env" >/dev/null
elif sudo grep -q '^OPENBOT_STOP_WINDOW=[[:space:]]*$' "$config_dir/openbot.env"; then
  sudo sed -i \
    's|^OPENBOT_STOP_WINDOW=[[:space:]]*$|OPENBOT_STOP_WINDOW=/opt/openbot/current/runtime/bin/stop-window|' \
    "$config_dir/openbot.env"
fi

if ! sudo grep -q '^OPENBOT_START_WINDOW=' "$config_dir/openbot.env"; then
  printf '%s\n' 'OPENBOT_START_WINDOW=/opt/openbot/current/runtime/bin/start-window' |
    sudo tee -a "$config_dir/openbot.env" >/dev/null
elif sudo grep -q '^OPENBOT_START_WINDOW=[[:space:]]*$' "$config_dir/openbot.env"; then
  sudo sed -i \
    's|^OPENBOT_START_WINDOW=[[:space:]]*$|OPENBOT_START_WINDOW=/opt/openbot/current/runtime/bin/start-window|' \
    "$config_dir/openbot.env"
fi
if ! sudo grep -q '^OPENBOT_DESKTOP_DRIVER=' "$config_dir/openbot.env"; then
  printf '%s\n' 'OPENBOT_DESKTOP_DRIVER=/opt/openbot/current/runtime/bin/openbot-desktop-driver' |
    sudo tee -a "$config_dir/openbot.env" >/dev/null
elif sudo grep -q '^OPENBOT_DESKTOP_DRIVER=[[:space:]]*$' "$config_dir/openbot.env"; then
  sudo sed -i \
    's|^OPENBOT_DESKTOP_DRIVER=[[:space:]]*$|OPENBOT_DESKTOP_DRIVER=/opt/openbot/current/runtime/bin/openbot-desktop-driver|' \
    "$config_dir/openbot.env"
fi

unit_tmp=$(mktemp)
trap 'rm -f "$unit_tmp"' EXIT HUP INT TERM
cat >"$unit_tmp" <<EOF
[Unit]
Description=OpenBot server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$run_user
Group=$run_group
WorkingDirectory=$install_root/current
EnvironmentFile=$config_dir/openbot.env
Environment=PATH=$install_root/current/runtime/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$install_root/current/run
Restart=on-failure
RestartSec=5s
KillMode=control-group
TimeoutStopSec=30s
UMask=0077

[Install]
WantedBy=multi-user.target
EOF
sudo install -m 0644 "$unit_tmp" "/etc/systemd/system/$service_name.service"
rm -f "$unit_tmp"
trap - EXIT HUP INT TERM
sudo systemctl daemon-reload

health_port=$(sudo sed -n 's/^PORT=\([0-9][0-9]*\)$/\1/p' "$config_dir/openbot.env" | tail -n 1)
health_port=${health_port:-3000}
health_url="http://127.0.0.1:$health_port/"

if [ -n "$previous_release" ]; then
  echo "Stopping OpenBot and backing up durable data..."
  if ! sudo systemctl stop "$service_name.service"; then
    echo "Could not stop OpenBot; update aborted." >&2
    exit 1
  fi
  if ! sudo tar -C / -czf "$backup_file" "${data_dir#/}"; then
    echo "Could not create the data backup; update aborted." >&2
    sudo systemctl start "$service_name.service" || true
    exit 1
  fi
  echo "Backup: $backup_file"
fi

if switch_current_release "$release_dir" &&
  sudo systemctl enable --now "$service_name.service" &&
  wait_until_healthy; then
  echo "OpenBot $version is running at http://127.0.0.1:$health_port"
  echo "Configuration: $config_dir/openbot.env"
  exit 0
fi

echo "OpenBot failed its health check." >&2
sudo journalctl -u "$service_name.service" -n 50 --no-pager >&2 || true

if [ -n "$previous_release" ] && [ -f "$backup_file" ]; then
  failed_data="$data_dir.failed-$version-$timestamp"
  restore_root="$backup_dir/.restore-$timestamp"
  echo "Restoring the previous release and pre-update data backup..." >&2
  sudo systemctl stop "$service_name.service" || true

  if ! sudo install -d -m 0700 "$restore_root" ||
    ! sudo tar -C "$restore_root" -xzf "$backup_file" ||
    ! sudo test -d "$restore_root/$data_dir"; then
    echo "Could not unpack the rollback backup; current data was not replaced." >&2
    sudo rm -rf "$restore_root" || true
    exit 1
  fi

  if ! sudo mv "$data_dir" "$failed_data"; then
    echo "Could not preserve the failed data; rollback aborted." >&2
    sudo rm -rf "$restore_root" || true
    exit 1
  fi
  if ! sudo mv "$restore_root/$data_dir" "$data_dir"; then
    echo "Could not move restored data into place; putting failed data back." >&2
    sudo mv "$failed_data" "$data_dir" || true
    sudo rm -rf "$restore_root" || true
    exit 1
  fi
  sudo rm -rf "$restore_root" || true

  if sudo chown -R "$run_user:$run_group" "$data_dir" &&
    switch_current_release "$previous_release" &&
    sudo systemctl start "$service_name.service" &&
    wait_until_healthy; then
    echo "Rollback completed. Failed data retained at $failed_data" >&2
    exit 1
  fi
  echo "Rollback was attempted, but the previous release is not healthy." >&2
  echo "Inspect it with: sudo journalctl -u $service_name -e" >&2
else
  echo "Inspect the service with: sudo journalctl -u $service_name -e" >&2
fi
exit 1
