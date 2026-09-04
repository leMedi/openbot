# Local desktop driver

Computer Use runs on the same **Remote Desktop** machine as the OpenBot server.
Configure a local driver executable with:

```dotenv
OPENBOT_DESKTOP_DRIVER=/absolute/path/to/openbot-desktop-driver
OPENBOT_DESKTOP_DRIVER_ARGS=[]
OPENBOT_COMPUTER_TIMEOUT_MS=120000
```

The executable is started directly, never through a shell. It reads one JSON
request from stdin and writes one JSON response to stdout.

## Requests

```json
{"version":1,"operation":"display"}
{"version":1,"operation":"screenshot"}
{"version":1,"operation":"execute","actions":[{"action":"click","x":10,"y":20,"button":"left","clickCount":1}]}
```

`execute.actions` supports `screenshot`, `click`, `move`, `drag`, `type`,
`key`, `scroll`, and `wait`. OpenBot validates and normalizes every action
before invoking the executable.

## Responses

```json
{"ok":true,"display":{"width":1280,"height":800,"sessionId":"display-0"}}
```

```json
{
  "ok": true,
  "screenshot": {
    "dataBase64": "...",
    "mediaType": "image/png",
    "width": 1280,
    "height": 800,
    "cursor": {"x": 42, "y": 24},
    "stateId": "optional-driver-state-id"
  }
}
```

An execute response may contain `cursor` and a final `screenshot`. If the
driver omits the required final screenshot, OpenBot calls `screenshot`
immediately afterward.

Failures use `{"ok":false,"status":"desktop_unavailable","error":"..."}`.
Recognized driver statuses are `desktop_unavailable`, `timeout`, `cancelled`,
and `driver_failure`; all unknown failures normalize to `driver_failure`.

The driver must target the configured graphical session on the server. It must
not capture or inject input into a connected web/mobile client device.
