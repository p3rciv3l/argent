import { describe, expect, test } from "vitest";
import {
  applyTransactionChanges,
  getConnection,
  getDashboard,
  getInvestments,
  insertTransactionsForTest,
  listTransactions,
  markMatchingConnectorTransfers,
  matchMerchantOrdersToTransactions,
  openDatabase,
  upsertAccounts,
  upsertAssetValuations,
  upsertConnection,
  upsertExternalAssets,
  upsertMerchantOrders
} from "@argent/core";
import { getConnectorModule, listConnectorDefinitions } from "../src/index.js";
import type { ConnectorModule } from "../src/index.js";

function requireConnector(id: string): ConnectorModule {
  const connector = getConnectorModule(id);
  if (!connector) {
    throw new Error(`Missing connector ${id}`);
  }
  return connector;
}

function setupConnection(db: ReturnType<typeof openDatabase>, connector: ConnectorModule): NonNullable<ReturnType<typeof getConnection>> {
  const setup = connector.buildSetup({ demo: true });
  const connectionId = upsertConnection(
    db,
    {
      provider: setup.provider,
      providerItemId: setup.providerItemId,
      connectorId: setup.connectorId,
      displayName: setup.displayName,
      environment: "local",
      institutionName: setup.displayName,
      status: setup.status ?? "healthy",
      setupState: setup.setupState
    },
    "2026-06-01T00:00:00.000Z"
  );
  const connection = getConnection(db, connectionId);
  if (!connection) {
    throw new Error(`Missing connection ${connectionId}`);
  }
  return connection;
}

