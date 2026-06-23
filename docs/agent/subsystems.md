# Subsystems

## Data Flow

```text
Plaid Link/sync or mock fixture
  -> packages/plaid/src/sync.ts
  -> packages/core/src/db.ts + packages/core/src/migrations.ts
  -> ~/.argent/state.sqlite
  -> packages/core/src/services.ts
  -> CLI reports, MCP tools, Electron IPC
```

Desktop data flow:

```text
apps/desktop/src/renderer/App.tsx
  -> window.argent from apps/desktop/src/preload.cjs
  -> apps/desktop/src/main.ts IPC handlers
  -> node apps/cli/dist/main.js --json
  -> packages/core services through the CLI
```

## Desktop

Entry points:

- `apps/desktop/src/main.ts`: Electron window and IPC handlers.
- `apps/desktop/src/preload.cjs`: exposes `window.argent`.
- `apps/desktop/src/renderer/App.tsx`: all current views.
- `apps/desktop/src/smoke.ts`: end-to-end desktop smoke.

Current views are Dashboard, Transactions, Budgets, Accounts, Recurrings, Investments, Liabilities, Proposals. The UI is intentionally thin; most behavior should live in `packages/core`.

## CLI

Entry point: `apps/cli/src/main.ts`.

Commands currently registered:

```sh
argent init
argent desktop
argent link plaid
argent sync plaid
argent connections list
argent connections health <connection-id>
argent connections disconnect <connection-id>
argent review
argent transactions list
argent rules list
argent rules apply
argent budget list
argent budget set
argent recurrings list
argent recurrings detect
argent proposals list
argent proposals apply
argent report dashboard
argent report cash-flow
argent report accounts
argent report investments
argent report liabilities
argent report proposals
argent export transactions
argent mcp
```

## MCP

Entry point: `apps/mcp/src/server.ts`.

Read tools:

- `argent_dashboard`
- `argent_accounts`
- `argent_transactions`
- `argent_cash_flow`
- `argent_budgets`
- `argent_recurrings`
- `argent_investments`
- `argent_liabilities`
- `argent_list_proposals`

Write path:

- Proposal tools create pending rows in `agent_proposals`.
- `argent_apply_proposal` applies a pending proposal and writes audit metadata.

## Core

Important files:

- `packages/core/src/config.ts`: resolves `ARGENT_HOME`, DB path, export path, rules path.
- `packages/core/src/migrations.ts`: schema, indexes, seed categories, legacy Bank Transactions import.
- `packages/core/src/db.ts`: open DB, connection/account/transaction writes, audit, export rows.
- `packages/core/src/services.ts`: dashboard, transactions, budgets, accounts, investments, liabilities, review, proposals, recurring enrichment.
- `packages/core/src/rules.ts`: JSON rule loading and application.
- `packages/core/src/normalize.ts`: provider-to-domain normalization.

Schema includes provider connections, accounts, balances, categories, tags, reviews, rules, budgets, rollovers, goals, recurrings, securities, holdings, investment transactions, liabilities, sync runs, enrichment events, agent proposals, audit log, and export audit.

## Plaid

Important files:

- `packages/plaid/src/link.ts`: local Plaid Link server and token exchange.
- `packages/plaid/src/sync.ts`: transactions cursor sync, mutation retry, balances, investments, liabilities, item health, disconnect, mock fixture import.
- `packages/plaid/fixtures/mock-plaid-sync.json`: public synthetic fixture used by tests and smoke.

Plaid access tokens are stored only in local SQLite. Do not print or commit them.
