# Agent evals

This package runs local behavioral evaluations against OpenBot's real durable
turn runner. Promptfoo owns the scenario matrix and report; a custom provider
creates an isolated OpenBot database for every case and reuses the installation's
Pi provider files from `$OPENBOT_DATA_DIR/pi-agent`.

The provider reads tool calls, arguments, and results from the isolated Pi JSONL
session. Promptfoo stores that trace in its local results database; treat the
results as private if scenarios exercise connected services.

## Run

Authenticate the model provider in OpenBot first, then run from the repository
root:

```sh
pnpm eval:agents
pnpm eval:agents:view
```

The initial PO scenario uses `opencode-go/hy3`. If that reference is not in the
current OpenCode Go catalog, replace it in `promptfooconfig.yaml` with the exact
reference shown by OpenBot's model picker.

The eval is intentionally serial and uncached. For stability checks, repeat it:

```sh
pnpm --filter @openbot/agent-evals eval -- --repeat 3
```

Each run copies only `auth.json`, `models.json`, and `models-store.json` into a
temporary data directory. The temporary database, workspace, and Pi session are
removed after the case finishes. Promptfoo's local result database remains so
`promptfoo view` can display past runs.
