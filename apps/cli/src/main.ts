#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { Command } from "commander";
import { getConnectorModule, listConnectorDefinitions, type ConnectorSetupOptions } from "@argent/connectors";
import {
  applyAgentProposal,
  applyTransactionChanges,
  applyTransactionRules,
  createAgentProposal,
  ensureArgentPaths,
  exportTransactions,
  getAccounts,
  getArgentPaths,
  getBudgets,
  getCashFlow,
  getDashboard,
  getInvestments,
  getLiabilities,
  getRecurrings,
  getConnection,
  listAgentProposals,
  listConnections,
  listTransactions,
  loadTransactionRules,
  markMatchingConnectorTransfers,
  matchMerchantOrdersToTransactions,
  openDatabase,
  recordExport,
  recordSyncRun,
  reviewTransactions,
  runRecurringEnrichment,
  insertAuditLog,
  updateConnectionSyncState,
  upsertAccounts,
  upsertAssetValuations,
  upsertConnection,
  upsertExternalAssets,
  upsertMerchantOrders,
  writeCsv
} from "@argent/core";
import {
  applyMockPlaidSyncFixture,
  createPlaidClient,
  defaultMockFixturePath,
  disconnectPlaidConnection,
  getPlaidConfig,
  loadMockPlaidFixture,
  refreshPlaidItemHealth,
  startPlaidLink,
  syncPlaidTransactions
} from "@argent/plaid";
import { startMcpServer } from "@argent/mcp";

type Jsonable = unknown;

function print(value: Jsonable, json: boolean | undefined): void {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
  } else if (typeof value === "string") {
    console.log(value);
  } else {
    console.log(JSON.stringify(value, null, 2));
  }
}

