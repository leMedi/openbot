# Local desktop driver

Computer Use runs on the same **Remote Desktop** machine as the OpenBot server.
The bundled Debian driver is configured with:

```dotenv
OPENBOT_DESKTOP_DRIVER=/opt/openbot/current/runtime/bin/openbot-desktop-driver
OPENBOT_DESKTOP_DRIVER_ARGS=[]
OPENBOT_COMPUTER_TIMEOUT_MS=120000
```

The executable is started directly, never through a shell. It reads one JSON
`ExecServerMessage` from stdin and writes one JSON `ExecStreamElement` to
stdout. JSON uses the protobuf field names in snake case.

OpenBot appends the trusted `--display-number <number>` argument from the
current agent's `xDisplayNumber`. Display selection is intentionally not part
of the request contract.

## Request

```json
{
  "id": 1,
  "exec_id": "exec_example",
  "computer_use_args": {
    "tool_call_id": "tool_example",
    "actions": [
      {
        "click": {
          "coordinate": { "x": 10, "y": 20 },
          "button": "MOUSE_BUTTON_LEFT",
          "count": 1
        }
      },
      { "screenshot": {} }
    ],
    "description": "Open the selected item"
  }
}
```

Actions support `mouse_move`, `click`, `mouse_down`, `mouse_up`, `drag`,
`scroll`, `type`, `key`, `wait`, `screenshot`, and `cursor_position` variants.
Requests are limited to ten actions. The executor verifies the live display and
captured image dimensions before relying on the fixed 1280×800 coordinate
space. Mutating sequences receive an automatic final screenshot unless the
last action is already a screenshot. Non-ASCII typing requires
`bind_unmapped_characters: true` only when a character is absent from the live
X keymap.

## Response

```json
{
  "exec_client_message": {
    "id": 1,
    "exec_id": "exec_example",
    "local_execution_time_ms": 25,
    "computer_use_result": {
      "success": {
        "action_count": 2,
        "duration_ms": 25,
        "screenshot": "UklGR...",
        "cursor_position": { "x": 10, "y": 20 }
      }
    }
  }
}
```

The binary returns screenshot WebP bytes as base64. The exported TypeScript
`ComputerUseClient` validates and saves those bytes in a private temporary file,
then adds `screenshot_path` to the result. OpenBot subsequently persists the
image through its managed-file service.

Failures use the `computer_use_result.error` variant. `error_code` distinguishes
an unavailable assigned display from another driver failure. Invalid top-level
requests use `exec_client_control_message.throw`.

See `packages/desktop-driver/README.md` for building and direct invocation.
