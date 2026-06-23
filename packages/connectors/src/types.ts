import type {
  AccountLike,
  AssetValuationInput,
  ConnectionRecord,
  ExternalAssetInput,
  MerchantOrderInput,
  NormalizedTransaction,
  RemovedTransactionLike
} from "@argent/core";

export type ConnectorCategory = "banks" | "cash_apps" | "shopping" | "crypto" | "real_estate" | "investments";
export type ConnectorStatus = "available" | "partner_required" | "planned" | "blocked";
export type ConnectorSetupKind = "oauth" | "api_key" | "wallet_address" | "property_address" | "local_session" | "mailbox";

export interface ConnectorSetupField {
  name: string;
  label: string;
  kind: ConnectorSetupKind;
  required: boolean;
  secret?: boolean;
}

export interface ConnectorDefinition {
  id: string;
  name: string;
  category: ConnectorCategory;
  status: ConnectorStatus;
  summary: string;
  capabilities: string[];
  setupFields: ConnectorSetupField[];
  partnerRequired?: boolean;
  docsUrl?: string;
}

export interface ConnectorSetupOptions {
  demo?: boolean;
  fixturePath?: string;
  providerItemId?: string;
  displayName?: string;
  accessToken?: string | null;
  apiKeyEnv?: string;
  credentialLabel?: string;
  chain?: string;
  address?: string;
  propertyAddress?: string;
}

export interface ConnectorSetup {
  provider: string;
  providerItemId: string;
  connectorId: string;
  displayName: string;
  accessToken?: string | null;
  environment?: string | null;
  institutionName?: string | null;
  status?: string;
  setupState: Record<string, unknown>;
}

export interface ConnectorSyncOptions {
  fixturePath?: string;
  now?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ConnectorSyncPayload {
  connectionId: string;
  provider: string;
  syncedAt: string;
  accounts: AccountLike[];
  added: NormalizedTransaction[];
  modified: NormalizedTransaction[];
  removed: RemovedTransactionLike[];
  orders: MerchantOrderInput[];
  externalAssets: ExternalAssetInput[];
  assetValuations: AssetValuationInput[];
  cursor?: string | null;
}

export interface ConnectorModule {
  definition: ConnectorDefinition;
  buildSetup(options?: ConnectorSetupOptions): ConnectorSetup;
  sync(connection: ConnectionRecord, options?: ConnectorSyncOptions): Promise<ConnectorSyncPayload>;
}
