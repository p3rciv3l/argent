import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import {
  applyTransactionChanges,
  applyTransactionRules,
  buildCsv,
  getCashFlow,
  getDashboard,
  getInvestments,
  listTransactions,
  insertTransactionsForTest,
  matchMerchantOrdersToTransactions,
  migrate,
  normalizeTransaction,
  openDatabase,
  parseDescriptorLocation,
  reviewTransactions,
  getLiabilities,
  upsertAssetValuations,
  upsertAccounts,
  upsertConnection,
  upsertExternalAssets,
  upsertMerchantOrders
} from "../src/index.js";

function seedDb() {
  const db = openDatabase(":memory:");
  const connectionId = upsertConnection(
    db,
    {
      connectionId: "mock:sandbox:item",
      provider: "mock",
      providerItemId: "item",
      accessToken: "mock-token",
      environment: "sandbox",
      institutionName: "Mock Credit Union"
    },
    "2026-06-01T00:00:00.000Z"
  );
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
    connectionId,
    "2026-06-01T00:00:00.000Z"
  );
  return { db, connectionId };
}

describe("core", () => {
  test("runs versioned migrations on an empty database", () => {
    const db = openDatabase(":memory:");
    try {
      const row = db.prepare("SELECT max(version) AS version FROM schema_migrations").get() as { version: number };
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_proposals'").get();
      const columns = db.prepare("PRAGMA table_info(transactions)").all() as Array<{ name: string }>;
      expect(row.version).toBe(3);
      expect(table).toBeTruthy();
      expect(columns.map((column) => column.name)).toContain("iso_currency_code");
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'external_assets'").get()).toBeTruthy();
    } finally {
      db.close();
    }
  });

  test("migrates a synthetic legacy Bank Transactions schema", () => {
    const db = new Database(":memory:");
    try {
      db.exec(`
        CREATE TABLE plaid_items (
          item_id TEXT PRIMARY KEY,
          access_token TEXT NOT NULL,
          plaid_env TEXT,
          institution_id TEXT,
          institution_name TEXT,
          link_session_id TEXT,
          cursor TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE accounts (
          account_id TEXT PRIMARY KEY,
          item_id TEXT NOT NULL,
          name TEXT,
          official_name TEXT,
          type TEXT,
          subtype TEXT,
          mask TEXT,
          iso_currency_code TEXT,
          unofficial_currency_code TEXT,
          balance_available REAL,
          balance_current REAL,
          balance_limit REAL,
          balance_as_of TEXT,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE transactions (
          transaction_id TEXT PRIMARY KEY,
          item_id TEXT NOT NULL,
          account_id TEXT NOT NULL,
          date TEXT NOT NULL,
          authorized_date TEXT,
          name TEXT,
          merchant_name TEXT,
          amount REAL NOT NULL,
          direction TEXT NOT NULL,
          iso_currency_code TEXT,
          personal_finance_category_primary TEXT,
          personal_finance_category_detailed TEXT,
          category_confidence TEXT,
          payment_channel TEXT,
          location_address TEXT,
          location_city TEXT,
          location_region TEXT,
          location_postal_code TEXT,
          location_country TEXT,
          lat REAL,
          lon REAL,
          source TEXT NOT NULL,
          raw_json TEXT NOT NULL,
          removed_at TEXT,
          last_synced_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          user_category TEXT,
          ai_category TEXT,
          ai_confidence REAL,
          category_source TEXT,
          category_reviewed INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE exports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          target TEXT NOT NULL,
          row_count INTEGER NOT NULL,
          exported_at TEXT NOT NULL
        );

        INSERT INTO plaid_items (
          item_id, access_token, plaid_env, institution_id, institution_name,
          link_session_id, cursor, created_at, updated_at
        )
        VALUES (
          'legacy-item', 'legacy-access-token', 'sandbox', 'ins_legacy',
          'Legacy Credit Union', 'legacy-link-session', 'legacy-cursor',
          '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'
        );

        INSERT INTO accounts (
          account_id, item_id, name, official_name, type, subtype, mask,
          iso_currency_code, balance_current, balance_as_of, updated_at
        )
        VALUES (
          'legacy-checking', 'legacy-item', 'Legacy Checking', NULL,
          'depository', 'checking', '1234', 'USD', 1500,
          '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z'
        );

        INSERT INTO transactions (
          transaction_id, item_id, account_id, date, name, merchant_name,
          amount, direction, iso_currency_code, personal_finance_category_primary,
          personal_finance_category_detailed, category_confidence, payment_channel,
          source, raw_json, last_synced_at, updated_at, user_category,
          category_source, category_reviewed
        )
        VALUES (
          'legacy-txn', 'legacy-item', 'legacy-checking', '2026-01-03',
          'LEGACY MARKET', 'Legacy Market', 24.5, 'debit', 'USD',
          'FOOD_AND_DRINK', 'FOOD_AND_DRINK_GROCERIES', 'HIGH', 'in store',
          'plaid', '{"transaction_id":"legacy-txn"}',
          '2026-01-04T00:00:00.000Z', '2026-01-04T00:00:00.000Z',
          'Groceries', 'user', 1
        );
      `);

      migrate(db);

      const connection = db.prepare("SELECT * FROM connections WHERE connection_id = ?").get("legacy-item") as {
        provider: string;
        institution_name: string;
      };
      const transaction = db.prepare("SELECT * FROM transactions WHERE transaction_id = ?").get("legacy-txn") as {
        connection_id: string;
        user_category: string;
        review_status: string;
        raw_provider_payload: string;
      };
      const legacyTable = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'legacy_bank_tx_transactions'")
        .get();

      expect(connection.provider).toBe("plaid");
      expect(connection.institution_name).toBe("Legacy Credit Union");
      expect(transaction.connection_id).toBe("legacy-item");
      expect(transaction.user_category).toBe("Groceries");
      expect(transaction.review_status).toBe("reviewed");
      expect(transaction.raw_provider_payload).toContain("legacy-txn");
      expect(legacyTable).toBeTruthy();
    } finally {
      db.close();
    }
  });

  test("normalizes Plaid-like transactions without pending storage", () => {
    const normalized = normalizeTransaction(
      {
        transaction_id: "txn-1",
        account_id: "checking",
        date: "2026-06-03",
        name: "NORTHSIDE MARKET PORTLAND OR",
        merchant_name: "Northside Market",
        amount: 42.5,
        pending: true,
        pending_transaction_id: "pending-1",
        iso_currency_code: "USD"
      },
      "mock:sandbox:item",
      "2026-06-03T12:00:00.000Z",
      "mock"
    );
    expect(normalized.direction).toBe("debit");
    expect(normalized.transactionType).toBe("regular");
    expect(normalized.rawProviderPayload).not.toContain("pending_transaction_id");
  });

  test("parses generic descriptor city and state", () => {
    expect(parseDescriptorLocation("NORTHSIDE MARKET PORTLAND OR")).toEqual({
      city: "Portland",
      region: "OR",
      country: "US"
    });
  });

  test("builds escaped CSV", () => {
    const csv = buildCsv([
      {
        date: "2026-06-03",
        name: "A, B",
        merchant: "Merchant",
        amount: 12,
        direction: "debit",
        type: "regular",
        category: "Food",
        account: "Checking",
        currency: "USD",
        reviewed: false,
        tags: null,
        source: "mock",
        transaction_id: "txn-1"
      }
    ]);
    expect(csv).toContain('"A, B"');
  });

  test("applies sync changes, rules, reviews, and dashboard analytics", () => {
    const { db, connectionId } = seedDb();
    try {
      const syncedAt = "2026-06-04T00:00:00.000Z";
      const transactions = [
        normalizeTransaction(
          {
            transaction_id: "txn-market",
            account_id: "checking",
            date: "2026-06-03",
            name: "NORTHSIDE MARKET",
            merchant_name: "Northside Market",
            amount: 86.42,
            iso_currency_code: "USD"
          },
          connectionId,
          syncedAt,
          "mock"
        ),
        normalizeTransaction(
          {
            transaction_id: "txn-payroll",
            account_id: "checking",
            date: "2026-06-01",
            name: "ACME PAYROLL",
            merchant_name: "Acme Payroll",
            amount: -3200,
            iso_currency_code: "USD"
          },
          connectionId,
          syncedAt,
          "mock"
        )
      ];
      applyTransactionChanges(db, {
        connectionId,
        provider: "mock",
        added: transactions,
        modified: [],
        removed: [],
        cursor: "cursor-1",
        syncedAt
      });
      const rulesResult = applyTransactionRules(db, {
        rules: [
          {
            id: "market",
            match: { merchantName: "Northside Market" },
            set: { userCategory: "Groceries", reviewStatus: "needs_review" }
          }
        ]
      });
      expect(rulesResult.changedRows).toBe(1);
      expect(listTransactions(db, { search: "market" })[0]?.userCategory).toBe("Groceries");
      expect(reviewTransactions(db, ["txn-market"], "reviewed", "test")).toBe(1);
      db.prepare(`
        INSERT INTO liabilities (
          liability_id, account_id, type, apr, balance, credit_limit,
          minimum_payment_amount, next_payment_due_date, raw_provider_payload, updated_at
        )
        VALUES (
          'liability-card', 'checking', 'credit', 19.99, 250, 1000,
          35, '2026-07-01', '{}', '2026-06-04T00:00:00.000Z'
        )
      `).run();
      expect(getLiabilities(db)[0]?.creditUtilization).toBe(25);
      const dashboard = getDashboard(db, new Date("2026-06-15T00:00:00.000Z"));
      expect(dashboard.monthSpent).toBeCloseTo(86.42);
      expect(dashboard.monthIncome).toBeCloseTo(3200);
      expect(getCashFlow(db, 1, "2026-06")[0]?.net).toBeCloseTo(3113.58);
    } finally {
      db.close();
    }
  });

  test("upserts merchant orders idempotently and replaces stale order items", () => {
    const { db, connectionId } = seedDb();
    try {
      const first = upsertMerchantOrders(
        db,
        [
          {
            orderId: "order-1",
            connectionId,
            providerOrderId: "provider-order-1",
            merchantName: "Amazon",
            orderDate: "2026-06-04",
            totalAmount: 74.18,
            currency: "USD",
            items: [
              { orderItemId: "order-1:item-1", name: "Cable", quantity: 1, totalPrice: 18.99 },
              { orderItemId: "order-1:item-2", name: "Notebook", quantity: 2, totalPrice: 33 }
            ]
          }
        ],
        "2026-06-05T00:00:00.000Z"
      );
      const second = upsertMerchantOrders(
        db,
        [
          {
            orderId: "order-1",
            connectionId,
            providerOrderId: "provider-order-1",
            merchantName: "Amazon",
            orderDate: "2026-06-04",
            totalAmount: 70,
            currency: "USD",
            items: [{ orderItemId: "order-1:item-3", name: "Replacement item", quantity: 1, totalPrice: 70 }]
          }
        ],
        "2026-06-06T00:00:00.000Z"
      );

      const orderCount = (db.prepare("SELECT count(*) AS count FROM merchant_orders").get() as { count: number }).count;
      const itemRows = db
        .prepare("SELECT name FROM merchant_order_items ORDER BY name")
        .all() as Array<{ name: string }>;
      const total = (db.prepare("SELECT total_amount AS total FROM merchant_orders WHERE order_id = ?").get("order-1") as { total: number }).total;

      expect(first).toEqual({ orders: 1, items: 2 });
      expect(second).toEqual({ orders: 1, items: 1 });
      expect(orderCount).toBe(1);
      expect(itemRows.map((row) => row.name)).toEqual(["Replacement item"]);
      expect(total).toBe(70);
    } finally {
      db.close();
    }
  });

  test("matches merchant orders once and ignores excluded or same-connection transactions", () => {
    const { db, connectionId: orderConnectionId } = seedDb();
    try {
      const bankConnectionId = upsertConnection(db, {
        connectionId: "mock:sandbox:card",
        provider: "mock",
        providerItemId: "card",
        environment: "sandbox",
        institutionName: "Mock Card"
      });
      upsertAccounts(
        db,
        [
          {
            account_id: "card",
            name: "Card",
            type: "credit",
            subtype: "credit card",
            balances: { current: 0, iso_currency_code: "USD" }
          }
        ],
        bankConnectionId,
        "2026-06-01T00:00:00.000Z"
      );
      insertTransactionsForTest(db, [
        normalizeTransaction(
          {
            transaction_id: "same-connection-amazon",
            account_id: "checking",
            date: "2026-06-04",
            name: "AMAZON SAME CONNECTION",
            merchant_name: "Amazon",
            amount: 74.18
          },
          orderConnectionId,
          "2026-06-04T00:00:00.000Z",
          "mock"
        ),
        normalizeTransaction(
          {
            transaction_id: "excluded-amazon",
            account_id: "card",
            date: "2026-06-04",
            name: "AMAZON EXCLUDED",
            merchant_name: "Amazon",
            amount: 74.18
          },
          bankConnectionId,
          "2026-06-04T00:00:00.000Z",
          "mock"
        ),
        normalizeTransaction(
          {
            transaction_id: "matched-amazon",
            account_id: "card",
            date: "2026-06-05",
            name: "AMAZON MKTPLACE",
            merchant_name: "Amazon",
            amount: 74.18
          },
          bankConnectionId,
          "2026-06-05T00:00:00.000Z",
          "mock"
        )
      ]);
      db.prepare("UPDATE transactions SET transaction_type = 'excluded' WHERE transaction_id = 'excluded-amazon'").run();
      upsertMerchantOrders(
        db,
        [
          {
            orderId: "amazon-order-1",
            connectionId: orderConnectionId,
            providerOrderId: "provider-order-1",
            merchantName: "Amazon",
            orderDate: "2026-06-04",
            totalAmount: 74.18
          }
        ],
        "2026-06-06T00:00:00.000Z"
      );

      expect(matchMerchantOrdersToTransactions(db, orderConnectionId, { matchedAt: "2026-06-06T00:00:00.000Z" })).toBe(1);
      expect(matchMerchantOrdersToTransactions(db, orderConnectionId, { matchedAt: "2026-06-07T00:00:00.000Z" })).toBe(0);
      const matches = db
        .prepare("SELECT transaction_id AS transactionId FROM transaction_order_matches")
        .all() as Array<{ transactionId: string }>;
      expect(matches.map((row) => row.transactionId)).toEqual(["matched-amazon"]);
    } finally {
      db.close();
    }
  });

  test("deduplicates asset valuations and reports only latest external asset value", () => {
    const { db, connectionId } = seedDb();
    try {
      upsertExternalAssets(
        db,
        [
          {
            assetId: "asset-btc",
            connectionId,
            providerAssetId: "BTC",
            assetType: "crypto",
            name: "Bitcoin",
            symbol: "BTC",
            quantity: 1,
            currency: "USD",
            metadata: { source: "test" }
          }
        ],
        "2026-06-01T00:00:00.000Z"
      );
      upsertAssetValuations(db, [
        {
          assetId: "asset-btc",
          valueAmount: 100,
          currency: "USD",
          asOf: "2026-06-01T00:00:00.000Z",
          source: "test"
        }
      ]);
      upsertAssetValuations(db, [
        {
          assetId: "asset-btc",
          valueAmount: 125,
          currency: "USD",
          asOf: "2026-06-01T00:00:00.000Z",
          source: "test"
        },
        {
          assetId: "asset-btc",
          valueAmount: 150,
          currency: "USD",
          asOf: "2026-06-02T00:00:00.000Z",
          source: "test"
        }
      ]);

      const valuationRows = db.prepare("SELECT count(*) AS count FROM asset_valuations").get() as { count: number };
      const investments = getInvestments(db) as { externalAssets: Array<Record<string, unknown>> };
      const dashboard = getDashboard(db, new Date("2026-06-03T00:00:00.000Z"));

      expect(valuationRows.count).toBe(2);
      expect(investments.externalAssets).toHaveLength(1);
      expect(investments.externalAssets[0]?.valueAmount).toBe(150);
      expect(dashboard.netWorth).toBe(1150);
    } finally {
      db.close();
    }
  });
});
