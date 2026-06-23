# Decisions

## Public Repo Starts Clean

Argent was created as a new repo instead of reusing the private Bank Transactions git history. The private source repo contained local finance data, `.env`, SQLite state, exports, generated output, and other unsafe tracked files.

Implication: copy patterns, not history or private fixtures.

## Local-First Source Of Truth

SQLite under `~/.argent/state.sqlite` is the durable store. The repo should contain schema, code, mock fixtures, and docs only.

Implication: `pnpm hygiene` blocks private/generated paths and common secret patterns.

## Desktop Uses A CLI Sidecar

Electron main does not import `@argent/core` or `@argent/plaid`. It shells out to the built CLI with `--json`.

Reason: `@argent/core` uses native `better-sqlite3`. Loading it directly in Electron hit Node/Electron native ABI problems. The sidecar keeps native SQLite in normal Node.

## Agent Writes Use Proposals

Agents can read broad local finance surfaces through MCP, but durable changes should be pending proposals first. Applying proposals is an explicit command/tool invocation and writes audit entries.

Reason: local finance automation needs a reversible, inspectable write path. Autonomous enrichment is limited to provenance-backed metadata with `source`, `confidence`, `reason`, and audit logging.

## Plaid Is The First Provider

`packages/plaid` owns Plaid Link, sync, balances, investments, liabilities, health refresh, disconnect, and mock fixture import.

Reason: Plaid covers the first useful expansion wave: transactions, balances, investments, and liabilities. Provider-specific logic should not leak into desktop UI.

## No Manual Spend Entry In V1

The schema supports metadata overrides, reviews, rules, budgets, recurrings, and proposals. It does not prioritize manual cash/spend transaction entry.

Reason: v1 is based on linked provider data and safe metadata correction, not acting as a full ledger app.

## GitHub Electron Smoke Disables Linux Sandbox

The CI workflow sets `ELECTRON_DISABLE_SANDBOX=1` only for `xvfb-run -a pnpm smoke`.

Reason: GitHub runners do not set Electron `chrome-sandbox` to root-owned mode `4755`. This is a CI execution detail, not an app behavior.
