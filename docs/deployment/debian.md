# Debian installation

Each push to `main` builds an `openbot-debian-x64` package and publishes it
as an immutable GitHub prerelease tagged `main-<commit>`. It contains the
application, its production dependencies, database migrations, a pinned Node
runtime, and an installer. The package supports x86-64 Debian machines.

## Install or update

Install the GitHub CLI and authenticate it, then run the following as the
Debian login user that should run OpenBot. Do not run the installer itself with
`sudo`; it uses `sudo` only for system-wide changes.

```sh
sudo apt-get update && sudo apt-get install -y curl gh
gh auth login

REPO=leMedi/openbot
TAG=$(gh release list --repo "$REPO" --limit 100 \
  --json tagName,publishedAt \
  --jq 'map(select(.tagName | test("^main-[0-9a-f]{12}$"))) | sort_by(.publishedAt) | last | .tagName')
test -n "$TAG" || { echo "No published main Debian release" >&2; exit 1; }
echo "Installing $TAG"
rm -rf "$HOME/openbot-install"
mkdir -p "$HOME/openbot-install"
gh release download "$TAG" --repo "$REPO" \
  --pattern 'openbot-debian-x64.tar.gz*' --dir "$HOME/openbot-install"
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

The artifact configures its bundled `start-window` command for agent display
provisioning. Install Xvfb on the host before creating agents:

```sh
sudo apt-get install -y xvfb
```

OpenBot listens on `127.0.0.1:3000` by default. Keep it private or place an
authenticated TLS reverse proxy in front of it. The architecture calls for an
authenticated server API, but the current MVP implementation does not yet
enforce authentication.

Running the same commands for a newer successful workflow run performs an
update. The installer stops the service, backs up `/var/lib/openbot`, switches
to the new release, and starts it. Startup applies committed database
migrations. If the health check fails, the installer restores both the prior
release and its pre-update data. Backups are stored in `/var/backups/openbot`.
