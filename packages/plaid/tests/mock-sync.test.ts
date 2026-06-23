import { describe, expect, test } from "vitest";
import { vi } from "vitest";
import {
  getConnection,
  listConnections,
  listTransactions,
  openDatabase,
  runRecurringEnrichment,
  upsertConnection
} from "@argent/core";
import {
  applyMockPlaidSyncFixture,
  defaultMockFixturePath,
  disconnectPlaidConnection,
  fetchTransactionChanges,
  loadMockPlaidFixture,
  refreshPlaidItemHealth
} from "../src/index.js";
import type { PlaidApi } from "plaid";
import type { ConnectionRecord, PlaidTransactionLike } from "@argent/core";

describe("mock Plaid sync", () => {
  test("loads the public fixture into an empty database", async () => {
    const db = openDatabase(":memory:");
    try {
      const fixture = await loadMockPlaidFixture(defaultMockFixturePath());
      const result = await applyMockPlaidSyncFixture(db, fixture);
      expect(result.added).toBe(5);
      expect(listTransactions(db)).toHaveLength(5);
      expect(runRecurringEnrichment(db, "test")).toBe(1);
    } finally {
      db.close();
    }
  });

  test("retries transaction sync when Plaid mutates during pagination", async () => {
    const transaction: PlaidTransactionLike = {
      transaction_id: "plaid-txn-1",
      account_id: "plaid-account-1",
      date: "2026-06-01",
      name: "Retry Test",
      amount: 12.34
    };
    const transactionsSync = vi
      .fn()
      .mockRejectedValueOnce({
        response: {
          data: {
            error_code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION"
          }
        }
      })
      .mockResolvedValueOnce({
        data: {
          added: [transaction],
          modified: [],
          removed: [],
          next_cursor: "cursor-page-2",
          has_more: true
        }
      })
      .mockResolvedValueOnce({
        data: {
          added: [],
          modified: [],
          removed: [{ transaction_id: "plaid-removed-1" }],
          next_cursor: "cursor-done",
          has_more: false
        }
      });
    const connection: ConnectionRecord = {
      connectionId: "plaid:sandbox:item-1",
      provider: "plaid",
      providerItemId: "item-1",
      accessToken: "access-sandbox-1",
      environment: "sandbox",
      institutionId: "ins_1",
      institutionName: "Synthetic Bank",
      linkSessionId: null,
      cursor: "cursor-start",
      status: "healthy",
      consentExpirationAt: null,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z"
    };

    const result = await fetchTransactionChanges({ transactionsSync } as unknown as PlaidApi, connection);

    expect(transactionsSync).toHaveBeenCalledTimes(3);
    expect(transactionsSync.mock.calls[0]?.[0]).toMatchObject({ cursor: "cursor-start" });
    expect(transactionsSync.mock.calls[1]?.[0]).toMatchObject({ cursor: "cursor-start" });
    expect(transactionsSync.mock.calls[2]?.[0]).toMatchObject({ cursor: "cursor-page-2" });
    expect(result).toMatchObject({
      cursor: "cursor-done",
      added: [transaction],
      removed: [{ transaction_id: "plaid-removed-1" }]
    });
  });

  test("refreshes Plaid item health and audits attention state", async () => {
    const db = openDatabase(":memory:");
    try {
      const connectionId = upsertConnection(db, {
        provider: "plaid",
        providerItemId: "item-attention",
        accessToken: "access-attention",
        environment: "sandbox"
      });
      const itemGet = vi.fn().mockResolvedValue({
        data: {
          item: {
            error: {
              error_code: "ITEM_LOGIN_REQUIRED",
              error_message: "Login required"
            },
            consent_expiration_time: "2026-07-01T00:00:00Z"
          }
        }
      });
      const connection = getConnection(db, connectionId);
      expect(connection).not.toBeNull();

      const result = await refreshPlaidItemHealth(db, { itemGet } as unknown as PlaidApi, connection!);
      const refreshed = getConnection(db, connectionId);
      const auditCount = (db
        .prepare("SELECT count(*) AS count FROM audit_log WHERE action = 'connection.health'")
        .get() as { count: number }).count;

      expect(result).toEqual({
        status: "attention",
        consentExpirationAt: "2026-07-01T00:00:00Z",
        errorCode: "ITEM_LOGIN_REQUIRED"
      });
      expect(refreshed?.status).toBe("attention");
      expect(refreshed?.consentExpirationAt).toBe("2026-07-01T00:00:00Z");
      expect(auditCount).toBe(1);
    } finally {
      db.close();
    }
  });

  test("disconnects a Plaid connection locally and remotely", async () => {
    const db = openDatabase(":memory:");
    try {
      const connectionId = upsertConnection(db, {
        provider: "plaid",
        providerItemId: "item-remove",
        accessToken: "access-remove",
        environment: "sandbox"
      });
      const itemRemove = vi.fn().mockResolvedValue({ data: { removed: true } });

      const result = await disconnectPlaidConnection(db, { itemRemove }, connectionId, {
        actor: "test",
        disconnectedAt: "2026-06-01T00:00:00.000Z"
      });
      const auditCount = (db
        .prepare("SELECT count(*) AS count FROM audit_log WHERE action = 'connection.disconnect'")
        .get() as { count: number }).count;

      expect(result).toEqual({
        connectionId,
        removedRemote: true,
        removedLocal: true
      });
      expect(itemRemove).toHaveBeenCalledWith({ access_token: "access-remove" });
      expect(listConnections(db)).toHaveLength(0);
      expect(auditCount).toBe(1);
    } finally {
      db.close();
    }
  });
});
