import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { ensureArgentPaths, getArgentPaths } from "./config.js";
import { migrate, type SqliteDatabase } from "./migrations.js";
import { normalizeAccount } from "./normalize.js";
import type {
  AccountLike,
  AccountRecord,
  AssetValuationInput,
  ConnectionRecord,
  ExportRow,
  ExternalAssetInput,
  MerchantOrderInput,
  NormalizedTransaction,
  ProviderName,
  SyncChanges,
  TransactionOrderMatchInput
} from "./types.js";

export type { SqliteDatabase } from "./migrations.js";

export interface UpsertConnectionInput {
  connectionId?: string;
  provider: ProviderName;
  providerItemId: string;
  accessToken?: string | null;
  connectorId?: string | null;
  displayName?: string | null;
  environment?: string | null;
  institutionId?: string | null;
  institutionName?: string | null;
  linkSessionId?: string | null;
  cursor?: string | null;
  status?: string;
  consentExpirationAt?: string | null;
  setupState?: unknown;
  setupStateJson?: string | null;
  lastSyncAt?: string | null;
  lastSyncStatus?: string | null;
  lastSyncError?: string | null;
}

export interface AuditInput {
  actor: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: unknown;
  createdAt?: string;
}

export interface SyncRunInput {
  provider: ProviderName;
  connectionId?: string | null;
  status: string;
  startedAt?: string;
  completedAt?: string | null;
  addedCount?: number;
  modifiedCount?: number;
  removedCount?: number;
  errorMessage?: string | null;
}

