# Argent Project Router

Argent is a public-ready, local-first personal finance workspace. It uses Plaid for provider data, local SQLite as the source of truth, Electron for the desktop UI, a CLI for local operations, and MCP tools for agents.

Start with `AGENTS.md` for the always-loaded contract. Use this file as the router for deeper context.

## Architecture

- Desktop UI: `apps/desktop/`
  - React app: `apps/desktop/src/renderer/App.tsx`
  - Electron main and CLI sidecar bridge: `apps/desktop/src/main.ts`
  - IPC contract: `apps/desktop/src/shared/ipc.ts`
  - Smoke test: `apps/desktop/src/smoke.ts`
- CLI: `apps/cli/src/main.ts`
  - Commands for init, desktop, Plaid link/sync, connections, review, transactions, rules, budgets, recurrings, proposals, reports, export, MCP.
- MCP server: `apps/mcp/src/server.ts`
  - Read tools, proposal tools, and explicit apply tool.
- Core domain: `packages/core/src/`
  - Config and local paths: `packages/core/src/config.ts`
  - SQLite open/migrate/write helpers: `packages/core/src/db.ts`
  - Schema and legacy import: `packages/core/src/migrations.ts`
  - Reports, review, proposals, enrichment: `packages/core/src/services.ts`
  - CSV export: `packages/core/src/csv.ts`
- Plaid provider: `packages/plaid/src/`
  - Client/config: `packages/plaid/src/client.ts`, `packages/plaid/src/config.ts`
  - Link flow: `packages/plaid/src/link.ts`
  - Transactions, balances, investments, liabilities, health, disconnect: `packages/plaid/src/sync.ts`
  - Public mock fixture: `packages/plaid/fixtures/mock-plaid-sync.json`
- Agent skill package: `packages/agent-skills/skills/argent/SKILL.md`
- CI and hygiene: `.github/workflows/ci.yml`, `scripts/check-public-hygiene.mjs`

## Read Next

- Major subsystem map: `docs/agent/subsystems.md`
- Common commands and workflows: `docs/agent/runbooks.md`
- Architecture decisions: `docs/agent/decisions.md`
- Gotchas and mistakes to avoid: `docs/agent/lessons.md`
- Product/user-facing overview: `README.md`
