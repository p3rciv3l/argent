import type Database from "better-sqlite3";

export type SqliteDatabase = Database.Database;

export interface Migration {
  version: number;
  name: string;
  up(db: SqliteDatabase): void;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: "initial_local_finance_schema",
    up(db) {
      db.exec(`
        CREATE TABLE connections (
          connection_id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          provider_item_id TEXT NOT NULL,
          access_token TEXT,
          environment TEXT,
          institution_id TEXT,
          institution_name TEXT,
          link_session_id TEXT,
          cursor TEXT,
          status TEXT NOT NULL DEFAULT 'healthy',
          consent_expiration_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(provider, environment, provider_item_id)
        );

        CREATE TABLE accounts (
          account_id TEXT PRIMARY KEY,
          connection_id TEXT NOT NULL REFERENCES connections(connection_id) ON DELETE CASCADE,
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
          hidden_at TEXT,
          closed_at TEXT,
          excluded_at TEXT,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE balances (
          balance_id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
          available REAL,
          current REAL,
          limit_amount REAL,
          iso_currency_code TEXT,
          captured_at TEXT NOT NULL
        );

        CREATE TABLE category_groups (
          group_id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE categories (
          category_id TEXT PRIMARY KEY,
          group_id TEXT REFERENCES category_groups(group_id) ON DELETE SET NULL,
          name TEXT NOT NULL UNIQUE,
          excluded INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE recurrings (
          recurring_id TEXT PRIMARY KEY,
          merchant_name TEXT NOT NULL,
          cadence TEXT NOT NULL,
          average_amount REAL,
          next_due_date TEXT,
          confidence REAL NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'candidate',
          source TEXT NOT NULL DEFAULT 'detected',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE transactions (
          transaction_id TEXT PRIMARY KEY,
          connection_id TEXT NOT NULL REFERENCES connections(connection_id) ON DELETE CASCADE,
          account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
          date TEXT NOT NULL,
          authorized_date TEXT,
          name TEXT,
          merchant_name TEXT,
          amount REAL NOT NULL,
          direction TEXT NOT NULL CHECK(direction IN ('debit', 'credit')),
          transaction_type TEXT NOT NULL DEFAULT 'regular'
            CHECK(transaction_type IN ('regular', 'income', 'internal_transfer', 'excluded', 'recurring_linked')),
          iso_currency_code TEXT,
          category_id TEXT REFERENCES categories(category_id) ON DELETE SET NULL,
          provider_category_primary TEXT,
          provider_category_detailed TEXT,
          category_confidence TEXT,
          user_category TEXT,
          ai_category TEXT,
          ai_confidence REAL,
          category_source TEXT,
          review_status TEXT NOT NULL DEFAULT 'unreviewed'
            CHECK(review_status IN ('unreviewed', 'reviewed', 'needs_review')),
          reviewed_at TEXT,
          recurring_id TEXT REFERENCES recurrings(recurring_id) ON DELETE SET NULL,
          payment_channel TEXT,
          location_address TEXT,
          location_city TEXT,
          location_region TEXT,
          location_postal_code TEXT,
          location_country TEXT,
          lat REAL,
          lon REAL,
          source TEXT NOT NULL,
          raw_provider_payload TEXT NOT NULL,
          enrichment_state TEXT,
          removed_at TEXT,
          last_synced_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE tags (
          tag_id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          color TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE transaction_tags (
          transaction_id TEXT NOT NULL REFERENCES transactions(transaction_id) ON DELETE CASCADE,
          tag_id TEXT NOT NULL REFERENCES tags(tag_id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          PRIMARY KEY(transaction_id, tag_id)
        );

        CREATE TABLE transaction_reviews (
          review_id TEXT PRIMARY KEY,
          transaction_id TEXT NOT NULL REFERENCES transactions(transaction_id) ON DELETE CASCADE,
          status TEXT NOT NULL,
          note TEXT,
          reviewed_by TEXT NOT NULL,
          reviewed_at TEXT NOT NULL
        );

        CREATE TABLE rules (
          rule_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          match_json TEXT NOT NULL,
          set_json TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'user',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE budget_groups (
          budget_group_id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          monthly_limit REAL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE budgets (
          budget_id TEXT PRIMARY KEY,
          budget_group_id TEXT REFERENCES budget_groups(budget_group_id) ON DELETE SET NULL,
          category_id TEXT REFERENCES categories(category_id) ON DELETE SET NULL,
          month TEXT NOT NULL,
          amount REAL NOT NULL,
          rollover_enabled INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(category_id, month)
        );

        CREATE TABLE budget_rollovers (
          rollover_id TEXT PRIMARY KEY,
          budget_id TEXT NOT NULL REFERENCES budgets(budget_id) ON DELETE CASCADE,
          month TEXT NOT NULL,
          amount REAL NOT NULL,
          reason TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE goals (
          goal_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          target_amount REAL NOT NULL,
          current_amount REAL NOT NULL DEFAULT 0,
          due_date TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE securities (
          security_id TEXT PRIMARY KEY,
          name TEXT,
          ticker_symbol TEXT,
          type TEXT,
          close_price REAL,
          close_price_as_of TEXT,
          iso_currency_code TEXT,
          raw_provider_payload TEXT,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE holdings (
          holding_id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
          security_id TEXT NOT NULL REFERENCES securities(security_id) ON DELETE CASCADE,
          quantity REAL NOT NULL,
          institution_value REAL,
          institution_price REAL,
          cost_basis REAL,
          iso_currency_code TEXT,
          as_of TEXT NOT NULL,
          raw_provider_payload TEXT,
          UNIQUE(account_id, security_id)
        );

        CREATE TABLE investment_transactions (
          investment_transaction_id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
          security_id TEXT REFERENCES securities(security_id) ON DELETE SET NULL,
          date TEXT NOT NULL,
          name TEXT,
          type TEXT,
          subtype TEXT,
          quantity REAL,
          amount REAL,
          price REAL,
          fees REAL,
          iso_currency_code TEXT,
          raw_provider_payload TEXT,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE liabilities (
          liability_id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          apr REAL,
          balance REAL,
          credit_limit REAL,
          minimum_payment_amount REAL,
          next_payment_due_date TEXT,
          last_payment_amount REAL,
          last_payment_date TEXT,
          raw_provider_payload TEXT,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE sync_runs (
          sync_run_id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          connection_id TEXT REFERENCES connections(connection_id) ON DELETE SET NULL,
          status TEXT NOT NULL,
          started_at TEXT NOT NULL,
          completed_at TEXT,
          added_count INTEGER NOT NULL DEFAULT 0,
          modified_count INTEGER NOT NULL DEFAULT 0,
          removed_count INTEGER NOT NULL DEFAULT 0,
          error_message TEXT
        );

        CREATE TABLE enrichment_events (
          event_id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          target_type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          confidence REAL,
          reason TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE agent_proposals (
          proposal_id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          source TEXT NOT NULL,
          confidence REAL,
          reason TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          applied_at TEXT,
          rejected_at TEXT
        );

        CREATE TABLE audit_log (
          audit_id TEXT PRIMARY KEY,
          actor TEXT NOT NULL,
          action TEXT NOT NULL,
          target_type TEXT NOT NULL,
          target_id TEXT,
          metadata_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE exports (
          export_id INTEGER PRIMARY KEY AUTOINCREMENT,
          target TEXT NOT NULL,
          row_count INTEGER NOT NULL,
          exported_at TEXT NOT NULL
        );
      `);
    }
  },
  {
    version: 2,
    name: "indexes_and_seed_categories",
    up(db) {
      db.exec(`
        CREATE INDEX idx_accounts_connection ON accounts(connection_id);
        CREATE INDEX idx_balances_account_captured ON balances(account_id, captured_at DESC);
        CREATE INDEX idx_transactions_account_date ON transactions(account_id, date DESC);
        CREATE INDEX idx_transactions_date ON transactions(date DESC);
        CREATE INDEX idx_transactions_review ON transactions(review_status, date DESC);
        CREATE INDEX idx_transactions_type ON transactions(transaction_type, date DESC);
        CREATE INDEX idx_transactions_recurring ON transactions(recurring_id);
        CREATE INDEX idx_transactions_removed ON transactions(removed_at);
        CREATE INDEX idx_budgets_month ON budgets(month);
        CREATE INDEX idx_sync_runs_provider_started ON sync_runs(provider, started_at DESC);
        CREATE INDEX idx_agent_proposals_status ON agent_proposals(status, created_at DESC);

        INSERT OR IGNORE INTO category_groups (group_id, name, sort_order, created_at, updated_at)
        VALUES
          ('group-income', 'Income', 10, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
          ('group-housing', 'Housing', 20, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
          ('group-food', 'Food', 30, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
          ('group-transport', 'Transport', 40, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
          ('group-shopping', 'Shopping', 50, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
          ('group-bills', 'Bills', 60, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
          ('group-savings', 'Savings', 70, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z');

        INSERT OR IGNORE INTO categories (category_id, group_id, name, excluded, created_at, updated_at)
        VALUES
          ('cat-payroll', 'group-income', 'Payroll', 0, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
          ('cat-rent', 'group-housing', 'Rent', 0, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
          ('cat-groceries', 'group-food', 'Groceries', 0, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
          ('cat-restaurants', 'group-food', 'Restaurants', 0, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
          ('cat-transit', 'group-transport', 'Transit', 0, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
          ('cat-shopping', 'group-shopping', 'Shopping', 0, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
          ('cat-utilities', 'group-bills', 'Utilities', 0, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
          ('cat-transfer', NULL, 'Internal Transfer', 1, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z');
      `);
    }
  },
  {
    version: 3,
    name: "connector_metadata_orders_and_assets",
    up(db) {
      db.exec(`
        ALTER TABLE connections ADD COLUMN connector_id TEXT;
        ALTER TABLE connections ADD COLUMN display_name TEXT;
        ALTER TABLE connections ADD COLUMN setup_state_json TEXT;
        ALTER TABLE connections ADD COLUMN last_sync_at TEXT;
        ALTER TABLE connections ADD COLUMN last_sync_status TEXT;
        ALTER TABLE connections ADD COLUMN last_sync_error TEXT;

        CREATE TABLE merchant_orders (
          order_id TEXT PRIMARY KEY,
          connection_id TEXT NOT NULL REFERENCES connections(connection_id) ON DELETE CASCADE,
          provider_order_id TEXT NOT NULL,
          merchant_name TEXT NOT NULL,
          order_date TEXT NOT NULL,
          total_amount REAL NOT NULL,
          currency TEXT,
          status TEXT,
          raw_provider_payload TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(connection_id, provider_order_id)
        );

        CREATE TABLE merchant_order_items (
          order_item_id TEXT PRIMARY KEY,
          order_id TEXT NOT NULL REFERENCES merchant_orders(order_id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          quantity REAL,
          unit_price REAL,
          total_price REAL,
          category TEXT,
          raw_provider_payload TEXT NOT NULL
        );

        CREATE TABLE transaction_order_matches (
          match_id TEXT PRIMARY KEY,
          transaction_id TEXT NOT NULL REFERENCES transactions(transaction_id) ON DELETE CASCADE,
          order_id TEXT NOT NULL REFERENCES merchant_orders(order_id) ON DELETE CASCADE,
          confidence REAL NOT NULL,
          reason TEXT NOT NULL,
          matched_at TEXT NOT NULL,
          UNIQUE(transaction_id, order_id)
        );

        CREATE TABLE external_assets (
          asset_id TEXT PRIMARY KEY,
          connection_id TEXT NOT NULL REFERENCES connections(connection_id) ON DELETE CASCADE,
          provider_asset_id TEXT NOT NULL,
          asset_type TEXT NOT NULL,
          name TEXT NOT NULL,
          symbol TEXT,
          quantity REAL,
          currency TEXT,
          address TEXT,
          metadata_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(connection_id, provider_asset_id)
        );

        CREATE TABLE asset_valuations (
          valuation_id TEXT PRIMARY KEY,
          asset_id TEXT NOT NULL REFERENCES external_assets(asset_id) ON DELETE CASCADE,
          value_amount REAL,
          currency TEXT,
          as_of TEXT NOT NULL,
          source TEXT NOT NULL,
          low_estimate REAL,
          mid_estimate REAL,
          high_estimate REAL,
          raw_provider_payload TEXT NOT NULL,
          UNIQUE(asset_id, as_of, source)
        );

        CREATE INDEX idx_connections_connector ON connections(connector_id, status);
        CREATE INDEX idx_merchant_orders_connection_date ON merchant_orders(connection_id, order_date DESC);
        CREATE INDEX idx_order_matches_transaction ON transaction_order_matches(transaction_id);
        CREATE INDEX idx_external_assets_connection ON external_assets(connection_id, asset_type);
        CREATE INDEX idx_asset_valuations_asset_as_of ON asset_valuations(asset_id, as_of DESC);
      `);
    }
  }
];

