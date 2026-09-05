# Debian installation

Each push to `main` builds an `openbot-debian-x64` package and publishes it
as an immutable GitHub prerelease tagged `main-<commit>`. It contains the
application, its production dependencies, database migrations, a pinned Node
runtime, the `start-window` and desktop-driver executables, and an installer.
The package supports x86-64 Debian machines.

## Install or update

The repository is public, so no GitHub account or authentication is required.
Run the following as the Debian login user that should run OpenBot. Do not run
the installer itself with `sudo`; it uses `sudo` only for system-wide changes.

```sh
sudo apt-get update && sudo apt-get install -y curl jq

REPO=leMedi/openbot
release_json=$(curl --fail --silent --show-error --location \
  "https://api.github.com/repos/$REPO/releases?per_page=100")
TAG=$(printf '%s' "$release_json" | jq -r \
  '[.[] | select(.prerelease and (.tag_name | test("^main-[0-9a-f]{12}$")))] |
   sort_by(.published_at) | last | .tag_name // empty')
asset_url=$(printf '%s' "$release_json" | jq -r --arg tag "$TAG" \
  '.[] | select(.tag_name == $tag) | .assets[] |
   select(.name == "openbot-debian-x64.tar.gz") | .browser_download_url')
checksum_url=$(printf '%s' "$release_json" | jq -r --arg tag "$TAG" \
  '.[] | select(.tag_name == $tag) | .assets[] |
   select(.name == "openbot-debian-x64.tar.gz.sha256") | .browser_download_url')
test -n "$TAG" && test -n "$asset_url" && test -n "$checksum_url" || {
  echo "No published main Debian release found" >&2
  exit 1
}
echo "Installing $TAG"
rm -rf "$HOME/openbot-install"
mkdir -p "$HOME/openbot-install"
curl --fail --silent --show-error --location "$asset_url" \
  --output "$HOME/openbot-install/openbot-debian-x64.tar.gz"
curl --fail --silent --show-error --location "$checksum_url" \
  --output "$HOME/openbot-install/openbot-debian-x64.tar.gz.sha256"
cd "$HOME/openbot-install"
sha256sum --check openbot-debian-x64.tar.gz.sha256
tar -xzf openbot-debian-x64.tar.gz
./openbot/install-debian.sh
```

The service runs as the user who invokes `install-debian.sh`. On first install,
edit `/etc/openbot/openbot.env` with the AI provider settings and restart:

```sh
sudoedit /etc/openbot/openbot.env
sudo systemctl restart openbot
sudo systemctl status openbot
```

The installer installs the required X11 packages and configures the bundled
`start-window` and `openbot-desktop-driver` commands for agent display
provisioning and control. Their stable configured paths are:

```dotenv
OPENBOT_START_WINDOW=/opt/openbot/current/runtime/bin/start-window
OPENBOT_DESKTOP_DRIVER=/opt/openbot/current/runtime/bin/openbot-desktop-driver
```

Both commands run with the Node runtime packaged in the release; a system-wide
Node installation is not required. On updates, the installer preserves custom
non-empty command settings and fills missing or empty settings with these
bundled defaults.

OpenBot listens on `127.0.0.1:3000` by default. Keep it private or place an
authenticated TLS reverse proxy in front of it. The architecture calls for an
authenticated server API, but the current MVP implementation does not yet
enforce authentication.

Running the same commands for a newer successful workflow run performs an
update. The installer stops the service, backs up `/var/lib/openbot`, switches
to the new release, and starts it. Startup applies committed database
migrations. If the health check fails, the installer restores both the prior
release and its pre-update data. Backups are stored in `/var/backups/openbot`.
