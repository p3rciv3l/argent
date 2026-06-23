export type Direction = "debit" | "credit";
export type ProviderName = string;
export type ReviewStatus = "unreviewed" | "reviewed" | "needs_review";
export type TransactionType = "regular" | "income" | "internal_transfer" | "excluded" | "recurring_linked";
export type ProposalStatus = "pending" | "applied" | "rejected";
export type ProposalKind = "category_change" | "rule" | "budget" | "recurring";

export const TRANSACTION_TYPES = [
  "regular",
  "income",
  "internal_transfer",
  "excluded",
  "recurring_linked"
] as const satisfies readonly TransactionType[];

export const EXPORT_COLUMNS = [
  "date",
  "name",
  "merchant",
  "amount",
  "direction",
  "type",
  "category",
  "account",
  "currency",
  "reviewed",
  "tags",
  "source",
  "transaction_id"
] as const;

export type ExportColumn = (typeof EXPORT_COLUMNS)[number];
export type ExportValue = string | number | boolean | null;
export type ExportRow = Record<ExportColumn, ExportValue>;

export interface ArgentPaths {
  homeDir: string;
  databasePath: string;
  exportDir: string;
  exportCsvPath: string;
  rulesPath: string;
}

export interface AccountLike {
  account_id: string;
  name?: string | null;
  official_name?: string | null;
  type?: string | null;
  subtype?: string | null;
  mask?: string | null;
  balances?: {
    available?: number | null;
    current?: number | null;
    limit?: number | null;
    iso_currency_code?: string | null;
    unofficial_currency_code?: string | null;
  } | null;
}

export interface AccountRecord {
  accountId: string;
  connectionId: string;
  name: string | null;
  officialName: string | null;
  type: string | null;
  subtype: string | null;
  mask: string | null;
  isoCurrencyCode: string | null;
  unofficialCurrencyCode: string | null;
  balanceAvailable: number | null;
  balanceCurrent: number | null;
  balanceLimit: number | null;
  balanceAsOf: string;
  hiddenAt: string | null;
  closedAt: string | null;
  excludedAt: string | null;
  updatedAt: string;
}

export interface ConnectionRecord {
  connectionId: string;
  provider: ProviderName;
  providerItemId: string;
  accessToken: string | null;
  connectorId?: string | null;
  displayName?: string | null;
  environment: string | null;
  institutionId: string | null;
  institutionName: string | null;
  linkSessionId: string | null;
  cursor: string | null;
  status: string;
  consentExpirationAt: string | null;
  setupStateJson?: string | null;
  lastSyncAt?: string | null;
  lastSyncStatus?: string | null;
  lastSyncError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlaidLocationLike {
  address?: string | null;
  city?: string | null;
  region?: string | null;
  postal_code?: string | null;
  country?: string | null;
  lat?: number | null;
  lon?: number | null;
}

export interface PlaidPersonalFinanceCategoryLike {
  primary?: string | null;
  detailed?: string | null;
  confidence_level?: string | null;
}

export interface PlaidTransactionLike {
  transaction_id: string;
  account_id: string;
  date: string;
  authorized_date?: string | null;
  pending?: boolean | null;
  pending_transaction_id?: string | null;
  name?: string | null;
  merchant_name?: string | null;
  amount: number;
  iso_currency_code?: string | null;
  personal_finance_category?: PlaidPersonalFinanceCategoryLike | null;
  payment_channel?: string | null;
  location?: PlaidLocationLike | null;
}

export interface RemovedTransactionLike {
  transaction_id: string;
  account_id?: string | null;
}

export interface NormalizedTransaction {
  transactionId: string;
  connectionId: string;
  accountId: string;
  date: string;
  authorizedDate: string | null;
  name: string | null;
  merchantName: string | null;
  amount: number;
  direction: Direction;
  transactionType: TransactionType;
  isoCurrencyCode: string | null;
  providerCategoryPrimary: string | null;
  providerCategoryDetailed: string | null;
  categoryConfidence: string | null;
  paymentChannel: string | null;
  locationAddress: string | null;
  locationCity: string | null;
  locationRegion: string | null;
  locationPostalCode: string | null;
  locationCountry: string | null;
  lat: number | null;
  lon: number | null;
  source: ProviderName;
  rawProviderPayload: string;
  enrichmentState: string | null;
  lastSyncedAt: string;
  updatedAt: string;
}

export interface SyncChanges {
  connectionId: string;
  provider: ProviderName;
  added: NormalizedTransaction[];
  modified: NormalizedTransaction[];
  removed: RemovedTransactionLike[];
  cursor: string | null;
  syncedAt: string;
}

export interface MerchantOrderInput {
  orderId: string;
  connectionId: string;
  providerOrderId: string;
  merchantName: string;
  orderDate: string;
  totalAmount: number;
  currency?: string | null;
  status?: string | null;
  rawProviderPayload?: unknown;
  items?: MerchantOrderItemInput[];
}

export interface MerchantOrderItemInput {
  orderItemId: string;
  name: string;
  quantity?: number | null;
  unitPrice?: number | null;
  totalPrice?: number | null;
  category?: string | null;
  rawProviderPayload?: unknown;
}

export interface ExternalAssetInput {
  assetId: string;
  connectionId: string;
  providerAssetId: string;
  assetType: string;
  name: string;
  symbol?: string | null;
  quantity?: number | null;
  currency?: string | null;
  address?: string | null;
  metadata?: unknown;
}

export interface AssetValuationInput {
  valuationId?: string;
  assetId: string;
  valueAmount?: number | null;
  currency?: string | null;
  asOf: string;
  source: string;
  lowEstimate?: number | null;
  midEstimate?: number | null;
  highEstimate?: number | null;
  rawProviderPayload?: unknown;
}

export interface TransactionOrderMatchInput {
  transactionId: string;
  orderId: string;
  confidence: number;
  reason: string;
  matchedAt?: string;
}

export interface MockSyncFixture {
  item?: {
    item_id?: string;
    access_token?: string;
    institution_id?: string | null;
    institution_name?: string | null;
    link_session_id?: string | null;
    environment?: string | null;
  };
  accounts?: AccountLike[];
  pages: Array<{
    added?: PlaidTransactionLike[];
    modified?: PlaidTransactionLike[];
    removed?: RemovedTransactionLike[];
    next_cursor?: string | null;
    has_more?: boolean;
  }>;
}

export interface TransactionFilters {
  accountId?: string;
  categoryId?: string;
  startDate?: string;
  endDate?: string;
  recurringId?: string;
  reviewStatus?: ReviewStatus;
  tag?: string;
  type?: TransactionType;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface TransactionListRow {
  transactionId: string;
  accountId: string;
  accountName: string | null;
  date: string;
  name: string | null;
  merchantName: string | null;
  amount: number;
  direction: Direction;
  transactionType: TransactionType;
  categoryName: string | null;
  userCategory: string | null;
  reviewStatus: ReviewStatus;
  reviewedAt: string | null;
  tags: string[];
}
