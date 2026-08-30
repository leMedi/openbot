# Openbot

## Setup

```sh
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm dev
```

The app runs at `http://localhost:3000`. Relative values of
`OPENBOT_DATA_DIR` are resolved from the repository root, and the database is
stored at `$OPENBOT_DATA_DIR/store.db`.

## Commands

- `pnpm dev` starts the TanStack Start app.
- `pnpm build` builds all workspaces.
- `pnpm typecheck` checks all workspaces.
- `pnpm db:generate` generates Drizzle migrations.
- `pnpm db:migrate` applies Drizzle migrations.
- `pnpm db:studio` opens Drizzle Studio.
- `pnpm --filter app ui:add <component>` installs another shadcn component.
