# OpenBot desktop driver

`@openbot/desktop-driver` contains two boundaries:

- `openbot-desktop-driver`, a Debian/X11 executor that accepts one JSON request
  on stdin and writes one JSON response to stdout;
- `ComputerUseClient`, the TypeScript client used by OpenBot Computer Use and
  future Browser Use integrations.

The JSON field names and envelopes follow the `ExecService.Exec` protobuf
contract. This is a local process protocol, not a gRPC transport.

## Host dependencies

The driver requires an accessible X11 display and these Debian packages:

```sh
sudo apt-get install -y imagemagick xdotool x11-xserver-utils
```

ImageMagick captures WebP screenshots, `xdotool` performs the normalized mouse
and keyboard actions, and `xmodmap` verifies whether typed characters already
have key bindings. Commands are spawned directly and never through a shell.

Each request is limited to ten actions. The executor checks that the live X
display is 1280×800 before acting and validates captured WebP dimensions. A
mutating sequence automatically gets a final screenshot unless its last action
is already a screenshot. Typing a character absent from the live X keymap
requires `bind_unmapped_characters: true`.

## Build and run

```sh
pnpm --filter @openbot/desktop-driver build
```

The executable requires a trusted display number supplied by its host:

```sh
printf '%s\n' '{
  "id": 1,
  "exec_id": "exec_example",
  "computer_use_args": {
    "tool_call_id": "tool_example",
    "actions": [{"screenshot": {}}]
  }
}' | packages/desktop-driver/dist/openbot-desktop-driver.cjs --display-number 1
```

The display number is deliberately absent from the JSON request. OpenBot reads
the assigned display from the agent record, preventing a tool request from
selecting another agent's desktop.

## TypeScript client

```ts
import { ComputerUseClient } from '@openbot/desktop-driver'

await using client = new ComputerUseClient({
  executable: '/path/to/openbot-desktop-driver',
  displayNumber: 1,
})

const response = await client.exec({
  id: 1,
  exec_id: 'exec_example',
  computer_use_args: {
    tool_call_id: 'tool_example',
    actions: [{ screenshot: {} }],
  },
})
```

When a success or error result contains screenshot base64, the client validates
that it is bounded WebP data, writes it with mode `0600` under a private
temporary directory, and adds `screenshot_path` to the returned result. Calling
`dispose()` (or leaving an `await using` scope) removes client-owned temporary
screenshots. A caller-provided `temporaryDirectory` is not removed.
