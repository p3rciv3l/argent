import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PlaidApi } from "plaid";
import {
  applyTransactionChanges,
  getConnection,
  insertAuditLog,
  listConnections,
  normalizeTransaction,
  upsertAccounts,
  upsertConnection,
  type ConnectionRecord,
  type MockSyncFixture,
  type NormalizedTransaction,
  type PlaidTransactionLike,
  type RemovedTransactionLike,
  type SqliteDatabase
} from "@argent/core";
import type { PlaidConfig } from "./config.js";

interface FetchedChanges {
  cursor: string | null;
  added: PlaidTransactionLike[];
  modified: PlaidTransactionLike[];
  removed: RemovedTransactionLike[];
}

export interface SyncPlaidOptions {
  connectionId?: string;
  dryRun?: boolean;
  environment?: string;
  includeInvestments?: boolean;
  includeLiabilities?: boolean;
  refreshHealth?: boolean;
}

function isSyncMutationError(error: unknown): boolean {
  const maybeError = error as { response?: { data?: { error_code?: string } } };
  return maybeError.response?.data?.error_code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION";
}

export async function fetchTransactionChanges(client: PlaidApi, connection: ConnectionRecord): Promise<FetchedChanges> {
  if (!connection.accessToken) {
    throw new Error(`Plaid connection ${connection.connectionId} has no local access token.`);
  }
  const originalCursor = connection.cursor;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let cursor = originalCursor;
    let hasMore = true;
    const added: PlaidTransactionLike[] = [];
    const modified: PlaidTransactionLike[] = [];
    const removed: RemovedTransactionLike[] = [];
    try {
      while (hasMore) {
        const request = cursor
          ? {
              access_token: connection.accessToken,
              cursor,
              count: 500,
              options: { include_original_description: true }
            }
          : {
              access_token: connection.accessToken,
              count: 500,
              options: { include_original_description: true }
            };
        const response = await client.transactionsSync(request);
        const data = response.data as {
          added: PlaidTransactionLike[];
          modified: PlaidTransactionLike[];
          removed: RemovedTransactionLike[];
          next_cursor?: string | null;
          has_more?: boolean;
        };
        added.push(...data.added);
        modified.push(...data.modified);
        removed.push(...data.removed);
        cursor = data.next_cursor ?? null;
        hasMore = Boolean(data.has_more);
      }
      return { cursor, added, modified, removed };
    } catch (error) {
      if (attempt < 3 && isSyncMutationError(error)) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Unable to fetch Plaid transaction sync pages.");
}

function normalizeMany(
  transactions: PlaidTransactionLike[],
  connectionId: string,
  syncedAt: string,
  source: "plaid" | "mock"
): NormalizedTransaction[] {
  return transactions.map((transaction) => normalizeTransaction(transaction, connectionId, syncedAt, source));
}

export async function applyMockPlaidSyncFixture(
  db: SqliteDatabase,
  fixture: MockSyncFixture,
  dryRun = false
): Promise<{
  connectionId: string;
  added: number;
  modified: number;
  removed: number;
  cursor: string | null;
}> {
  const now = new Date().toISOString();
  const providerItemId = fixture.item?.item_id || "mock-item";
  const connectionId = `mock:${fixture.item?.environment ?? "sandbox"}:${providerItemId}`;
  const added = fixture.pages.flatMap((page) => page.added ?? []);
  const modified = fixture.pages.flatMap((page) => page.modified ?? []);
  const removed = fixture.pages.flatMap((page) => page.removed ?? []);
  const cursor = [...fixture.pages].reverse().find((page) => page.next_cursor !== undefined)?.next_cursor ?? null;

  if (!dryRun) {
    upsertConnection(
      db,
      {
        connectionId,
        provider: "mock",
        providerItemId,
        accessToken: fixture.item?.access_token || "mock-access-token",
        environment: fixture.item?.environment ?? "sandbox",
        institutionId: fixture.item?.institution_id ?? "mock-institution",
        institutionName: fixture.item?.institution_name ?? "Mock Credit Union",
        linkSessionId: fixture.item?.link_session_id ?? null,
        cursor: null
      },
      now
    );
    upsertAccounts(db, fixture.accounts ?? [], connectionId, now);
    applyTransactionChanges(db, {
      connectionId,
      provider: "mock",
      added: normalizeMany(added, connectionId, now, "mock"),
      modified: normalizeMany(modified, connectionId, now, "mock"),
      removed,
      cursor,
      syncedAt: now
    });
  }

  return { connectionId, added: added.length, modified: modified.length, removed: removed.length, cursor };
}

export async function loadMockPlaidFixture(filePath: string): Promise<MockSyncFixture> {
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content) as MockSyncFixture;
}

