import type { AccountLike } from "@argent/core";
import type { ConnectorModule, ConnectorSetup, ConnectorSyncOptions, ConnectorSyncPayload } from "../types.js";
import { emptyPayload, fixturePath, readJsonFile, setupState, stringField, transaction } from "../util.js";

interface CashReceiptFixture {
  receipts: Array<{
    id: string;
    provider: "venmo" | "paypal" | "cash_app";
    date: string;
    description: string;
    counterparty?: string;
    amount: number;
    currency?: string;
    direction: "sent" | "received";
  }>;
}

const providerLabels: Record<string, string> = {
  venmo: "Venmo",
  paypal: "PayPal",
  cash_app: "Cash App"
};

export const cashReceiptsConnector: ConnectorModule = {
  definition: {
    id: "cash-app-receipts",
    name: "Cash app receipt mailbox",
    category: "cash_apps",
    status: "available",
    summary: "Imports official Venmo, PayPal, and Cash App receipt emails from a configured local mailbox source.",
    capabilities: ["receipt_transactions", "internal_transfer_matching"],
    setupFields: [{ name: "mailbox", label: "Mailbox access", kind: "mailbox", required: true }]
  },
  buildSetup(options = {}): ConnectorSetup {
    return {
      provider: "cash_app_receipts",
      providerItemId: options.providerItemId ?? "local-mailbox",
      connectorId: "cash-app-receipts",
      displayName: options.displayName ?? "Cash app receipts",
      status: "healthy",
      setupState: {
        fixturePath: options.fixturePath,
        providers: ["venmo", "paypal", "cash_app"],
        mode: options.demo ? "demo_fixture" : "mailbox"
      }
    };
  },
  async sync(connection, options: ConnectorSyncOptions = {}): Promise<ConnectorSyncPayload> {
    const state = setupState(connection);
    const syncedAt = options.now ?? new Date().toISOString();
    const filePath = options.fixturePath ?? stringField(state.fixturePath, fixturePath("cash-receipts.json"));
    const fixture = await readJsonFile<CashReceiptFixture>(filePath);
    const providers = new Set(
      Array.isArray(state.providers) ? state.providers.filter((provider): provider is string => typeof provider === "string") : []
    );
    const selected = providers.size > 0 ? fixture.receipts.filter((receipt) => providers.has(receipt.provider)) : fixture.receipts;
    const payload = emptyPayload(connection, "cash_app_receipts", syncedAt);
    const accountIds = new Set<string>();

    for (const receipt of selected) {
      const accountId = `${connection.connectionId}:${receipt.provider}`;
      const merchantName = receipt.counterparty ?? providerLabels[receipt.provider] ?? null;
      accountIds.add(receipt.provider);
      payload.added.push(
        transaction({
          connection,
          transactionId: `cash-receipt:${receipt.provider}:${receipt.id}`,
          accountId,
          date: receipt.date,
          name: receipt.description,
          merchantName,
          amount: receipt.direction === "received" ? -receipt.amount : receipt.amount,
          currency: receipt.currency ?? "USD",
          source: receipt.provider,
          raw: {
            id: receipt.id,
            provider: receipt.provider,
            date: receipt.date,
            amount: receipt.amount,
            direction: receipt.direction
          },
          syncedAt
        })
      );
    }

    payload.accounts = [...accountIds].map((provider): AccountLike => ({
      account_id: `${connection.connectionId}:${provider}`,
      name: providerLabels[provider] ?? provider,
      type: "cash_app",
      subtype: provider,
      balances: { current: null, iso_currency_code: "USD" }
    }));

    return payload;
  }
};