function splitIds(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function withDb<T>(databasePath: string | undefined, fn: (db: ReturnType<typeof openDatabase>) => T): T {
  const db = openDatabase(databasePath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

async function withDbAsync<T>(
  databasePath: string | undefined,
  fn: (db: ReturnType<typeof openDatabase>) => Promise<T>
): Promise<T> {
  const db = openDatabase(databasePath);
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

function findWorkspaceRoot(start: string): string | null {
  let current = path.resolve(start);
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    current = path.dirname(current);
  }
  return null;
}

function runDesktop(): Promise<void> {
  const root = findWorkspaceRoot(process.cwd());
  if (!root) {
    throw new Error("Could not find pnpm-workspace.yaml. Run desktop from the Argent workspace for now.");
  }
  const child = spawn("pnpm", ["--filter", "@argent/desktop", "dev"], {
    cwd: root,
    stdio: "inherit"
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Desktop process exited with code ${code ?? "unknown"}.`));
      }
    });
  });
}

function parseSetupState(setupStateJson: string | null | undefined): Record<string, unknown> {
  if (!setupStateJson) {
    return {};
  }
  const parsed = JSON.parse(setupStateJson) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function redactConnection(connection: NonNullable<ReturnType<typeof getConnection>>): Record<string, unknown> {
  const { accessToken, setupStateJson, ...safe } = connection;
  return {
    ...safe,
    hasAccessToken: Boolean(accessToken),
    setupState: parseSetupState(setupStateJson)
  };
}

function connectorSetupOptions(options: {
  demo?: boolean;
  fixture?: string;
  displayName?: string;
  providerItemId?: string;
  apiKeyEnv?: string;
  credentialLabel?: string;
  chain?: string;
  address?: string;
  propertyAddress?: string;
}): ConnectorSetupOptions {
  return {
    demo: Boolean(options.demo),
    ...(options.fixture ? { fixturePath: path.resolve(process.cwd(), options.fixture) } : {}),
    ...(options.displayName ? { displayName: options.displayName } : {}),
    ...(options.providerItemId ? { providerItemId: options.providerItemId } : {}),
    ...(options.apiKeyEnv ? { apiKeyEnv: options.apiKeyEnv } : {}),
    ...(options.credentialLabel ? { credentialLabel: options.credentialLabel } : {}),
    ...(options.chain ? { chain: options.chain } : {}),
    ...(options.address ? { address: options.address } : {}),
    ...(options.propertyAddress ? { propertyAddress: options.propertyAddress } : {})
  };
}

function setupConnectorConnection(
  db: ReturnType<typeof openDatabase>,
  connectorId: string,
  options: ConnectorSetupOptions
): Record<string, unknown> {
  const connector = getConnectorModule(connectorId);
  if (!connector) {
    throw new Error(`Connector ${connectorId} is not available for local setup.`);
  }
  const setup = connector.buildSetup(options);
  const now = new Date().toISOString();
  const connectionId = upsertConnection(
    db,
    {
      provider: setup.provider,
      providerItemId: setup.providerItemId,
      connectorId: setup.connectorId,
      displayName: setup.displayName,
      accessToken: setup.accessToken ?? null,
      environment: setup.environment ?? "local",
      institutionName: setup.institutionName ?? setup.displayName,
      status: setup.status ?? "healthy",
      setupState: setup.setupState
    },
    now
  );
  insertAuditLog(db, {
    actor: "cli",
    action: "connector.setup",
    targetType: "connection",
    targetId: connectionId,
    metadata: { connectorId },
    createdAt: now
  });
  const connection = getConnection(db, connectionId);
  if (!connection) {
    throw new Error(`Connector setup did not create ${connectionId}.`);
  }
  return redactConnection(connection);
}

async function syncConnectorConnection(
  db: ReturnType<typeof openDatabase>,
  connectionId: string,
  options: { fixture?: string } = {}
): Promise<Record<string, unknown>> {
  const connection = getConnection(db, connectionId);
  if (!connection) {
    throw new Error(`No connection found for ${connectionId}.`);
  }
  const connectorId = connection.connectorId ?? connection.provider;
  const connector = getConnectorModule(connectorId);
  if (!connector) {
    throw new Error(`No local sync module is registered for connector ${connectorId}.`);
  }

  const startedAt = new Date().toISOString();
  try {
    const payload = await connector.sync(connection, {
      ...(options.fixture ? { fixturePath: path.resolve(process.cwd(), options.fixture) } : {}),
      env: process.env
    });
    if (payload.accounts.length > 0) {
      upsertAccounts(db, payload.accounts, connection.connectionId, payload.syncedAt);
    }
    if (payload.added.length > 0 || payload.modified.length > 0 || payload.removed.length > 0) {
      applyTransactionChanges(db, {
        connectionId: connection.connectionId,
        provider: payload.provider,
        added: payload.added,
        modified: payload.modified,
        removed: payload.removed,
        cursor: payload.cursor ?? null,
        syncedAt: payload.syncedAt
      });
    } else {
      recordSyncRun(db, {
        provider: payload.provider,
        connectionId: connection.connectionId,
        status: "succeeded",
        startedAt,
        completedAt: payload.syncedAt,
        addedCount: payload.orders.length + payload.externalAssets.length + payload.assetValuations.length
      });
    }
    const orderWrite = upsertMerchantOrders(db, payload.orders, payload.syncedAt);
    const assetCount = upsertExternalAssets(db, payload.externalAssets, payload.syncedAt);
    const valuationCount = upsertAssetValuations(db, payload.assetValuations);
    const orderMatches =
      connector.definition.id === "amazon-orders"
        ? matchMerchantOrdersToTransactions(db, connection.connectionId, { matchedAt: payload.syncedAt })
        : 0;
    const internalTransfers =
      connector.definition.id === "cash-app-receipts"
        ? markMatchingConnectorTransfers(db, connection.connectionId, { matchedAt: payload.syncedAt })
        : 0;

    updateConnectionSyncState(db, connection.connectionId, {
      status: "succeeded",
      syncedAt: payload.syncedAt
    });
    insertAuditLog(db, {
      actor: "cli",
      action: "connector.sync",
      targetType: "connection",
      targetId: connection.connectionId,
      metadata: {
        connectorId,
        accounts: payload.accounts.length,
        transactions: payload.added.length + payload.modified.length,
        orders: orderWrite.orders,
        orderItems: orderWrite.items,
        externalAssets: assetCount,
        assetValuations: valuationCount,
        orderMatches,
        internalTransfers
      },
      createdAt: payload.syncedAt
    });
    return {
      connectionId: connection.connectionId,
      connectorId,
      status: "succeeded",
      accounts: payload.accounts.length,
      transactions: payload.added.length + payload.modified.length,
      orders: orderWrite.orders,
      orderItems: orderWrite.items,
      externalAssets: assetCount,
      assetValuations: valuationCount,
      orderMatches,
      internalTransfers,
      syncedAt: payload.syncedAt
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const errorMessage = error instanceof Error ? error.message : String(error);
    recordSyncRun(db, {
      provider: connection.provider,
      connectionId: connection.connectionId,
      status: "failed",
      startedAt,
      completedAt,
      errorMessage
    });
    updateConnectionSyncState(db, connection.connectionId, {
      status: "failed",
      syncedAt: completedAt,
      errorMessage
    });
    throw error;
  }
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("argent")
    .description("Local-first personal finance desktop, CLI, and agent tool suite.")
    .version("0.1.0");

  program
    .command("init")
    .description("Create private local Argent directories, rules file, and SQLite database.")
    .option("--db <path>", "SQLite database path")
    .option("--json", "print JSON")
    .action((options: { db?: string; json?: boolean }) => {
      const basePaths = getArgentPaths();
      const paths = ensureArgentPaths({
        ...basePaths,
        ...(options.db ? { databasePath: path.resolve(process.cwd(), options.db) } : {})
      });
      const db = openDatabase(paths.databasePath);
      db.close();
      print(paths, options.json);
    });

  program
    .command("desktop")
    .description("Launch the Electron desktop app in development mode.")
    .action(async () => {
      await runDesktop();
    });

  const link = program.command("link").description("Link provider accounts.");
  link
    .command("plaid")
    .description("Start local Plaid Link and store the connection locally.")
    .option("-p, --port <port>", "preferred local port", (value) => Number.parseInt(value, 10), 3000)
    .option("--no-browser", "print the local URL instead of opening a browser")
    .option("--db <path>", "SQLite database path")
    .action(async (options: { port: number; browser: boolean; db?: string }) => {
      await startPlaidLink({
        port: options.port,
        noBrowser: options.browser === false,
        ...(options.db ? { databasePath: options.db } : {})
      });
    });

  const sync = program.command("sync").description("Sync provider data.");
  sync
    .command("plaid")
    .description("Sync Plaid transactions, balances, and mock fixtures.")
    .option("--connection <id>", "specific connection id")
    .option("--mock [fixture]", "sync a local Plaid-like mock fixture")
    .option("--dry-run", "fetch/parse without writing")
    .option("--no-investments", "skip Plaid investments sync")
    .option("--no-liabilities", "skip Plaid liabilities sync")
    .option("--no-health", "skip Plaid item health refresh")
    .option("--db <path>", "SQLite database path")
    .option("--json", "print JSON")
    .action(async (options: {
      connection?: string;
      mock?: boolean | string;
      dryRun?: boolean;
      investments?: boolean;
      liabilities?: boolean;
      health?: boolean;
      db?: string;
      json?: boolean;
    }) => {
      const result = await withDbAsync(options.db, async (db) => {
        if (options.mock !== undefined) {
          const fixturePath = typeof options.mock === "string" ? path.resolve(process.cwd(), options.mock) : defaultMockFixturePath();
          const fixture = await loadMockPlaidFixture(fixturePath);
          return applyMockPlaidSyncFixture(db, fixture, Boolean(options.dryRun));
        }
        const config = getPlaidConfig();
        const client = createPlaidClient(config);
        return syncPlaidTransactions(db, client, config, {
          ...(options.connection ? { connectionId: options.connection } : {}),
          dryRun: Boolean(options.dryRun),
          includeInvestments: options.investments !== false,
          includeLiabilities: options.liabilities !== false,
          refreshHealth: options.health !== false
        });
      });
      print(result, options.json);
    });
  sync
    .command("connector")
    .argument("<connection-id>", "connector connection id")
    .description("Sync a locally configured non-Plaid connector.")
    .option("--fixture <path>", "override synthetic fixture path")
    .option("--db <path>", "SQLite database path")
    .option("--json", "print JSON")
    .action(async (connectionId: string, options: { fixture?: string; db?: string; json?: boolean }) => {
      const result = await withDbAsync(options.db, (db) => syncConnectorConnection(db, connectionId, options));
      print(result, options.json);
    });

  const connectors = program.command("connectors").description("Inspect, set up, and sync local connector modules.");
  connectors
    .command("catalog")
    .description("List available, partner-required, and planned connector definitions.")
    .option("--json", "print JSON")
    .action((options: { json?: boolean }) => {
      print(listConnectorDefinitions(), options.json);
    });
  connectors
    .command("setup")
    .argument("<connector-id>", "connector id from connectors catalog")
    .description("Create or update a local connector connection.")
    .option("--demo", "use the bundled synthetic fixture setup")
    .option("--fixture <path>", "synthetic fixture path")
    .option("--display-name <name>", "connection display name")
    .option("--provider-item-id <id>", "provider item id override")
    .option("--api-key-env <name>", "environment variable containing a local read-only API key")
    .option("--credential-label <label>", "non-secret credential label")
    .option("--chain <chain>", "wallet chain, such as btc or eth")
    .option("--address <address>", "wallet address")
    .option("--property-address <address>", "real estate property address")
    .option("--db <path>", "SQLite database path")
    .option("--json", "print JSON")
    .action((connectorId: string, options: {
      demo?: boolean;
      fixture?: string;
      displayName?: string;
      providerItemId?: string;
      apiKeyEnv?: string;
      credentialLabel?: string;
      chain?: string;
      address?: string;
      propertyAddress?: string;
      db?: string;
      json?: boolean;
    }) => {
      const result = withDb(options.db, (db) => setupConnectorConnection(db, connectorId, connectorSetupOptions(options)));
      print(result, options.json);
    });
  connectors
    .command("sync")
    .argument("<connection-id>", "connector connection id")
    .description("Sync a locally configured connector connection.")
    .option("--fixture <path>", "override synthetic fixture path")
    .option("--db <path>", "SQLite database path")
    .option("--json", "print JSON")
    .action(async (connectionId: string, options: { fixture?: string; db?: string; json?: boolean }) => {
      const result = await withDbAsync(options.db, (db) => syncConnectorConnection(db, connectionId, options));
      print(result, options.json);
    });

  const connections = program.command("connections").description("Inspect or manage provider connections.");
  connections
    .command("list")
    .option("--db <path>", "SQLite database path")
    .option("--json", "print JSON")
    .action((options: { db?: string; json?: boolean }) => {
      print(
        withDb(options.db, (db) =>
          listConnections(db).map((connection) => redactConnection(connection))
        ),
        options.json
      );
    });
  connections
    .command("health")
    .argument("<connection-id>", "Plaid connection id")
    .option("--db <path>", "SQLite database path")
    .option("--json", "print JSON")
    .action(async (connectionId: string, options: { db?: string; json?: boolean }) => {
      const result = await withDbAsync(options.db, async (db) => {
        const connection = getConnection(db, connectionId);
        if (!connection) {
          throw new Error(`No connection found for ${connectionId}.`);
        }
        const config = getPlaidConfig();
        const client = createPlaidClient(config);
        return refreshPlaidItemHealth(db, client, connection);
      });
      print(result, options.json);
    });
  connections
    .command("disconnect")
    .argument("<connection-id>", "Plaid connection id")
    .option("--local-only", "delete only the local connection and data")
    .option("--db <path>", "SQLite database path")
    .option("--json", "print JSON")
    .action(async (connectionId: string, options: { localOnly?: boolean; db?: string; json?: boolean }) => {
      const result = await withDbAsync(options.db, async (db) => {
        const config = getPlaidConfig();
        const client = createPlaidClient(config);
        return disconnectPlaidConnection(db, client, connectionId, {
          localOnly: Boolean(options.localOnly),
          actor: "cli"
        });
      });
      print(result, options.json);
    });

  program
    .command("review")
    .description("Inspect or update the transaction review queue.")
    .option("--queue", "show unreviewed transactions")
    .option("--ids <ids>", "comma-separated transaction ids to update")
    .option("--status <status>", "reviewed, unreviewed, or needs_review", "reviewed")
    .option("--db <path>", "SQLite database path")
    .option("--json", "print JSON")
    .action((options: { queue?: boolean; ids?: string; status: "reviewed" | "unreviewed" | "needs_review"; db?: string; json?: boolean }) => {
      const result = withDb(options.db, (db) => {
        if (options.ids) {
          const changed = reviewTransactions(db, splitIds(options.ids), options.status, "cli");
          return { changed };
        }
        return listTransactions(db, { reviewStatus: "unreviewed", limit: 50 });
      });
      print(result, options.json);
    });

  const transactions = program.command("transactions").description("Read local transactions.");
  transactions
    .command("list")
    .option("--account <id>", "filter by account id")
    .option("--category <id>", "filter by category id")
    .option("--start <yyyy-mm-dd>", "filter by start date")
    .option("--end <yyyy-mm-dd>", "filter by end date")
    .option("--recurring <id>", "filter by recurring id")
    .option("--review-status <status>", "unreviewed, reviewed, or needs_review")
    .option("--tag <tag>", "filter by tag")
    .option("--type <type>", "filter by transaction type")
    .option("--search <text>", "search name or merchant")
    .option("--limit <n>", "maximum rows", (value) => Number.parseInt(value, 10), 100)
    .option("--offset <n>", "offset", (value) => Number.parseInt(value, 10), 0)
    .option("--db <path>", "SQLite database path")
    .option("--json", "print JSON")
    .action((options: {
      account?: string;
      category?: string;
      start?: string;
      end?: string;
      recurring?: string;
      reviewStatus?: "unreviewed" | "reviewed" | "needs_review";
      tag?: string;
      type?: "regular" | "income" | "internal_transfer" | "excluded" | "recurring_linked";
      search?: string;
      limit: number;
      offset: number;
      db?: string;
      json?: boolean;
    }) => {
      const result = withDb(options.db, (db) =>
        listTransactions(db, {
          ...(options.account ? { accountId: options.account } : {}),
          ...(options.category ? { categoryId: options.category } : {}),
          ...(options.start ? { startDate: options.start } : {}),
          ...(options.end ? { endDate: options.end } : {}),
          ...(options.recurring ? { recurringId: options.recurring } : {}),
          ...(options.reviewStatus ? { reviewStatus: options.reviewStatus } : {}),
          ...(options.tag ? { tag: options.tag } : {}),
          ...(options.type ? { type: options.type } : {}),
          ...(options.search ? { search: options.search } : {}),
          limit: options.limit,
          offset: options.offset
        })
      );
      print(result, options.json);
    });

  const rules = program.command("rules").description("Inspect or apply local transaction rules.");
  rules
    .command("list")
    .option("--file <path>", "rules JSON path")
    .option("--json", "print JSON")
    .action((options: { file?: string; json?: boolean }) => {
      print(loadTransactionRules(options.file), options.json);
    });
  rules
    .command("apply")
    .option("--file <path>", "rules JSON path")
    .option("--db <path>", "SQLite database path")
    .option("--json", "print JSON")
    .action((options: { file?: string; db?: string; json?: boolean }) => {
      const result = withDb(options.db, (db) => applyTransactionRules(db, loadTransactionRules(options.file)));
      print(result, options.json);
    });

  const budget = program.command("budget").description("Inspect or explicitly set budgets.");
  budget
    .command("list")
    .option("--month <yyyy-mm>", "month to inspect")
    .option("--db <path>", "SQLite database path")
    .option("--json", "print JSON")
    .action((options: { month?: string; db?: string; json?: boolean }) => {
      const result = withDb(options.db, (db) => getBudgets(db, options.month));
      print(result, options.json);
    });
  budget
    .command("set")
    .argument("<category>", "category name")
    .argument("<amount>", "monthly amount", (value) => Number.parseFloat(value))
    .option("--month <yyyy-mm>", "month to set", new Date().toISOString().slice(0, 7))
    .option("--db <path>", "SQLite database path")
    .option("--json", "print JSON")
    .action((category: string, amount: number, options: { month: string; db?: string; json?: boolean }) => {
      const result = withDb(options.db, (db) => {
        const proposalId = createAgentProposal(db, {
          kind: "budget",
          source: "cli",
          confidence: 1,
          reason: "Explicit CLI budget command.",
          payload: { categoryName: category, amount, month: options.month }
        });
        applyAgentProposal(db, proposalId, "cli");
        return { proposalId, applied: true };
      });
      print(result, options.json);
    });

  const recurrings = program.command("recurrings").description("Inspect or detect recurring charges.");
  recurrings
    .command("list")
    .option("--db <path>", "SQLite database path")
    .option("--json", "print JSON")
    .action((options: { db?: string; json?: boolean }) => {
      const result = withDb(options.db, (db) => getRecurrings(db));
      print(result, options.json);
    });
  recurrings
    .command("detect")
    .option("--db <path>", "SQLite database path")
    .option("--json", "print JSON")
    .action((options: { db?: string; json?: boolean }) => {
      const result = withDb(options.db, (db) => ({ proposalsCreated: runRecurringEnrichment(db, "cli.recurring-detector") }));
      print(result, options.json);
    });

  const proposals = program.command("proposals").description("Inspect or explicitly apply agent proposals.");
  proposals
    .command("list")
    .option("--status <status>", "pending, applied, or rejected", "pending")
    .option("--db <path>", "SQLite database path")
    .option("--json", "print JSON")
    .action((options: { status: string; db?: string; json?: boolean }) => {
      print(withDb(options.db, (db) => listAgentProposals(db, options.status)), options.json);
    });
  proposals
    .command("apply")
    .argument("<proposal-id>", "proposal id to apply")
    .option("--db <path>", "SQLite database path")
    .option("--json", "print JSON")
    .action((proposalId: string, options: { db?: string; json?: boolean }) => {
      const result = withDb(options.db, (db) => {
        applyAgentProposal(db, proposalId, "cli");
        return { applied: true, proposalId };
      });
      print(result, options.json);
    });

  const report = program.command("report").description("Read local finance reports.");
  report
    .command("dashboard")
    .option("--db <path>", "SQLite database path")
    .option("--json", "print JSON")
    .action((options: { db?: string; json?: boolean }) => {
      const result = withDb(options.db, (db) => getDashboard(db));
      print(result, options.json);
    });
  report
    .command("cash-flow")
    .option("--months <n>", "number of months", (value) => Number.parseInt(value, 10), 12)
    .option("--db <path>", "SQLite database path")
    .option("--json", "print JSON")
    .action((options: { months: number; db?: string; json?: boolean }) => {
      const result = withDb(options.db, (db) => getCashFlow(db, options.months));
      print(result, options.json);
    });
  report
    .command("accounts")
    .option("--db <path>", "SQLite database path")
    .option("--json", "print JSON")
    .action((options: { db?: string; json?: boolean }) => {
      print(withDb(options.db, (db) => getAccounts(db)), options.json);
    });
  report
    .command("investments")
    .option("--db <path>", "SQLite database path")
    .option("--json", "print JSON")
    .action((options: { db?: string; json?: boolean }) => {
      print(withDb(options.db, (db) => getInvestments(db)), options.json);
    });
  report
    .command("liabilities")
    .option("--db <path>", "SQLite database path")
    .option("--json", "print JSON")
    .action((options: { db?: string; json?: boolean }) => {
      print(withDb(options.db, (db) => getLiabilities(db)), options.json);
    });
  report
    .command("proposals")
    .option("--status <status>", "pending, applied, or rejected", "pending")
    .option("--db <path>", "SQLite database path")
    .option("--json", "print JSON")
    .action((options: { status: string; db?: string; json?: boolean }) => {
      print(withDb(options.db, (db) => listAgentProposals(db, options.status)), options.json);
    });

  const exportCommand = program.command("export").description("Export local data.");
  exportCommand
    .command("transactions")
    .option("-o, --output <path>", "CSV output path")
    .option("--db <path>", "SQLite database path")
    .option("--json", "print JSON")
    .action(async (options: { output?: string; db?: string; json?: boolean }) => {
      const rows = withDb(options.db, (db) => {
        const exportRows = exportTransactions(db);
        recordExport(db, "csv", exportRows.length);
        return exportRows;
      });
      const outputPath = path.resolve(process.cwd(), options.output ?? "argent-transactions.csv");
      await writeCsv(outputPath, rows);
      print({ outputPath, rows: rows.length }, options.json);
    });

  program
    .command("mcp")
    .description("Start Argent's stdio MCP server.")
    .action(async () => {
      await startMcpServer();
    });

  return program;
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : "";

if (currentFile === invokedFile) {
  buildProgram().parseAsync(process.argv).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