export function openDatabase(databasePath = getArgentPaths().databasePath): SqliteDatabase {
  if (databasePath !== ":memory:") {
    ensureArgentPaths({
      ...getArgentPaths(),
      databasePath
    });
  }

  const db = new Database(databasePath);
  if (databasePath !== ":memory:") {
    db.pragma("journal_mode = WAL");
  }
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export function withDatabase<T>(databasePath: string | undefined, fn: (db: SqliteDatabase) => T): T {
  const db = openDatabase(databasePath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function connectionIdFor(input: UpsertConnectionInput): string {
  return input.connectionId ?? `${input.provider}:${input.environment ?? "default"}:${input.providerItemId}`;
}

export function upsertConnection(
  db: SqliteDatabase,
  input: UpsertConnectionInput,
  now = new Date().toISOString()
): string {
  const connectionId = connectionIdFor(input);
  db.prepare(`
    INSERT INTO connections (
      connection_id, provider, provider_item_id, access_token, connector_id,
      display_name, environment, institution_id, institution_name, link_session_id,
      cursor, status, consent_expiration_at, setup_state_json, last_sync_at,
      last_sync_status, last_sync_error, created_at, updated_at
    )
    VALUES (
      @connectionId, @provider, @providerItemId, @accessToken, @connectorId,
      @displayName, @environment, @institutionId, @institutionName, @linkSessionId,
      @cursor, @status, @consentExpirationAt, @setupStateJson, @lastSyncAt,
      @lastSyncStatus, @lastSyncError, @now, @now
    )
    ON CONFLICT(connection_id) DO UPDATE SET
      access_token = COALESCE(excluded.access_token, connections.access_token),
      connector_id = COALESCE(excluded.connector_id, connections.connector_id),
      display_name = COALESCE(excluded.display_name, connections.display_name),
      environment = COALESCE(excluded.environment, connections.environment),
      institution_id = excluded.institution_id,
      institution_name = excluded.institution_name,
      link_session_id = COALESCE(excluded.link_session_id, connections.link_session_id),
      cursor = COALESCE(excluded.cursor, connections.cursor),
      status = excluded.status,
      consent_expiration_at = excluded.consent_expiration_at,
      setup_state_json = COALESCE(excluded.setup_state_json, connections.setup_state_json),
      last_sync_at = COALESCE(excluded.last_sync_at, connections.last_sync_at),
      last_sync_status = COALESCE(excluded.last_sync_status, connections.last_sync_status),
      last_sync_error = excluded.last_sync_error,
      updated_at = excluded.updated_at
  `).run({
    connectionId,
    provider: input.provider,
    providerItemId: input.providerItemId,
    accessToken: input.accessToken ?? null,
    connectorId: input.connectorId ?? null,
    displayName: input.displayName ?? null,
    environment: input.environment ?? null,
    institutionId: input.institutionId ?? null,
    institutionName: input.institutionName ?? null,
    linkSessionId: input.linkSessionId ?? null,
    cursor: input.cursor ?? null,
    status: input.status ?? "healthy",
    consentExpirationAt: input.consentExpirationAt ?? null,
    setupStateJson:
      input.setupStateJson ??
      (input.setupState === undefined ? null : JSON.stringify(input.setupState)),
    lastSyncAt: input.lastSyncAt ?? null,
    lastSyncStatus: input.lastSyncStatus ?? null,
    lastSyncError: input.lastSyncError ?? null,
    now
  });
  return connectionId;
}

export function listConnections(db: SqliteDatabase): ConnectionRecord[] {
  return db
    .prepare(
      `
      SELECT
        connection_id AS connectionId,
        provider,
        provider_item_id AS providerItemId,
        access_token AS accessToken,
        connector_id AS connectorId,
        display_name AS displayName,
        environment,
        institution_id AS institutionId,
        institution_name AS institutionName,
        link_session_id AS linkSessionId,
        cursor,
        status,
        consent_expiration_at AS consentExpirationAt,
        setup_state_json AS setupStateJson,
        last_sync_at AS lastSyncAt,
        last_sync_status AS lastSyncStatus,
        last_sync_error AS lastSyncError,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM connections
      ORDER BY created_at ASC
    `
    )
    .all() as ConnectionRecord[];
}

export function getConnection(db: SqliteDatabase, connectionId: string): ConnectionRecord | null {
  const row = db
    .prepare(
      `
      SELECT
        connection_id AS connectionId,
        provider,
        provider_item_id AS providerItemId,
        access_token AS accessToken,
        connector_id AS connectorId,
        display_name AS displayName,
        environment,
        institution_id AS institutionId,
        institution_name AS institutionName,
        link_session_id AS linkSessionId,
        cursor,
        status,
        consent_expiration_at AS consentExpirationAt,
        setup_state_json AS setupStateJson,
        last_sync_at AS lastSyncAt,
        last_sync_status AS lastSyncStatus,
        last_sync_error AS lastSyncError,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM connections
      WHERE connection_id = ?
    `
    )
    .get(connectionId) as ConnectionRecord | undefined;
  return row ?? null;
}

export function saveConnectionCursor(
  db: SqliteDatabase,
  connectionId: string,
  cursor: string | null,
  now = new Date().toISOString()
): void {
  db.prepare("UPDATE connections SET cursor = ?, updated_at = ? WHERE connection_id = ?").run(cursor, now, connectionId);
}

export function updateConnectionSyncState(
  db: SqliteDatabase,
  connectionId: string,
  input: { status: string; syncedAt?: string | null; errorMessage?: string | null }
): void {
  const syncedAt = input.syncedAt ?? new Date().toISOString();
  db.prepare(`
    UPDATE connections
    SET last_sync_at = @syncedAt,
        last_sync_status = @status,
        last_sync_error = @errorMessage,
        updated_at = @syncedAt
    WHERE connection_id = @connectionId
  `).run({
    connectionId,
    syncedAt,
    status: input.status,
    errorMessage: input.errorMessage ?? null
  });
}

function normalizedFingerprintPart(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function accountFingerprint(account: AccountLike): string {
  const label = normalizedFingerprintPart(account.official_name) || normalizedFingerprintPart(account.name);
  return [
    normalizedFingerprintPart(account.type),
    normalizedFingerprintPart(account.subtype),
    normalizedFingerprintPart(account.mask),
    label
  ].join("|");
}

function accountFingerprintSet(accounts: AccountLike[]): string[] {
  return accounts.map(accountFingerprint).sort();
}

function sameFingerprintSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function findDuplicateConnection(
  db: SqliteDatabase,
  candidate: {
    accounts: AccountLike[];
    institutionId?: string | null;
    provider?: ProviderName;
    environment?: string | null;
    excludingConnectionId?: string | null;
  }
): ConnectionRecord | null {
  const candidateFingerprints = accountFingerprintSet(candidate.accounts);
  if (candidateFingerprints.length === 0) {
    return null;
  }

  const rows = db
    .prepare(
      `
      SELECT
        c.connection_id AS connectionId,
        c.provider,
        c.provider_item_id AS providerItemId,
        c.access_token AS accessToken,
        c.environment,
        c.institution_id AS institutionId,
        c.institution_name AS institutionName,
        c.link_session_id AS linkSessionId,
        c.cursor,
        c.status,
        c.consent_expiration_at AS consentExpirationAt,
        c.created_at AS createdAt,
        c.updated_at AS updatedAt,
        a.account_id,
        a.name,
        a.official_name,
        a.type,
        a.subtype,
        a.mask
      FROM connections c
      JOIN accounts a ON a.connection_id = c.connection_id
      WHERE (@excludingConnectionId IS NULL OR c.connection_id != @excludingConnectionId)
        AND (@provider IS NULL OR c.provider = @provider)
        AND (@environment IS NULL OR c.environment IS NULL OR c.environment = @environment)
        AND (@institutionId IS NULL OR c.institution_id IS NULL OR c.institution_id = @institutionId)
      ORDER BY c.created_at ASC, c.connection_id ASC, a.account_id ASC
    `
    )
    .all({
      excludingConnectionId: candidate.excludingConnectionId ?? null,
      provider: candidate.provider ?? null,
      environment: candidate.environment ?? null,
      institutionId: candidate.institutionId ?? null
    }) as Array<
    ConnectionRecord & {
      account_id: string;
      name: string | null;
      official_name: string | null;
      type: string | null;
      subtype: string | null;
      mask: string | null;
    }
  >;

  const byConnection = new Map<string, { connection: ConnectionRecord; accounts: AccountLike[] }>();
  for (const row of rows) {
    const existing = byConnection.get(row.connectionId);
    const connection = existing?.connection ?? {
      connectionId: row.connectionId,
      provider: row.provider,
      providerItemId: row.providerItemId,
      accessToken: row.accessToken,
      environment: row.environment,
      institutionId: row.institutionId,
      institutionName: row.institutionName,
      linkSessionId: row.linkSessionId,
      cursor: row.cursor,
      status: row.status,
      consentExpirationAt: row.consentExpirationAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
    const accounts = existing?.accounts ?? [];
    accounts.push({
      account_id: row.account_id,
      name: row.name,
      official_name: row.official_name,
      type: row.type,
      subtype: row.subtype,
      mask: row.mask
    });
    byConnection.set(row.connectionId, { connection, accounts });
  }

  for (const { connection, accounts } of byConnection.values()) {
    if (sameFingerprintSet(candidateFingerprints, accountFingerprintSet(accounts))) {
      return connection;
    }
  }

  return null;
}

export function upsertAccounts(
  db: SqliteDatabase,
  accounts: AccountLike[],
  connectionId: string,
  syncedAt = new Date().toISOString()
): void {
  const records = accounts.map((account) => normalizeAccount(account, connectionId, syncedAt));
  const upsertAccount = db.prepare(`
    INSERT INTO accounts (
      account_id, connection_id, name, official_name, type, subtype, mask,
      iso_currency_code, unofficial_currency_code, balance_available,
      balance_current, balance_limit, balance_as_of, hidden_at, closed_at,
      excluded_at, updated_at
    )
    VALUES (
      @accountId, @connectionId, @name, @officialName, @type, @subtype, @mask,
      @isoCurrencyCode, @unofficialCurrencyCode, @balanceAvailable,
      @balanceCurrent, @balanceLimit, @balanceAsOf, @hiddenAt, @closedAt,
      @excludedAt, @updatedAt
    )
    ON CONFLICT(account_id) DO UPDATE SET
      connection_id = excluded.connection_id,
      name = excluded.name,
      official_name = excluded.official_name,
      type = excluded.type,
      subtype = excluded.subtype,
      mask = excluded.mask,
      iso_currency_code = excluded.iso_currency_code,
      unofficial_currency_code = excluded.unofficial_currency_code,
      balance_available = excluded.balance_available,
      balance_current = excluded.balance_current,
      balance_limit = excluded.balance_limit,
      balance_as_of = excluded.balance_as_of,
      updated_at = excluded.updated_at
  `);
  const insertBalance = db.prepare(`
    INSERT INTO balances (account_id, available, current, limit_amount, iso_currency_code, captured_at)
    VALUES (@accountId, @balanceAvailable, @balanceCurrent, @balanceLimit, @isoCurrencyCode, @balanceAsOf)
  `);

  const write = db.transaction((accountRecords: AccountRecord[]) => {
    for (const record of accountRecords) {
      upsertAccount.run(record);
      if (
        record.balanceAvailable !== null ||
        record.balanceCurrent !== null ||
        record.balanceLimit !== null
      ) {
        insertBalance.run(record);
      }
    }
  });
  write(records);
}

function upsertTransactionStatement(db: SqliteDatabase): Database.Statement {
  return db.prepare(`
    INSERT INTO transactions (
      transaction_id, connection_id, account_id, date, authorized_date,
      name, merchant_name, amount, direction, transaction_type,
      iso_currency_code, provider_category_primary, provider_category_detailed,
      category_confidence, payment_channel, location_address, location_city,
      location_region, location_postal_code, location_country, lat, lon, source,
      raw_provider_payload, enrichment_state, removed_at, last_synced_at, updated_at
    )
    VALUES (
      @transactionId, @connectionId, @accountId, @date, @authorizedDate,
      @name, @merchantName, @amount, @direction, @transactionType,
      @isoCurrencyCode, @providerCategoryPrimary, @providerCategoryDetailed,
      @categoryConfidence, @paymentChannel, @locationAddress, @locationCity,
      @locationRegion, @locationPostalCode, @locationCountry, @lat, @lon, @source,
      @rawProviderPayload, @enrichmentState, NULL, @lastSyncedAt, @updatedAt
    )
    ON CONFLICT(transaction_id) DO UPDATE SET
      connection_id = excluded.connection_id,
      account_id = excluded.account_id,
      date = excluded.date,
      authorized_date = excluded.authorized_date,
      name = excluded.name,
      merchant_name = excluded.merchant_name,
      amount = excluded.amount,
      direction = excluded.direction,
      iso_currency_code = excluded.iso_currency_code,
      provider_category_primary = excluded.provider_category_primary,
      provider_category_detailed = excluded.provider_category_detailed,
      category_confidence = excluded.category_confidence,
      payment_channel = excluded.payment_channel,
      location_address = excluded.location_address,
      location_city = excluded.location_city,
      location_region = excluded.location_region,
      location_postal_code = excluded.location_postal_code,
      location_country = excluded.location_country,
      lat = excluded.lat,
      lon = excluded.lon,
      source = excluded.source,
      raw_provider_payload = excluded.raw_provider_payload,
      enrichment_state = COALESCE(transactions.enrichment_state, excluded.enrichment_state),
      removed_at = NULL,
      last_synced_at = excluded.last_synced_at,
      updated_at = excluded.updated_at
  `);
}

export function applyTransactionChanges(db: SqliteDatabase, changes: SyncChanges): void {
  const syncRunId = randomUUID();
  const upsert = upsertTransactionStatement(db);
  const markRemoved = db.prepare(`
    UPDATE transactions
    SET removed_at = @removedAt, updated_at = @removedAt
    WHERE transaction_id = @transactionId
  `);

  const write = db.transaction(() => {
    db.prepare(`
      INSERT INTO sync_runs (
        sync_run_id, provider, connection_id, status, started_at, completed_at,
        added_count, modified_count, removed_count
      )
      VALUES (@syncRunId, @provider, @connectionId, 'succeeded', @syncedAt, @syncedAt, @added, @modified, @removed)
    `).run({
      syncRunId,
      provider: changes.provider,
      connectionId: changes.connectionId,
      syncedAt: changes.syncedAt,
      added: changes.added.length,
      modified: changes.modified.length,
      removed: changes.removed.length
    });

    for (const transaction of [...changes.added, ...changes.modified]) {
      upsert.run(transaction);
    }

    for (const transaction of changes.removed) {
      markRemoved.run({
        transactionId: transaction.transaction_id,
        removedAt: changes.syncedAt
      });
    }

    saveConnectionCursor(db, changes.connectionId, changes.cursor, changes.syncedAt);
    updateConnectionSyncState(db, changes.connectionId, {
      status: "succeeded",
      syncedAt: changes.syncedAt
    });
  });

  write();
}

export function recordSyncRun(db: SqliteDatabase, input: SyncRunInput): string {
  const syncRunId = randomUUID();
  const startedAt = input.startedAt ?? new Date().toISOString();
  db.prepare(`
    INSERT INTO sync_runs (
      sync_run_id, provider, connection_id, status, started_at, completed_at,
      added_count, modified_count, removed_count, error_message
    )
    VALUES (
      @syncRunId, @provider, @connectionId, @status, @startedAt, @completedAt,
      @addedCount, @modifiedCount, @removedCount, @errorMessage
    )
  `).run({
    syncRunId,
    provider: input.provider,
    connectionId: input.connectionId ?? null,
    status: input.status,
    startedAt,
    completedAt: input.completedAt ?? null,
    addedCount: input.addedCount ?? 0,
    modifiedCount: input.modifiedCount ?? 0,
    removedCount: input.removedCount ?? 0,
    errorMessage: input.errorMessage ?? null
  });
  return syncRunId;
}

export function upsertMerchantOrders(
  db: SqliteDatabase,
  orders: MerchantOrderInput[],
  now = new Date().toISOString()
): { orders: number; items: number } {
  const upsertOrder = db.prepare(`
    INSERT INTO merchant_orders (
      order_id, connection_id, provider_order_id, merchant_name, order_date,
      total_amount, currency, status, raw_provider_payload, created_at, updated_at
    )
    VALUES (
      @orderId, @connectionId, @providerOrderId, @merchantName, @orderDate,
      @totalAmount, @currency, @status, @rawProviderPayload, @now, @now
    )
    ON CONFLICT(order_id) DO UPDATE SET
      connection_id = excluded.connection_id,
      provider_order_id = excluded.provider_order_id,
      merchant_name = excluded.merchant_name,
      order_date = excluded.order_date,
      total_amount = excluded.total_amount,
      currency = excluded.currency,
      status = excluded.status,
      raw_provider_payload = excluded.raw_provider_payload,
      updated_at = excluded.updated_at
  `);
  const deleteItems = db.prepare("DELETE FROM merchant_order_items WHERE order_id = ?");
  const insertItem = db.prepare(`
    INSERT INTO merchant_order_items (
      order_item_id, order_id, name, quantity, unit_price, total_price,
      category, raw_provider_payload
    )
    VALUES (
      @orderItemId, @orderId, @name, @quantity, @unitPrice, @totalPrice,
      @category, @rawProviderPayload
    )
    ON CONFLICT(order_item_id) DO UPDATE SET
      order_id = excluded.order_id,
      name = excluded.name,
      quantity = excluded.quantity,
      unit_price = excluded.unit_price,
      total_price = excluded.total_price,
      category = excluded.category,
      raw_provider_payload = excluded.raw_provider_payload
  `);

  let itemCount = 0;
  const write = db.transaction(() => {
    for (const order of orders) {
      upsertOrder.run({
        orderId: order.orderId,
        connectionId: order.connectionId,
        providerOrderId: order.providerOrderId,
        merchantName: order.merchantName,
        orderDate: order.orderDate,
        totalAmount: order.totalAmount,
        currency: order.currency ?? null,
        status: order.status ?? null,
        rawProviderPayload: JSON.stringify(order.rawProviderPayload ?? {}),
        now
      });
      deleteItems.run(order.orderId);
      for (const item of order.items ?? []) {
        insertItem.run({
          orderItemId: item.orderItemId,
          orderId: order.orderId,
          name: item.name,
          quantity: item.quantity ?? null,
          unitPrice: item.unitPrice ?? null,
          totalPrice: item.totalPrice ?? null,
          category: item.category ?? null,
          rawProviderPayload: JSON.stringify(item.rawProviderPayload ?? {})
        });
        itemCount += 1;
      }
    }
  });
  write();
  return { orders: orders.length, items: itemCount };
}

export function upsertExternalAssets(
  db: SqliteDatabase,
  assets: ExternalAssetInput[],
  now = new Date().toISOString()
): number {
  const upsert = db.prepare(`
    INSERT INTO external_assets (
      asset_id, connection_id, provider_asset_id, asset_type, name, symbol,
      quantity, currency, address, metadata_json, created_at, updated_at
    )
    VALUES (
      @assetId, @connectionId, @providerAssetId, @assetType, @name, @symbol,
      @quantity, @currency, @address, @metadataJson, @now, @now
    )
    ON CONFLICT(asset_id) DO UPDATE SET
      connection_id = excluded.connection_id,
      provider_asset_id = excluded.provider_asset_id,
      asset_type = excluded.asset_type,
      name = excluded.name,
      symbol = excluded.symbol,
      quantity = excluded.quantity,
      currency = excluded.currency,
      address = excluded.address,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `);
  const write = db.transaction(() => {
    for (const asset of assets) {
      upsert.run({
        assetId: asset.assetId,
        connectionId: asset.connectionId,
        providerAssetId: asset.providerAssetId,
        assetType: asset.assetType,
        name: asset.name,
        symbol: asset.symbol ?? null,
        quantity: asset.quantity ?? null,
        currency: asset.currency ?? null,
        address: asset.address ?? null,
        metadataJson: JSON.stringify(asset.metadata ?? {}),
        now
      });
    }
  });
  write();
  return assets.length;
}

export function upsertAssetValuations(
  db: SqliteDatabase,
  valuations: AssetValuationInput[]
): number {
  const upsert = db.prepare(`
    INSERT INTO asset_valuations (
      valuation_id, asset_id, value_amount, currency, as_of, source,
      low_estimate, mid_estimate, high_estimate, raw_provider_payload
    )
    VALUES (
      @valuationId, @assetId, @valueAmount, @currency, @asOf, @source,
      @lowEstimate, @midEstimate, @highEstimate, @rawProviderPayload
    )
    ON CONFLICT(asset_id, as_of, source) DO UPDATE SET
      value_amount = excluded.value_amount,
      currency = excluded.currency,
      low_estimate = excluded.low_estimate,
      mid_estimate = excluded.mid_estimate,
      high_estimate = excluded.high_estimate,
      raw_provider_payload = excluded.raw_provider_payload
  `);
  const write = db.transaction(() => {
    for (const valuation of valuations) {
      upsert.run({
        valuationId: valuation.valuationId ?? randomUUID(),
        assetId: valuation.assetId,
        valueAmount: valuation.valueAmount ?? null,
        currency: valuation.currency ?? null,
        asOf: valuation.asOf,
        source: valuation.source,
        lowEstimate: valuation.lowEstimate ?? null,
        midEstimate: valuation.midEstimate ?? null,
        highEstimate: valuation.highEstimate ?? null,
        rawProviderPayload: JSON.stringify(valuation.rawProviderPayload ?? {})
      });
    }
  });
  write();
  return valuations.length;
}

export function insertTransactionOrderMatches(
  db: SqliteDatabase,
  matches: TransactionOrderMatchInput[]
): number {
  const insert = db.prepare(`
    INSERT INTO transaction_order_matches (
      match_id, transaction_id, order_id, confidence, reason, matched_at
    )
    VALUES (@matchId, @transactionId, @orderId, @confidence, @reason, @matchedAt)
    ON CONFLICT(transaction_id, order_id) DO UPDATE SET
      confidence = excluded.confidence,
      reason = excluded.reason,
      matched_at = excluded.matched_at
  `);
  const write = db.transaction(() => {
    for (const match of matches) {
      insert.run({
        matchId: randomUUID(),
        transactionId: match.transactionId,
        orderId: match.orderId,
        confidence: match.confidence,
        reason: match.reason,
        matchedAt: match.matchedAt ?? new Date().toISOString()
      });
    }
  });
  write();
  return matches.length;
}

export function matchMerchantOrdersToTransactions(
  db: SqliteDatabase,
  connectionId: string,
  options: { dateWindowDays?: number; matchedAt?: string } = {}
): number {
  const dateWindowDays = options.dateWindowDays ?? 2;
  const orders = db
    .prepare(
      `
      SELECT order_id AS orderId, merchant_name AS merchantName, order_date AS orderDate, total_amount AS totalAmount
      FROM merchant_orders
      WHERE connection_id = @connectionId
      ORDER BY order_date DESC
    `
    )
    .all({ connectionId }) as Array<{
    orderId: string;
    merchantName: string;
    orderDate: string;
    totalAmount: number;
  }>;

  const findTransaction = db.prepare(`
    SELECT transaction_id AS transactionId
    FROM transactions
    WHERE removed_at IS NULL
      AND connection_id != @connectionId
      AND transaction_type != 'excluded'
      AND abs(amount - @totalAmount) < 0.01
      AND date >= date(@orderDate, @startOffset)
      AND date <= date(@orderDate, @endOffset)
      AND NOT EXISTS (
        SELECT 1
        FROM transaction_order_matches existing
        WHERE existing.transaction_id = transactions.transaction_id
      )
    ORDER BY abs(julianday(date) - julianday(@orderDate)) ASC, date DESC
    LIMIT 1
  `);

  const matches: TransactionOrderMatchInput[] = [];
  for (const order of orders) {
    const row = findTransaction.get({
      connectionId,
      totalAmount: order.totalAmount,
      orderDate: order.orderDate,
      startOffset: `-${dateWindowDays} day`,
      endOffset: `+${dateWindowDays} day`
    }) as { transactionId: string } | undefined;
    if (row) {
      const match: TransactionOrderMatchInput = {
        transactionId: row.transactionId,
        orderId: order.orderId,
        confidence: 0.86,
        reason: `${order.merchantName} order total matched a transaction within ${dateWindowDays} days.`
      };
      if (options.matchedAt) {
        match.matchedAt = options.matchedAt;
      }
      matches.push(match);
    }
  }

  return insertTransactionOrderMatches(db, matches);
}

export function markMatchingConnectorTransfers(
  db: SqliteDatabase,
  connectionId: string,
  options: { dateWindowDays?: number; matchedAt?: string } = {}
): number {
  const dateWindowDays = options.dateWindowDays ?? 2;
  const matchedAt = options.matchedAt ?? new Date().toISOString();
  const connectorTransactions = db
    .prepare(
      `
      SELECT transaction_id AS transactionId, date, amount
      FROM transactions
      WHERE connection_id = @connectionId
        AND removed_at IS NULL
        AND amount > 0
      ORDER BY date DESC
    `
    )
    .all({ connectionId }) as Array<{ transactionId: string; date: string; amount: number }>;

  const findBankSide = db.prepare(`
    SELECT transaction_id AS transactionId
    FROM transactions
    WHERE removed_at IS NULL
      AND connection_id != @connectionId
      AND transaction_type NOT IN ('internal_transfer', 'excluded')
      AND abs(amount - @amount) < 0.01
      AND date >= date(@date, @startOffset)
      AND date <= date(@date, @endOffset)
    ORDER BY abs(julianday(date) - julianday(@date)) ASC, date DESC
    LIMIT 1
  `);
  const markInternal = db.prepare(`
    UPDATE transactions
    SET transaction_type = 'internal_transfer',
        category_id = 'cat-transfer',
        updated_at = @matchedAt
    WHERE transaction_id = @transactionId
  `);

  let changed = 0;
  const write = db.transaction(() => {
    for (const transaction of connectorTransactions) {
      const row = findBankSide.get({
        connectionId,
        amount: transaction.amount,
        date: transaction.date,
        startOffset: `-${dateWindowDays} day`,
        endOffset: `+${dateWindowDays} day`
      }) as { transactionId: string } | undefined;
      if (row) {
        changed += markInternal.run({
          transactionId: row.transactionId,
          matchedAt
        }).changes;
        insertEnrichmentEvent(db, {
          source: "argent.connector-transfer-matcher",
          targetType: "transaction",
          targetId: row.transactionId,
          confidence: 0.82,
          reason: `Matched same-amount connector transaction ${transaction.transactionId} within ${dateWindowDays} days.`,
          payload: { connectorTransactionId: transaction.transactionId, connectionId },
          createdAt: matchedAt
        });
      }
    }
  });
  write();
  return changed;
}

export function insertAuditLog(db: SqliteDatabase, input: AuditInput): string {
  const auditId = randomUUID();
  db.prepare(`
    INSERT INTO audit_log (audit_id, actor, action, target_type, target_id, metadata_json, created_at)
    VALUES (@auditId, @actor, @action, @targetType, @targetId, @metadataJson, @createdAt)
  `).run({
    auditId,
    actor: input.actor,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    metadataJson: JSON.stringify(input.metadata ?? {}),
    createdAt: input.createdAt ?? new Date().toISOString()
  });
  return auditId;
}

export function insertEnrichmentEvent(
  db: SqliteDatabase,
  input: {
    source: string;
    targetType: string;
    targetId: string;
    confidence?: number | null;
    reason: string;
    payload: unknown;
    createdAt?: string;
  }
): string {
  const eventId = randomUUID();
  db.prepare(`
    INSERT INTO enrichment_events (
      event_id, source, target_type, target_id, confidence, reason, payload_json, created_at
    )
    VALUES (@eventId, @source, @targetType, @targetId, @confidence, @reason, @payloadJson, @createdAt)
  `).run({
    eventId,
    source: input.source,
    targetType: input.targetType,
    targetId: input.targetId,
    confidence: input.confidence ?? null,
    reason: input.reason,
    payloadJson: JSON.stringify(input.payload),
    createdAt: input.createdAt ?? new Date().toISOString()
  });
  return eventId;
}

export function getExportRows(db: SqliteDatabase): ExportRow[] {
  const rows = db
    .prepare(
      `
      SELECT
        t.date AS date,
        t.name AS name,
        t.merchant_name AS merchant,
        t.amount AS amount,
        t.direction AS direction,
        t.transaction_type AS type,
        COALESCE(t.user_category, c.name, t.provider_category_primary, t.ai_category) AS category,
        a.name AS account,
        t.iso_currency_code AS currency,
        CASE WHEN t.review_status = 'reviewed' THEN 1 ELSE 0 END AS reviewed,
        COALESCE(tag_names.tags, '') AS tags,
        t.source AS source,
        t.transaction_id AS transaction_id
      FROM transactions t
      LEFT JOIN accounts a ON a.account_id = t.account_id
      LEFT JOIN categories c ON c.category_id = t.category_id
      LEFT JOIN (
        SELECT tt.transaction_id, group_concat(tags.name, '|') AS tags
        FROM transaction_tags tt
        JOIN tags ON tags.tag_id = tt.tag_id
        GROUP BY tt.transaction_id
      ) tag_names ON tag_names.transaction_id = t.transaction_id
      WHERE t.removed_at IS NULL
      ORDER BY t.date DESC, t.authorized_date DESC, t.transaction_id DESC
    `
    )
    .all() as ExportRow[];

  return rows;
}

export function recordExport(
  db: SqliteDatabase,
  target: string,
  rowCount: number,
  exportedAt = new Date().toISOString()
): void {
  db.prepare("INSERT INTO exports (target, row_count, exported_at) VALUES (?, ?, ?)").run(
    target,
    rowCount,
    exportedAt
  );
}

export function insertTransactionsForTest(db: SqliteDatabase, rows: NormalizedTransaction[]): void {
  const upsert = upsertTransactionStatement(db);
  const write = db.transaction((transactions: NormalizedTransaction[]) => {
    for (const transaction of transactions) {
      upsert.run(transaction);
    }
  });
  write(rows);
}
