# syntax=docker/dockerfile:1

FROM debian:trixie-slim

ARG TARGETARCH

RUN case "${TARGETARCH:-amd64}" in amd64) ;; *) echo "Only linux/amd64 is supported" >&2; exit 1 ;; esac \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        dbus-x11 \
        fonts-liberation \
        fonts-noto-color-emoji \
        gnupg \
        imagemagick \
        jq \
        netcat-openbsd \
        openbox \
        sqlite3 \
        tigervnc-scraping-server \
        tini \
        util-linux \
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
        google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --uid 1000 --create-home --shell /bin/sh openbot \
    && install -d -o openbot -g openbot -m 0755 /opt/openbot /opt/openbot/releases \
    && install -d -o openbot -g openbot -m 0700 /run/openbot /var/lib/openbot

COPY --chmod=0755 entrypoint.sh /usr/local/bin/openbot-entrypoint
COPY --chmod=0755 start-agent-desktop.sh /usr/local/bin/start-agent-desktop

ENV HOME=/home/openbot \
    LANG=C.UTF-8 \
    NODE_ENV=production \
    OPENBOT_COMPUTER_TIMEOUT_MS=120000 \
    OPENBOT_DATA_DIR=/var/lib/openbot \
    OPENBOT_DESKTOP_DRIVER=/opt/openbot/active/runtime/bin/openbot-desktop-driver \
    OPENBOT_DESKTOP_DRIVER_ARGS=[] \
    OPENBOT_DESKTOP_MODE=per-agent \
    OPENBOT_GITHUB_REPO=leMedi/openbot \
    OPENBOT_PUBLIC_URL=http://localhost:3000 \
    OPENBOT_START_WINDOW=/usr/local/bin/start-agent-desktop \
    HOST=0.0.0.0 \
    PORT=3000 \
    XDG_RUNTIME_DIR=/run/openbot

USER openbot
WORKDIR /opt/openbot

VOLUME ["/var/lib/openbot"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl --fail --silent --show-error "http://127.0.0.1:${PORT:-3000}/" >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/local/bin/openbot-entrypoint"]
