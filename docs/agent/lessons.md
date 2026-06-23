# Lessons

## Do Not Import Core Into Electron Main

`better-sqlite3` is native. Electron and Node use different native module ABIs. Keep desktop main on IPC plus CLI sidecar:

- Good: `apps/desktop/src/main.ts` calls `node apps/cli/dist/main.js ... --json`.
- Bad: `apps/desktop/src/main.ts` imports `openDatabase` from `@argent/core`.

## Preload Is CommonJS On Purpose

`apps/desktop/src/preload.cjs` is copied into `dist/preload.cjs`. Do not casually convert it back to TypeScript/ESM; an earlier TS preload left `window.argent` missing at runtime.

## Build Order Matters

Desktop smoke needs the CLI built first because Electron main invokes `apps/cli/dist/main.js`.

Use:

```sh
pnpm smoke
```

or the desktop package script:

```sh
pnpm --filter @argent/desktop smoke
```

## Legacy DB Import Has Index Name Collisions

The legacy Bank Transactions DB had indexes named like `idx_transactions_account_date`. During legacy migration, old tables are renamed, but index names can still occupy the global SQLite namespace. If importing a raw legacy copy manually, drop legacy `idx_transactions_*` indexes in the copy before Argent migration.

Do not modify the private source DB for this.

## System sqlite3 May Behave Differently From App SQLite

On the local WAL database, `node apps/cli/dist/main.js ...` and Python SQLite opened `~/.argent/state.sqlite` successfully while `sqlite3 -readonly` returned `unable to open database file` in one session. Verify through the app/CLI when SQLite CLI behavior is suspect.

## Hygiene Scanner Has Two Modes

`scripts/check-public-hygiene.mjs` scans `git ls-files` when files are tracked. In a brand-new untracked repo it walks the tree, skipping `.git`, `node_modules`, `dist`, and `coverage`.

Run it before staging and after staging.

## Dist And Artifacts Are Ignored

`pnpm build`, `pnpm smoke`, and Electron dev commands write `dist/` and `artifacts/desktop-smoke.png`. These should stay ignored.

## Mock Fixture Is Public, Local DB Is Not

Use `packages/plaid/fixtures/mock-plaid-sync.json` for tests and demos. Real data belongs in `~/.argent` or another ignored private path.

## Commit Message Preference

Use lowercase commit messages.
