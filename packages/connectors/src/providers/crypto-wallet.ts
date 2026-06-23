import type { ConnectorModule, ConnectorSetup, ConnectorSyncOptions, ConnectorSyncPayload } from "../types.js";
import { emptyPayload, fixturePath, readJsonFile, setupState, stringField } from "../util.js";

interface WalletFixture {
  asOf: string;
  wallets: Array<{
    chain: string;
    address: string;
    label: string;
    assets: Array<{
      id: string;
      name: string;
      symbol: string;
      quantity: number;
      valueAmount: number;
      currency?: string;
    }>;
  }>;
}

export const cryptoWalletConnector: ConnectorModule = {
  definition: {
    id: "crypto-wallet",
    name: "Crypto wallet address",
    category: "crypto",
    status: "available",
    summary: "Tracks BTC and ETH wallet addresses with no private keys or signing permissions.",
    capabilities: ["wallet_balances", "valuation_snapshots"],
    setupFields: [{ name: "address", label: "Wallet address", kind: "wallet_address", required: true }]
  },
  buildSetup(options = {}): ConnectorSetup {
    const chain = options.chain ?? "eth";
    const address = options.address ?? "0x0000000000000000000000000000000000000000";
    return {
      provider: "crypto_wallet",
      providerItemId: `${chain}:${address}`,
      connectorId: "crypto-wallet",
      displayName: options.displayName ?? `${chain.toUpperCase()} wallet`,
      status: "healthy",
      setupState: {
        fixturePath: options.fixturePath,
        chain,
        address,
        mode: options.demo ? "demo_fixture" : "public_chain_api"
      }
    };
  },
  async sync(connection, options: ConnectorSyncOptions = {}): Promise<ConnectorSyncPayload> {
    const state = setupState(connection);
    const syncedAt = options.now ?? new Date().toISOString();
    const filePath = options.fixturePath ?? stringField(state.fixturePath, fixturePath("crypto-wallets.json"));
    const fixture = await readJsonFile<WalletFixture>(filePath);
    const chain = stringField(state.chain, "");
    const address = stringField(state.address, "");
    const wallets = fixture.wallets.filter((wallet) =>
      chain && address ? wallet.chain === chain && wallet.address.toLowerCase() === address.toLowerCase() : true
    );
    const payload = emptyPayload(connection, "crypto_wallet", syncedAt);

    for (const wallet of wallets) {
      for (const asset of wallet.assets) {
        const assetId = `wallet:${wallet.chain}:${wallet.address}:${asset.id}`;
        payload.externalAssets.push({
          assetId,
          connectionId: connection.connectionId,
          providerAssetId: `${wallet.chain}:${wallet.address}:${asset.id}`,
          assetType: "crypto",
          name: `${wallet.label} ${asset.name}`,
          symbol: asset.symbol,
          quantity: asset.quantity,
          currency: asset.currency ?? "USD",
          address: wallet.address,
          metadata: { chain: wallet.chain, noPrivateKeys: true }
        });
        payload.assetValuations.push({
          assetId,
          valueAmount: asset.valueAmount,
          currency: asset.currency ?? "USD",
          asOf: fixture.asOf,
          source: "public_chain_fixture",
          rawProviderPayload: { chain: wallet.chain, symbol: asset.symbol }
        });
      }
    }

    return payload;
  }
};