export function defaultMockFixturePath(): string {
  return path.resolve(import.meta.dirname, "../fixtures/mock-plaid-sync.json");
}

export async function syncPlaidTransactions(
  db: SqliteDatabase,
  client: PlaidApi,
  config: PlaidConfig,
  options: SyncPlaidOptions = {}
): Promise<
  Array<{
    connectionId: string;
    added: number;
    modified: number;
    removed: number;
    holdings?: number;
    investmentTransactions?: number;
    liabilities?: number;
    skipped?: string;
    warnings?: string[];
  }>
> {
  const connections = listConnections(db).filter((connection) => connection.provider === "plaid");
  const selected = options.connectionId
    ? connections.filter((connection) => connection.connectionId === options.connectionId)
    : connections;
  if (selected.length === 0) {
    throw new Error(options.connectionId ? `No Plaid connection found for ${options.connectionId}.` : "No Plaid connections found. Run link first.");
  }

  const results: Array<{
    connectionId: string;
    added: number;
    modified: number;
    removed: number;
    holdings?: number;
    investmentTransactions?: number;
    liabilities?: number;
    skipped?: string;
    warnings?: string[];
  }> = [];
  for (const connection of selected) {
    if (connection.environment && connection.environment !== config.env) {
      results.push({
        connectionId: connection.connectionId,
        added: 0,
        modified: 0,
        removed: 0,
        skipped: `stored for Plaid ${connection.environment}, current PLAID_ENV is ${config.env}`
      });
      continue;
    }
    const syncedAt = new Date().toISOString();
    const warnings: string[] = [];
    if (!options.dryRun && options.refreshHealth !== false) {
      try {
        await refreshPlaidItemHealth(db, client, connection, syncedAt);
      } catch (error) {
        warnings.push(`Item health refresh skipped: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const changes = await fetchTransactionChanges(client, connection);
    let holdings = 0;
    let investmentTransactions = 0;
    let liabilities = 0;
    if (!options.dryRun) {
      applyTransactionChanges(db, {
        connectionId: connection.connectionId,
        provider: "plaid",
        added: normalizeMany(changes.added, connection.connectionId, syncedAt, "plaid"),
        modified: normalizeMany(changes.modified, connection.connectionId, syncedAt, "plaid"),
        removed: changes.removed,
        cursor: changes.cursor,
        syncedAt
      });
      if (connection.accessToken) {
        const balances = await client.accountsBalanceGet({ access_token: connection.accessToken });
        upsertAccounts(db, balances.data.accounts, connection.connectionId, syncedAt);
      }
      if (options.includeInvestments !== false) {
        try {
          const investments = await syncPlaidInvestments(db, client, connection, syncedAt);
          holdings = investments.holdings;
          investmentTransactions = investments.transactions;
        } catch (error) {
          warnings.push(`Investments sync skipped: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (options.includeLiabilities !== false) {
        try {
          liabilities = (await syncPlaidLiabilities(db, client, connection, syncedAt)).liabilities;
        } catch (error) {
          warnings.push(`Liabilities sync skipped: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    results.push({
      connectionId: connection.connectionId,
      added: changes.added.length,
      modified: changes.modified.length,
      removed: changes.removed.length,
      holdings,
      investmentTransactions,
      liabilities,
      ...(warnings.length > 0 ? { warnings } : {})
    });
  }
  return results;
}

export async function refreshPlaidItemHealth(
  db: SqliteDatabase,
  client: PlaidApi,
  connection: ConnectionRecord,
  checkedAt = new Date().toISOString()
): Promise<{ status: string; consentExpirationAt: string | null; errorCode: string | null }> {
  if (!connection.accessToken) {
    throw new Error(`Plaid connection ${connection.connectionId} has no local access token.`);
  }
  const response = await client.itemGet({ access_token: connection.accessToken });
  const item = response.data.item as {
    error?: { error_code?: string; error_message?: string } | null;
    consent_expiration_time?: string | null;
  };
  const errorCode = item.error?.error_code ?? null;
  const status = errorCode ? "attention" : "healthy";
  const consentExpirationAt = item.consent_expiration_time ?? null;
  db.prepare(`
    UPDATE connections
    SET status = @status,
        consent_expiration_at = @consentExpirationAt,
        updated_at = @checkedAt
    WHERE connection_id = @connectionId
  `).run({
    status,
    consentExpirationAt,
    checkedAt,
    connectionId: connection.connectionId
  });
  insertAuditLog(db, {
    actor: "plaid",
    action: "connection.health",
    targetType: "connection",
    targetId: connection.connectionId,
    metadata: { status, errorCode, consentExpirationAt },
    createdAt: checkedAt
  });
  return { status, consentExpirationAt, errorCode };
}

export async function disconnectPlaidConnection(
  db: SqliteDatabase,
  client: Pick<PlaidApi, "itemRemove">,
  connectionId: string,
  options: { localOnly?: boolean; actor?: string; disconnectedAt?: string } = {}
): Promise<{ connectionId: string; removedRemote: boolean; removedLocal: boolean }> {
  const connection = getConnection(db, connectionId);
  if (!connection) {
    throw new Error(`No Plaid connection found for ${connectionId}.`);
  }
  if (connection.provider !== "plaid") {
    throw new Error(`Connection ${connectionId} is ${connection.provider}, not plaid.`);
  }
  let removedRemote = false;
  if (!options.localOnly && connection.accessToken) {
    await client.itemRemove({ access_token: connection.accessToken });
    removedRemote = true;
  }
  const disconnectedAt = options.disconnectedAt ?? new Date().toISOString();
  const result = db.prepare("DELETE FROM connections WHERE connection_id = ?").run(connectionId);
  const removedLocal = result.changes > 0;
  insertAuditLog(db, {
    actor: options.actor ?? "plaid",
    action: "connection.disconnect",
    targetType: "connection",
    targetId: connectionId,
    metadata: { localOnly: Boolean(options.localOnly), removedRemote, removedLocal },
    createdAt: disconnectedAt
  });
  return { connectionId, removedRemote, removedLocal };
}

function stringifyProviderPayload(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function dateYearsBefore(dateText: string, years: number): string {
  const date = new Date(dateText);
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date.toISOString().slice(0, 10);
}

export async function syncPlaidInvestments(
  db: SqliteDatabase,
  client: PlaidApi,
  connection: ConnectionRecord,
  syncedAt = new Date().toISOString()
): Promise<{ holdings: number; transactions: number }> {
  if (!connection.accessToken) {
    throw new Error(`Plaid connection ${connection.connectionId} has no local access token.`);
  }
  const response = await client.investmentsHoldingsGet({ access_token: connection.accessToken });
  const data = response.data as unknown as {
    securities?: Array<Record<string, unknown>>;
    holdings?: Array<Record<string, unknown>>;
  };
  const endDate = syncedAt.slice(0, 10);
  const startDate = dateYearsBefore(syncedAt, 2);
  const transactionsResponse = await client.investmentsTransactionsGet({
    access_token: connection.accessToken,
    start_date: startDate,
    end_date: endDate,
    options: {
      count: 500,
      offset: 0
    }
  });
  const investmentTransactions = (transactionsResponse.data as unknown as {
    investment_transactions?: Array<Record<string, unknown>>;
  }).investment_transactions ?? [];
  const upsertSecurity = db.prepare(`
    INSERT INTO securities (
      security_id, name, ticker_symbol, type, close_price, close_price_as_of,
      iso_currency_code, raw_provider_payload, updated_at
    )
    VALUES (
      @securityId, @name, @tickerSymbol, @type, @closePrice, @closePriceAsOf,
      @isoCurrencyCode, @rawProviderPayload, @updatedAt
    )
    ON CONFLICT(security_id) DO UPDATE SET
      name = excluded.name,
      ticker_symbol = excluded.ticker_symbol,
      type = excluded.type,
      close_price = excluded.close_price,
      close_price_as_of = excluded.close_price_as_of,
      iso_currency_code = excluded.iso_currency_code,
      raw_provider_payload = excluded.raw_provider_payload,
      updated_at = excluded.updated_at
  `);
  const upsertHolding = db.prepare(`
    INSERT INTO holdings (
      holding_id, account_id, security_id, quantity, institution_value,
      institution_price, cost_basis, iso_currency_code, as_of, raw_provider_payload
    )
    VALUES (
      @holdingId, @accountId, @securityId, @quantity, @institutionValue,
      @institutionPrice, @costBasis, @isoCurrencyCode, @asOf, @rawProviderPayload
    )
    ON CONFLICT(account_id, security_id) DO UPDATE SET
      quantity = excluded.quantity,
      institution_value = excluded.institution_value,
      institution_price = excluded.institution_price,
      cost_basis = excluded.cost_basis,
      iso_currency_code = excluded.iso_currency_code,
      as_of = excluded.as_of,
      raw_provider_payload = excluded.raw_provider_payload
  `);
  const upsertInvestmentTransaction = db.prepare(`
    INSERT INTO investment_transactions (
      investment_transaction_id, account_id, security_id, date, name, type,
      subtype, quantity, amount, price, fees, iso_currency_code,
      raw_provider_payload, updated_at
    )
    VALUES (
      @investmentTransactionId, @accountId, @securityId, @date, @name, @type,
      @subtype, @quantity, @amount, @price, @fees, @isoCurrencyCode,
      @rawProviderPayload, @updatedAt
    )
    ON CONFLICT(investment_transaction_id) DO UPDATE SET
      account_id = excluded.account_id,
      security_id = excluded.security_id,
      date = excluded.date,
      name = excluded.name,
      type = excluded.type,
      subtype = excluded.subtype,
      quantity = excluded.quantity,
      amount = excluded.amount,
      price = excluded.price,
      fees = excluded.fees,
      iso_currency_code = excluded.iso_currency_code,
      raw_provider_payload = excluded.raw_provider_payload,
      updated_at = excluded.updated_at
  `);
  const write = db.transaction(() => {
    for (const security of data.securities ?? []) {
      upsertSecurity.run({
        securityId: String(security.security_id),
        name: security.name ?? null,
        tickerSymbol: security.ticker_symbol ?? null,
        type: security.type ?? null,
        closePrice: security.close_price ?? null,
        closePriceAsOf: security.close_price_as_of ?? null,
        isoCurrencyCode: security.iso_currency_code ?? null,
        rawProviderPayload: stringifyProviderPayload(security),
        updatedAt: syncedAt
      });
    }
    for (const holding of data.holdings ?? []) {
      const accountId = String(holding.account_id);
      const securityId = String(holding.security_id);
      upsertHolding.run({
        holdingId: `${accountId}:${securityId}`,
        accountId,
        securityId,
        quantity: holding.quantity ?? 0,
        institutionValue: holding.institution_value ?? null,
        institutionPrice: holding.institution_price ?? null,
        costBasis: holding.cost_basis ?? null,
        isoCurrencyCode: holding.iso_currency_code ?? null,
        asOf: syncedAt,
        rawProviderPayload: stringifyProviderPayload(holding)
      });
    }
    for (const transaction of investmentTransactions) {
      upsertInvestmentTransaction.run({
        investmentTransactionId: String(transaction.investment_transaction_id),
        accountId: String(transaction.account_id),
        securityId: transaction.security_id ? String(transaction.security_id) : null,
        date: transaction.date ?? endDate,
        name: transaction.name ?? null,
        type: transaction.type ?? null,
        subtype: transaction.subtype ?? null,
        quantity: transaction.quantity ?? null,
        amount: transaction.amount ?? null,
        price: transaction.price ?? null,
        fees: transaction.fees ?? null,
        isoCurrencyCode: transaction.iso_currency_code ?? null,
        rawProviderPayload: stringifyProviderPayload(transaction),
        updatedAt: syncedAt
      });
    }
  });
  write();
  return { holdings: data.holdings?.length ?? 0, transactions: investmentTransactions.length };
}

export async function syncPlaidLiabilities(
  db: SqliteDatabase,
  client: PlaidApi,
  connection: ConnectionRecord,
  syncedAt = new Date().toISOString()
): Promise<{ liabilities: number }> {
  if (!connection.accessToken) {
    throw new Error(`Plaid connection ${connection.connectionId} has no local access token.`);
  }
  const response = await client.liabilitiesGet({ access_token: connection.accessToken });
  const liabilities = response.data.liabilities as unknown as {
    credit?: Array<Record<string, unknown>>;
    mortgage?: Array<Record<string, unknown>>;
    student?: Array<Record<string, unknown>>;
  };
  const allLiabilities: Array<Record<string, unknown> & { liabilityType: string }> = [
    ...(liabilities.credit ?? []).map((row) => ({ ...row, liabilityType: "credit" })),
    ...(liabilities.mortgage ?? []).map((row) => ({ ...row, liabilityType: "mortgage" })),
    ...(liabilities.student ?? []).map((row) => ({ ...row, liabilityType: "student" }))
  ];
  const upsert = db.prepare(`
    INSERT INTO liabilities (
      liability_id, account_id, type, apr, balance, credit_limit,
      minimum_payment_amount, next_payment_due_date, last_payment_amount,
      last_payment_date, raw_provider_payload, updated_at
    )
    VALUES (
      @liabilityId, @accountId, @type, @apr, @balance, @creditLimit,
      @minimumPaymentAmount, @nextPaymentDueDate, @lastPaymentAmount,
      @lastPaymentDate, @rawProviderPayload, @updatedAt
    )
    ON CONFLICT(liability_id) DO UPDATE SET
      apr = excluded.apr,
      balance = excluded.balance,
      credit_limit = excluded.credit_limit,
      minimum_payment_amount = excluded.minimum_payment_amount,
      next_payment_due_date = excluded.next_payment_due_date,
      last_payment_amount = excluded.last_payment_amount,
      last_payment_date = excluded.last_payment_date,
      raw_provider_payload = excluded.raw_provider_payload,
      updated_at = excluded.updated_at
  `);
  const write = db.transaction(() => {
    for (const liability of allLiabilities) {
      const accountId = String(liability.account_id);
      upsert.run({
        liabilityId: `${accountId}:${String(liability.liabilityType)}`,
        accountId,
        type: liability.liabilityType,
        apr: liability.aprs ? null : liability.apr ?? null,
        balance: liability.balance ?? liability.last_statement_balance ?? null,
        creditLimit: liability.credit_limit ?? null,
        minimumPaymentAmount: liability.minimum_payment_amount ?? null,
        nextPaymentDueDate: liability.next_payment_due_date ?? null,
        lastPaymentAmount: liability.last_payment_amount ?? null,
        lastPaymentDate: liability.last_payment_date ?? null,
        rawProviderPayload: stringifyProviderPayload(liability),
        updatedAt: syncedAt
      });
    }
  });
  write();
  return { liabilities: allLiabilities.length };
}

export function createFailedSyncRun(
  db: SqliteDatabase,
  provider: "plaid",
  connectionId: string | null,
  error: unknown,
  startedAt = new Date().toISOString()
): void {
  db.prepare(`
    INSERT INTO sync_runs (
      sync_run_id, provider, connection_id, status, started_at, completed_at, error_message
    )
    VALUES (@syncRunId, @provider, @connectionId, 'failed', @startedAt, @completedAt, @errorMessage)
  `).run({
    syncRunId: randomUUID(),
    provider,
    connectionId,
    startedAt,
    completedAt: new Date().toISOString(),
    errorMessage: error instanceof Error ? error.message : String(error)
  });
}
