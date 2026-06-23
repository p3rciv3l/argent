# Runbooks

## Fresh Setup

```sh
pnpm install
pnpm --filter @argent/cli dev -- init
pnpm hygiene
pnpm typecheck
pnpm test
```

Use `.env.example` for Plaid variable names. Keep real `.env` untracked.

## Run Locally

Desktop:

```sh
pnpm desktop
```

Renderer is served by Vite on `127.0.0.1:5173`. Electron loads the renderer and calls the built CLI sidecar.

CLI:

```sh
pnpm cli -- --help
pnpm cli -- sync plaid --mock --json
pnpm cli -- report dashboard --json
```

MCP server:

```sh
pnpm mcp
```

## Populate Local Test Data

Public mock data:

```sh
pnpm cli -- init
pnpm cli -- sync plaid --mock --json
pnpm cli -- recurrings detect --json
```

Private data should live only under `~/.argent`. If importing from a private legacy DB, work from a SQLite backup/copy, never from files staged in this repo. After import, verify with aggregate counts only.

## Add A Feature

1. Put persistent schema changes in `packages/core/src/migrations.ts`.
2. Put domain behavior in `packages/core/src/services.ts` or a focused core module.
3. Expose local operations in `apps/cli/src/main.ts`.
4. Expose agent-safe reads/proposals in `apps/mcp/src/server.ts` when useful.
5. Add desktop UI in `apps/desktop/src/renderer/App.tsx` only after the core/CLI behavior exists.
6. Add focused tests near the package that owns the behavior.

Prefer explicit proposal/apply flows for durable agent writes.

## Validate

Cheap default:

```sh
pnpm hygiene && pnpm typecheck && pnpm test
```

Desktop or IPC changes:

```sh
pnpm smoke
```

Full local CI:

```sh
pnpm ci
```

GitHub Actions runs:

```sh
gh run list -R p3rciv3l/argent --limit 5
gh run view <run-id> -R p3rciv3l/argent --log-failed
```

## Debug Desktop

If `window.argent` is missing, inspect:

- `apps/desktop/src/preload.cjs`
- `apps/desktop/src/main.ts`
- `apps/desktop/tsconfig.node.json`
- `apps/desktop/package.json` `build:main`

If Electron cannot load SQLite, check whether desktop main imported `@argent/core` or `@argent/plaid`. It should not.

## Publish

Before pushing:

```sh
pnpm ci
git status --short
git ls-files -ci --exclude-standard
```

Commit messages should be lowercase.

Current GitHub repo:

```text
https://github.com/p3rciv3l/argent
```