describe("connectors", () => {
  test("catalog distinguishes working connectors from partner-required entries", () => {
    const definitions = listConnectorDefinitions();
    expect(definitions.map((definition) => definition.id)).toEqual(
      expect.arrayContaining([
        "cash-app-receipts",
        "amazon-orders",
        "coinbase",
        "crypto-wallet",
        "mastercard-finicity",
        "apple-financekit"
      ])
    );
    expect(definitions.find((definition) => definition.id === "mastercard-finicity")).toMatchObject({
      status: "partner_required",
      partnerRequired: true
    });
    expect(definitions.find((definition) => definition.id === "apple-financekit")).toMatchObject({
      status: "blocked"
    });
  });

  test("cash app receipt sync creates accounts and marks matching bank transfers internal", async () => {
    const db = openDatabase(":memory:");
    try {
      const bankConnectionId = upsertConnection(db, {
        provider: "mock",
        providerItemId: "bank",
        environment: "test",
        institutionName: "Test Bank"
      });
      upsertAccounts(
        db,
        [
          {
            account_id: "checking",
            name: "Checking",
            type: "depository",
            subtype: "checking",
            balances: { current: 1000, iso_currency_code: "USD" }
          }
        ],
        bankConnectionId,
        "2026-06-01T00:00:00.000Z"
      );
      insertTransactionsForTest(db, [
        {
          transactionId: "bank-venmo-transfer",
          connectionId: bankConnectionId,
          accountId: "checking",
          date: "2026-06-05",
          authorizedDate: null,
          name: "VENMO PAYMENT",
          merchantName: "Venmo",
          amount: 25,
          direction: "debit",
          transactionType: "regular",
          isoCurrencyCode: "USD",
          providerCategoryPrimary: null,
          providerCategoryDetailed: null,
          categoryConfidence: null,
          paymentChannel: "online",
          locationAddress: null,
          locationCity: null,
          locationRegion: null,
          locationPostalCode: null,
          locationCountry: null,
          lat: null,
          lon: null,
          source: "mock",
          rawProviderPayload: "{}",
          enrichmentState: null,
          lastSyncedAt: "2026-06-05T00:00:00.000Z",
          updatedAt: "2026-06-05T00:00:00.000Z"
        }
      ]);

      const connector = requireConnector("cash-app-receipts");
      const connection = setupConnection(db, connector);
      const payload = await connector.sync(connection, { now: "2026-06-20T00:00:00.000Z" });
      upsertAccounts(db, payload.accounts, connection.connectionId, payload.syncedAt);
      applyTransactionChanges(db, {
        connectionId: payload.connectionId,
        provider: payload.provider,
        added: payload.added,
        modified: payload.modified,
        removed: payload.removed,
        cursor: payload.cursor ?? null,
        syncedAt: payload.syncedAt
      });
      const changed = markMatchingConnectorTransfers(db, connection.connectionId, {
        matchedAt: "2026-06-20T00:00:00.000Z"
      });

      expect(payload.accounts).toHaveLength(3);
      expect(payload.added).toHaveLength(3);
      expect(changed).toBe(1);
      expect(listTransactions(db, { type: "internal_transfer" }).map((row) => row.transactionId)).toContain(
        "bank-venmo-transfer"
      );
    } finally {
      db.close();
    }
  });

  test("amazon order sync stores itemized orders and matches card transactions", async () => {
    const db = openDatabase(":memory:");
    try {
      const bankConnectionId = upsertConnection(db, {
        provider: "mock",
        providerItemId: "card",
        environment: "test",
        institutionName: "Test Card"
      });
      upsertAccounts(
        db,
        [
          {
            account_id: "card",
            name: "Credit Card",
            type: "credit",
            subtype: "credit card",
            balances: { current: 100, iso_currency_code: "USD" }
          }
        ],
        bankConnectionId,
        "2026-06-01T00:00:00.000Z"
      );
      insertTransactionsForTest(db, [
        {
          transactionId: "card-amazon-74",
          connectionId: bankConnectionId,
          accountId: "card",
          date: "2026-06-05",
          authorizedDate: null,
          name: "AMAZON MKTPLACE",
          merchantName: "Amazon",
          amount: 74.18,
          direction: "debit",
          transactionType: "regular",
          isoCurrencyCode: "USD",
          providerCategoryPrimary: null,
          providerCategoryDetailed: null,
          categoryConfidence: null,
          paymentChannel: "online",
          locationAddress: null,
          locationCity: null,
          locationRegion: null,
          locationPostalCode: null,
          locationCountry: null,
          lat: null,
          lon: null,
          source: "mock",
          rawProviderPayload: "{}",
          enrichmentState: null,
          lastSyncedAt: "2026-06-05T00:00:00.000Z",
          updatedAt: "2026-06-05T00:00:00.000Z"
        }
      ]);

      const connector = requireConnector("amazon-orders");
      const connection = setupConnection(db, connector);
      const payload = await connector.sync(connection, { now: "2026-06-20T00:00:00.000Z" });
      const orderWrite = upsertMerchantOrders(db, payload.orders, payload.syncedAt);
      const matches = matchMerchantOrdersToTransactions(db, connection.connectionId, {
        matchedAt: "2026-06-20T00:00:00.000Z"
      });

      expect(orderWrite).toEqual({ orders: 2, items: 4 });
      expect(matches).toBe(1);
      const matchCount = (db.prepare("SELECT count(*) AS count FROM transaction_order_matches").get() as { count: number }).count;
      expect(matchCount).toBe(1);
    } finally {
      db.close();
    }
  });

  test("crypto connectors feed external assets into net worth", async () => {
    const db = openDatabase(":memory:");
    try {
      for (const id of ["coinbase", "crypto-wallet"]) {
        const connector = requireConnector(id);
        const connection = setupConnection(db, connector);
        const payload = await connector.sync(connection, { now: "2026-06-20T00:00:00.000Z" });
        upsertAccounts(db, payload.accounts, connection.connectionId, payload.syncedAt);
        upsertExternalAssets(db, payload.externalAssets, payload.syncedAt);
        upsertAssetValuations(db, payload.assetValuations);
      }

      const investments = getInvestments(db) as { externalAssets: Array<Record<string, unknown>> };
      const dashboard = getDashboard(db, new Date("2026-06-20T00:00:00.000Z"));
      expect(investments.externalAssets.length).toBeGreaterThanOrEqual(3);
      expect(dashboard.netWorth).toBeGreaterThan(20000);
    } finally {
      db.close();
    }
  });
});
