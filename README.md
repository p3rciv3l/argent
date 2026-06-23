# Argent

Argent is a local-first personal finance workspace: an Electron desktop app, a CLI, and an MCP server backed by a local SQLite database.

The product is intentionally desktop-first and agent-native. Plaid is the first provider, local SQLite is the system of record, and AI features work through bring-your-own-key agents or local CLI/MCP workflows. Agents may read broadly, but durable writes go through explicit local tools. Autonomous writes are limited to enrichment/provenance records with `source`, `confidence`, `reason`, and audit-log entries.

## Scope

- Spending, income, cash flow, budgets, recurring charges, account health, net worth, investments, and liabilities.
- No manual spend entry in v1.
- Metadata overrides are allowed: transaction type, category, tags, review state, recurring links, budget settings, and rules.
- No money movement, bill pay, trading, or spending actions.

## Workspace

```sh
pnpm install
pnpm --filter @argent/cli dev -- init
pnpm build
pnpm test
pnpm hygiene
```

Apps and packages:

- `apps/desktop`: Electron + React desktop shell.
- `apps/cli`: `argent` command for sync, reports, review, rules, budgets, exports, desktop launch, and MCP launch.
- `apps/mcp`: stdio MCP server exposing typed local finance tools.
- `packages/core`: SQLite schema, migrations, services, analytics, rules, and exports.
- `packages/plaid`: Plaid Link, sync, balances, investments, liabilities, and mock fixtures.
- `packages/agent-skills`: installable agent skill content.

## Local Data

By default Argent writes private state under `~/.argent`:

- `~/.argent/state.sqlite`
- `~/.argent/exports/transactions.csv`
- `~/.argent/rules.json`

You can override paths with `ARGENT_HOME`, `ARGENT_DB_PATH`, `ARGENT_EXPORT_DIR`, and `ARGENT_RULES_PATH`. Do not put real databases, CSV exports, OAuth JSON, or `.env` files in this repository.

## CLI

```sh
argent desktop
argent init
argent link plaid
argent sync plaid --mock
argent review --queue
argent report dashboard
argent report cash-flow --months 12
argent report liabilities
argent budget list
argent recurrings list
argent proposals list
argent proposals apply <proposal-id>
argent export transactions
argent mcp
```

## MCP Safety Model

Read tools expose dashboard, accounts, transactions, cash flow, budgets, recurrings, investments, and liabilities. Proposal tools create pending category, rule, budget, and recurring changes. Apply tools require an explicit invocation and record audit entries.

Agent skill installation follows the open `npx skills` format. Once this repo is published, install the Argent skill with:

```sh
npx skills add <owner>/argent --skill argent
```

## Public Repo Hygiene

This repo is safe to publish only if `pnpm hygiene` passes. The check blocks tracked `.env` files, SQLite databases, CSV exports, OAuth files, Plaid access-token patterns, OpenAI key patterns, and private-key material.
