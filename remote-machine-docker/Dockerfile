# syntax=docker/dockerfile:1

FROM debian:13.6-slim@sha256:abc9cb88a5587630d7f915f47b23b0668fe250fbfc6457aa4d52b534c1bbf73f

ARG TARGETARCH
ARG CHROME_VERSION=151.0.7922.169-1
ARG FNM_VERSION=1.39.0
ARG FNM_SHA256=7807664f39d39fc518da1c35ba0181e4b3267603c4b1dedeb4b5fc6ae440a224
ARG BUN_VERSION=1.4.2
ARG BUN_SHA256=c678040f14fe0440eb839d37cbd0ce4c051a32da72806ac97de6a6aab6bf728f
ARG UV_VERSION=0.12.10
ARG UV_SHA256=173d95a0c32d18c896c46ba6fafbf3cf9c14ab74b033f81b76c883ef492a976b
ARG NODE_VERSION=24.20.0
ARG PYTHON_VERSION=3.13.5-1
ARG FFMPEG_VERSION=7:7.1.5-0+deb13u1

RUN case "${TARGETARCH:-amd64}" in amd64) ;; *) echo "Only linux/amd64 is supported" >&2; exit 1 ;; esac \
    && . /etc/os-release \
    && test "$VERSION_ID" = 13.6 \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        bash \
        build-essential \
        ca-certificates \
        curl \
        dbus-x11 \
        ffmpeg=${FFMPEG_VERSION} \
        fonts-liberation \
        fonts-noto-color-emoji \
        git \
        gnupg \
        imagemagick \
        jq \
        lxpanel \
        lxterminal \
        netcat-openbsd \
        openbox \
        pcmanfm \
        pkg-config \
        python-is-python3 \
        python3=${PYTHON_VERSION} \
        python3-pip \
        python3-venv \
        sudo \
        sqlite3 \
        tigervnc-scraping-server \
        tini \
        tzdata \
        util-linux \
        unzip \
        x11-utils \
        x11-xserver-utils \
        xdotool \
        xvfb \
    && install -d -m 0755 /etc/apt/keyrings \
    && curl --fail --silent --show-error --location \
        https://dl.google.com/linux/linux_signing_key.pub \
        | gpg --batch --dearmor --output /etc/apt/keyrings/google-chrome.gpg \
    && printf '%s\n' \
        'deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main' \
        > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        google-chrome-stable=${CHROME_VERSION} \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/*

RUN useradd --uid 1000 --create-home --shell /bin/bash openbot \
    && printf '%s\n' 'openbot ALL=(ALL:ALL) NOPASSWD:ALL' > /etc/sudoers.d/openbot \
    && chmod 0440 /etc/sudoers.d/openbot \
    && visudo -cf /etc/sudoers \
    && install -d -o openbot -g openbot -m 0755 /opt/openbot /opt/openbot/releases \
    && install -d -o openbot -g openbot -m 0700 /run/openbot /var/lib/openbot

RUN set -eux; \
    curl --fail --silent --show-error --location \
        "https://github.com/Schniz/fnm/releases/download/v${FNM_VERSION}/fnm-linux.zip" \
        --output /tmp/fnm.zip; \
    printf '%s  %s\n' "$FNM_SHA256" /tmp/fnm.zip | sha256sum --check; \
    unzip -p /tmp/fnm.zip fnm > /usr/local/bin/fnm; \
    chmod 0755 /usr/local/bin/fnm; \
    curl --fail --silent --show-error --location \
        "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-x64-baseline.zip" \
        --output /tmp/bun.zip; \
    printf '%s  %s\n' "$BUN_SHA256" /tmp/bun.zip | sha256sum --check; \
    unzip -p /tmp/bun.zip '*/bun' > /usr/local/bin/bun; \
    chmod 0755 /usr/local/bin/bun; \
    curl --fail --silent --show-error --location \
        "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-unknown-linux-gnu.tar.gz" \
        --output /tmp/uv.tar.gz; \
    printf '%s  %s\n' "$UV_SHA256" /tmp/uv.tar.gz | sha256sum --check; \
    install -d /tmp/uv; \
    tar -xzf /tmp/uv.tar.gz --strip-components=1 -C /tmp/uv; \
    install -m 0755 /tmp/uv/uv /usr/local/bin/uv; \
    rm -rf /tmp/fnm.zip /tmp/bun.zip /tmp/uv.tar.gz /tmp/uv

COPY --chmod=0755 entrypoint.sh /usr/local/bin/openbot-entrypoint
COPY --chmod=0755 box-chrome.sh /usr/local/bin/box-chrome
COPY --chmod=0755 launch-chrome.sh /usr/local/bin/openbot-launch-chrome
COPY --chmod=0755 request-update.sh /usr/local/bin/openbot-request-update
COPY --chmod=0755 start-agent-desktop.sh /usr/local/bin/start-agent-desktop
COPY --chmod=0755 stop-agent-desktop.sh /usr/local/bin/stop-agent-desktop
COPY applications/ /usr/share/applications/
COPY lxpanel/panel /etc/xdg/lxpanel/openbot/panels/panel

ENV HOME=/home/openbot \
    FNM_DIR=/home/openbot/.local/share/fnm \
    LANG=C.UTF-8 \
    NPM_CONFIG_PREFIX=/home/openbot/.local \
    NODE_ENV=production \
    OPENBOT_COMPUTER_TIMEOUT_MS=120000 \
    OPENBOT_DATA_DIR=/var/lib/openbot \
    OPENBOT_DESKTOP_DRIVER=/opt/openbot/active/runtime/bin/openbot-desktop-driver \
    OPENBOT_DESKTOP_DRIVER_ARGS=[] \
    OPENBOT_DESKTOP_MODE=per-agent \
    OPENBOT_GITHUB_REPO=leMedi/openbot \
    OPENBOT_PUBLIC_URL=http://localhost:3000 \
    OPENBOT_START_WINDOW=/usr/local/bin/start-agent-desktop \
    OPENBOT_STOP_WINDOW=/usr/local/bin/stop-agent-desktop \
    OPENBOT_UPDATE_COMMAND=/usr/local/bin/openbot-request-update \
    HOST=0.0.0.0 \
    PORT=3000 \
    PATH=/home/openbot/.local/bin:/opt/openbot/active/runtime/bin:/usr/local/bin:/usr/bin:/bin \
    XDG_RUNTIME_DIR=/run/openbot

USER openbot
WORKDIR /opt/openbot

RUN bash -lc 'set -euxo pipefail; \
    eval "$(fnm env --shell bash)"; \
    fnm install "${NODE_VERSION}" --progress never; \
    fnm default "${NODE_VERSION}"; \
    node_path="$(fnm exec --using "${NODE_VERSION}" node -p "process.execPath")"; \
    node_dir="$(dirname "$node_path")"; \
    install -d -m 0755 "$HOME/.local/bin"; \
    for executable in node npm npx corepack; do \
      ln -sfn "$node_dir/$executable" "$HOME/.local/bin/$executable"; \
    done; \
    printf "%s\\n" '\''eval "$(fnm env --use-on-cd --shell bash)"'\'' >> "$HOME/.bashrc"; \
    node --version; npm --version'

VOLUME ["/var/lib/openbot"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl --fail --silent --show-error "http://127.0.0.1:${PORT:-3000}/" >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/local/bin/openbot-entrypoint"]
