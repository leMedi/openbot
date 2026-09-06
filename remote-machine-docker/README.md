# OpenBot remote machine container

This image runs OpenBot with one persistent graphical session per agent. Each
session contains Xvfb, Openbox, LXPanel, loopback-only TigerVNC, Google Chrome,
LXTerminal, and the PCManFM file manager. OpenBot proxies VNC through its own
web interface, so only the HTTP port is published.

The image supports `linux/amd64` only. On every container start it downloads
the latest `main-<commit>` OpenBot Debian prerelease from `leMedi/openbot`,
verifies the published SHA-256 checksum, and activates it without invoking the
systemd-oriented Debian installer. Starting an update from the server settings
restarts the container, which activates the latest release through the same
startup path. This requires the configured `restart: unless-stopped` policy.

## Run with Compose

Set `OPENBOT_PUBLIC_URL` to the exact origin used in the browser. The default
bind address exposes OpenBot only on the Docker host's loopback interface.

```sh
OPENBOT_PUBLIC_URL=http://localhost:3000 docker compose \
  -f remote-machine-docker/compose.yaml up -d
```

For a Tailscale address, set both values explicitly:

```sh
OPENBOT_BIND_ADDRESS=100.64.0.10 \
OPENBOT_PUBLIC_URL=http://100.64.0.10:3000 \
docker compose -f remote-machine-docker/compose.yaml up -d
```

The Compose definition allocates 2 GB to `/dev/shm`, which Chrome uses for
renderer shared memory. It persists the OpenBot database, managed files,
provider credentials, workspaces, and per-agent Chrome profiles in the
`openbot-data` volume.

The container timezone (`TZ`) is read from the saved user profile in the
OpenBot database, so the whole desktop session — including the timezone
Chrome reports to websites — matches the profile. It is applied at container
start and whenever an agent desktop is (re)launched; an already-running
desktop keeps its timezone until it is restarted or the container recreates
it on the next start.

Inside an agent desktop, `box-chrome --prepare` starts Google Chrome Stable
with no browser window, while `box-chrome --new-window` opens a blank window
and `box-chrome <http-or-https-url>` opens that URL in a new window. All forms
reuse the display's persistent profile. Chrome DevTools Protocol listens only
on container loopback at port `9222 + display-number`.
Chrome runs as the unprivileged `openbot` user with its process sandbox disabled
because Docker's default security policy blocks Chrome's nested namespace
sandbox. The container boundary remains the browser's security boundary; do not
run this image with host networking, host PID namespaces, or privileged mode.
`stop-agent-desktop <display-number> <owner-id>` tears down only a matching
managed display session and refuses an owner mismatch.

An optional `GITHUB_TOKEN` environment variable can be passed to increase the
GitHub API rate limit used during startup. It is not required for this public
repository.

## Build locally

```sh
docker build --platform linux/amd64 \
  -t openbot-remote-machine remote-machine-docker
```

Run the locally built image with the same persistent storage and shared-memory
allocation:

```sh
docker run -d \
  --name openbot \
  --restart unless-stopped \
  --shm-size 2g \
  -p 127.0.0.1:3000:3000 \
  -e OPENBOT_PUBLIC_URL=http://localhost:3000 \
  -v openbot-data:/var/lib/openbot \
  openbot-remote-machine
```

Do not publish the VNC ports. They intentionally listen only on container
loopback and are reached through OpenBot's same-origin WebSocket bridge.
