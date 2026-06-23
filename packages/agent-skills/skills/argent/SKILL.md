---
name: argent
description: Work with Argent, a local-first personal finance desktop app, CLI, and MCP server backed by SQLite and Plaid. Use for transaction review, budgets, cash flow, recurring charges, account health, investments, liabilities, and agent proposals.
---

# Argent

Argent is a local-first finance workspace. The durable store is a local SQLite database, usually under `~/.argent/state.sqlite`.

## Safety Model

- Prefer read-only MCP tools or CLI report commands before proposing changes.
- Do not create manual spend entries.
- Do not perform money movement, bill pay, trading, or spending actions.
- Use proposal tools for category, rule, budget, and recurring suggestions.
- Apply proposals only after the user explicitly asks for the write.
- Autonomous enrichment may write only provenance-backed metadata: `source`, `confidence`, `reason`, and audit-log entries.
- Do not print Plaid access tokens, `.env` values, SQLite raw provider payloads, OAuth JSON, or large raw transaction exports.

## CLI

```sh
argent report dashboard --json
argent report cash-flow --months 12 --json
argent report liabilities --json
argent review --queue --json
argent recurrings list --json
argent recurrings detect --json
argent budget list --json
argent proposals list --json
argent proposals apply <proposal-id> --json
argent export transactions --output ./transactions.csv --json
argent mcp
```

## MCP Tools

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

Proposal tools:

- `argent_propose_category_change`
- `argent_propose_rule`
- `argent_propose_budget`
- `argent_propose_recurring`

Explicit write tool:

- `argent_apply_proposal`

## Workflow

1. Read the relevant surface.
2. Summarize the observed issue or opportunity.
3. Create a proposal when a durable change is appropriate.
4. Wait for explicit user approval before applying the proposal.
