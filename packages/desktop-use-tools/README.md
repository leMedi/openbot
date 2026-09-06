# Desktop use tools

Host-level tools for provisioning the graphical desktops used by OpenBot
agents. These tools target Debian and are separate from the desktop driver
that captures screenshots and injects input.

## `start-window`

`start-window` provisions a persistent, headless Xvfb display for one agent:

```sh
start-window <display-number> <owner-id>
```

For example:

```sh
start-window 2 agt_example
```

The display is `:<display-number>` and initially contains one
`1280x800x24` screen. Xvfb is detached after it accepts connections and keeps
running until it is explicitly terminated or the machine shuts down. Running
the command again with the same display and owner is idempotent.

The Debian host must provide `Xvfb`:

```sh
apt-get install xvfb
```

This first tool only creates the X display. A VNC server, noVNC proxy, window
manager, and applications can be attached in later provisioning steps.

### Exit codes

| Code | Meaning |
| ---: | --- |
| `0` | The display is running and belongs to the requested owner. |
| `75` | The display is unavailable, starting, unmanaged, or owned by another agent. |
| Other | Provisioning failed; the error is written to stderr. |

The command writes no success output. Callers already know the resulting
display from the first argument.

### Build and invoke

Build the dependency-free Node.js executable:

```sh
pnpm --filter @openbot/desktop-use-tools build
```

It can then be invoked directly, through Node.js, or from `spawn`:

```sh
packages/desktop-use-tools/dist/start-window.cjs 2 agt_example
node packages/desktop-use-tools/dist/start-window.cjs 2 agt_example
```

```ts
import { spawn } from 'node:child_process'

const child = spawn('/path/to/start-window.cjs', ['2', 'agt_example'])
```

Installing or linking the package exposes the executable as `start-window`.
The built file only requires Node.js at runtime; TypeScript and package
dependencies are bundled.

Configure the OpenBot server to use the built executable when creating agents:

```dotenv
OPENBOT_START_WINDOW=/absolute/path/to/start-window
```

## `stop-window`

`stop-window <display-number> <owner-id>` verifies the persisted owner, stops
the managed Xvfb process group, and removes its ownership state. Repeating a
successful stop is safe. Configure it for agent deletion:

```dotenv
OPENBOT_STOP_WINDOW=/absolute/path/to/stop-window
```

### Runtime state

Ownership and PID state is stored in:

1. `$XDG_RUNTIME_DIR/openbot/agent-window-management`, when
   `XDG_RUNTIME_DIR` is set; or
2. `/tmp/openbot-agent-window-management-<uid>` otherwise.

The state directory is restricted to its Unix user. Display ownership is an
operational coordination mechanism, not a security boundary between agents
running as the same Unix user.

Optional environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENBOT_XVFB_PATH` | `Xvfb` from `PATH` | Xvfb executable path. |
| `OPENBOT_XVFB_START_TIMEOUT_MS` | `10000` | Time allowed for the X socket to accept connections. |
