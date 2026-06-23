import type { AccountLike } from "@argent/core";
import type { ConnectorModule, ConnectorSetup, ConnectorSyncOptions, ConnectorSyncPayload } from "../types.js";
import { emptyPayload, fixturePath, numberField, readJsonFile, setupState, stringField } from "../util.js";

interface CoinbaseFixture {
  asOf: string;
  assets: Array<{
    id: string;
    name: string;
    symbol: string;
    quantity: number;
    valueAmount: number;
    currency?: string;
  }>;
}

export const coinbaseConnector: ConnectorModule = {
  definition: {
    id: "coinbase",
    name: "Coinbase",
    category: "crypto",
    status: "available",
    summary: "Read-only Coinbase holdings through OAuth or local read-only API/CDP credentials when available.",
    capabilities: ["balances", "crypto_assets", "valuation_snapshots"],
    setupFields: [{ name: "apiKey", label: "Read-only API/CDP credential", kind: "api_key", required: false, secret: true }]
  },
  buildSetup(options = {}): ConnectorSetup {
    const envToken = options.apiKeyEnv ? process.env[options.apiKeyEnv] : undefined;
    return {
      provider: "coinbase",
      providerItemId: options.providerItemId ?? options.credentialLabel ?? "local-readonly",
      connectorId: "coinbase",
      displayName: options.displayName ?? "Coinbase",
      accessToken: options.accessToken ?? envToken ?? null,
      status: options.apiKeyEnv && !envToken && !options.demo ? "needs_credentials" : "healthy",
      setupState: {
        fixturePath: options.fixturePath,
        apiKeyEnv: options.apiKeyEnv,
        credentialLabel: options.credentialLabel,
        mode: options.demo ? "demo_fixture" : "readonly_api"
      }
    };
  },
  async sync(connection, options: ConnectorSyncOptions = {}): Promise<ConnectorSyncPayload> {
    const state = setupState(connection);
    const syncedAt = options.now ?? new Date().toISOString();
    const filePath = options.fixturePath ?? stringField(state.fixturePath, fixturePath("coinbase.json"));
    const fixture = await readJsonFile<CoinbaseFixture>(filePath);
    const payload = emptyPayload(connection, "coinbase", syncedAt);
    const total = fixture.assets.reduce((sum, asset) => sum + numberField(asset.valueAmount), 0);

    payload.accounts = [
      {
        account_id: `${connection.connectionId}:portfolio`,
        name: "Coinbase Portfolio",
        type: "investment",
        subtype: "crypto",
        balances: { current: total, iso_currency_code: "USD" }
      } satisfies AccountLike
    ];
    payload.externalAssets = fixture.assets.map((asset) => ({
      assetId: `coinbase:${asset.id}`,
      connectionId: connection.connectionId,
      providerAssetId: asset.id,
      assetType: "crypto",
      name: asset.name,
      symbol: asset.symbol,
      quantity: asset.quantity,
      currency: asset.currency ?? "USD",
      metadata: { source: "coinbase" }
    }));
    payload.assetValuations = fixture.assets.map((asset) => ({
      assetId: `coinbase:${asset.id}`,
      valueAmount: asset.valueAmount,
      currency: asset.currency ?? "USD",
      asOf: fixture.asOf,
      source: "coinbase",
      rawProviderPayload: { id: asset.id, symbol: asset.symbol }
    }));

    return payload;
  }
};
