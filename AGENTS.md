# Agent Contract

Argent is a local-first finance app: Electron desktop, CLI, MCP server, Plaid provider package, and SQLite core.

## Commands

```sh
pnpm install
pnpm desktop
pnpm cli -- --help
pnpm mcp
pnpm hygiene
pnpm typecheck
pnpm test
pnpm build
pnpm smoke
pnpm ci
```

Use `pnpm smoke` for the desktop smoke test. GitHub Actions sets `ELECTRON_DISABLE_SANDBOX=1` for Linux Electron smoke; do not add that to app code.

## Local State

Default private state is outside the repo:

```text
~/.argent/state.sqlite
~/.argent/exports/
~/.argent/rules.json
```

Override with `ARGENT_HOME`, `ARGENT_DB_PATH`, `ARGENT_EXPORT_DIR`, `ARGENT_RULES_PATH`. Plaid variables are documented in `.env.example`.

Never commit `.env`, `.argent/`, `.bank-transactions/`, SQLite DBs, CSV exports, OAuth JSON, `dist/`, `node_modules/`, or `artifacts/`.

## Edit Boundaries

- Prefer repo patterns over new abstractions.
- Keep generated build output ignored.
- Desktop main must not import `@argent/core` or `@argent/plaid`; it launches the CLI as a Node sidecar to avoid Electron/native `better-sqlite3` ABI issues.
- Agent writes should use proposals/apply paths with audit entries, not direct ad hoc DB mutation.

## Validation Expectations

For normal code changes run:

```sh
pnpm hygiene && pnpm typecheck && pnpm test
```

For desktop, IPC, CLI sidecar, or UI changes also run:

```sh
pnpm smoke
```

Before pushing public changes, run `pnpm ci` when feasible.
