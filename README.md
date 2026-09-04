# Openbot

## Setup

```sh
pnpm install
cp .env.example .env
pnpm dev
```

The app runs at `http://localhost:3000`. Relative values of
`OPENBOT_DATA_DIR` are resolved from the repository root, and the database is
stored at `$OPENBOT_DATA_DIR/store.db`.
The server applies committed database migrations automatically at startup and
stops if migration fails. `pnpm db:migrate` remains available for explicit
deployment or development migration runs.

For installation and updates on an x86-64 Debian server, see
[`docs/deployment/debian.md`](docs/deployment/debian.md).

## Commands

- `pnpm dev` starts the TanStack Start app.
- `pnpm build` builds all workspaces.
- `pnpm typecheck` checks all workspaces.
- `pnpm db:generate` generates Drizzle migrations.
- `pnpm db:migrate` applies Drizzle migrations.
- `pnpm db:studio` opens Drizzle Studio.
- `pnpm --filter app ui:add <component>` installs another shadcn component.

Optional visual control uses a server-local executable. See
[`docs/desktop-driver.md`](docs/desktop-driver.md) for configuration and the
driver protocol.