function tableExists(db: SqliteDatabase, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) as { name: string } | undefined;
  return Boolean(row);
}

function prepareLegacyBankTransactionsMigration(db: SqliteDatabase): boolean {
  if (!tableExists(db, "plaid_items") || tableExists(db, "connections")) {
    return false;
  }

  const rename = db.transaction(() => {
    for (const table of ["plaid_items", "accounts", "transactions", "exports"]) {
      if (tableExists(db, table) && !tableExists(db, `legacy_bank_tx_${table}`)) {
        db.exec(`ALTER TABLE ${table} RENAME TO legacy_bank_tx_${table}`);
      }
    }
  });

  rename();
  return true;
}

function copyLegacyBankTransactionsData(db: SqliteDatabase): void {
  const now = new Date().toISOString();
  const copy = db.transaction(() => {
    db.prepare(`
      INSERT OR IGNORE INTO connections (
        connection_id, provider, provider_item_id, access_token, environment,
        institution_id, institution_name, link_session_id, cursor, status,
        consent_expiration_at, created_at, updated_at
      )
      SELECT
        item_id,
        'plaid',
        item_id,
        access_token,
        plaid_env,
        institution_id,
        institution_name,
        link_session_id,
        cursor,
        'healthy',
        NULL,
        COALESCE(created_at, @now),
        COALESCE(updated_at, @now)
      FROM legacy_bank_tx_plaid_items
    `).run({ now });

    if (tableExists(db, "legacy_bank_tx_accounts")) {
      db.prepare(`
        INSERT OR IGNORE INTO accounts (
          account_id, connection_id, name, official_name, type, subtype, mask,
          iso_currency_code, unofficial_currency_code, balance_available,
          balance_current, balance_limit, balance_as_of, hidden_at, closed_at,
          excluded_at, updated_at
        )
        SELECT
          account_id,
          item_id,
          name,
          official_name,
          type,
          subtype,
          mask,
          iso_currency_code,
          unofficial_currency_code,
          balance_available,
          balance_current,
          balance_limit,
          COALESCE(balance_as_of, updated_at, @now),
          NULL,
          NULL,
          NULL,
          COALESCE(updated_at, @now)
        FROM legacy_bank_tx_accounts
      `).run({ now });

      db.prepare(`
        INSERT INTO balances (
          account_id, available, current, limit_amount, iso_currency_code, captured_at
        )
        SELECT
          account_id,
          balance_available,
          balance_current,
          balance_limit,
          iso_currency_code,
          COALESCE(balance_as_of, updated_at, @now)
        FROM legacy_bank_tx_accounts
        WHERE balance_available IS NOT NULL
           OR balance_current IS NOT NULL
           OR balance_limit IS NOT NULL
      `).run({ now });
    }

    if (tableExists(db, "legacy_bank_tx_transactions")) {
      db.prepare(`
        INSERT OR IGNORE INTO transactions (
          transaction_id, connection_id, account_id, date, authorized_date,
          name, merchant_name, amount, direction, transaction_type,
          iso_currency_code, category_id, provider_category_primary,
          provider_category_detailed, category_confidence, user_category,
          ai_category, ai_confidence, category_source, review_status,
          reviewed_at, recurring_id, payment_channel, location_address,
          location_city, location_region, location_postal_code,
          location_country, lat, lon, source, raw_provider_payload,
          enrichment_state, removed_at, last_synced_at, updated_at
        )
        SELECT
          transaction_id,
          item_id,
          account_id,
          date,
          authorized_date,
          name,
          merchant_name,
          amount,
          direction,
          CASE WHEN amount < 0 THEN 'income' ELSE 'regular' END,
          iso_currency_code,
          NULL,
          personal_finance_category_primary,
          personal_finance_category_detailed,
          category_confidence,
          user_category,
          ai_category,
          ai_confidence,
          category_source,
          CASE WHEN category_reviewed = 1 THEN 'reviewed' ELSE 'unreviewed' END,
          CASE WHEN category_reviewed = 1 THEN updated_at ELSE NULL END,
          NULL,
          payment_channel,
          location_address,
          location_city,
          location_region,
          location_postal_code,
          location_country,
          lat,
          lon,
          source,
          raw_json,
          NULL,
          removed_at,
          COALESCE(last_synced_at, updated_at, @now),
          COALESCE(updated_at, @now)
        FROM legacy_bank_tx_transactions
      `).run({ now });
    }

    if (tableExists(db, "legacy_bank_tx_exports")) {
      db.prepare(`
        INSERT INTO exports (target, row_count, exported_at)
        SELECT target, row_count, exported_at
        FROM legacy_bank_tx_exports
      `).run();
    }

    db.prepare(`
      INSERT INTO audit_log (
        audit_id, actor, action, target_type, target_id, metadata_json, created_at
      )
      VALUES (
        lower(hex(randomblob(16))),
        'argent.migration',
        'legacy_bank_transactions.import',
        'database',
        NULL,
        @metadataJson,
        @now
      )
    `).run({
      now,
      metadataJson: JSON.stringify({ source_schema: "bank_transactions", copied_at: now })
    });
  });

  copy();
}

export function migrate(db: SqliteDatabase): void {
  const hasLegacyBankTransactions = prepareLegacyBankTransactionsMigration(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const row = db.prepare("SELECT max(version) AS version FROM schema_migrations").get() as {
    version: number | null;
  };
  const currentVersion = row.version ?? 0;
  const pending = migrations.filter((migration) => migration.version > currentVersion);
  const apply = db.transaction((migration: Migration) => {
    migration.up(db);
    db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
      migration.version,
      migration.name,
      new Date().toISOString()
    );
  });

  for (const migration of pending) {
    apply(migration);
  }

  if (hasLegacyBankTransactions) {
    copyLegacyBankTransactionsData(db);
  }
}
