import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import {
  applyTransactionChanges,
  applyTransactionRules,
  buildCsv,
  getCashFlow,
  getDashboard,
  listTransactions,
  migrate,
  normalizeTransaction,
  openDatabase,
  parseDescriptorLocation,
  reviewTransactions,
  getLiabilities,
  upsertAccounts,
  upsertConnection
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
});
