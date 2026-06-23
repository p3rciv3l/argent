import type {
  AccountLike,
  AccountRecord,
  Direction,
  NormalizedTransaction,
  PlaidTransactionLike,
  ProviderName,
  TransactionType
} from "./types.js";

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function getTransactionDirection(amount: number): Direction {
  return amount >= 0 ? "debit" : "credit";
}

export function defaultTransactionType(amount: number): TransactionType {
  return amount < 0 ? "income" : "regular";
}

function storedProviderPayload(transaction: PlaidTransactionLike): string {
  const { pending, pending_transaction_id, ...storedTransaction } = transaction;
  void pending;
  void pending_transaction_id;
  return JSON.stringify(storedTransaction);
}

export function normalizeTransaction(
  transaction: PlaidTransactionLike,
  connectionId: string,
  syncedAt: string,
  source: ProviderName = "plaid"
): NormalizedTransaction {
  const location = transaction.location ?? {};
  const personalFinanceCategory = transaction.personal_finance_category ?? {};

  return {
    transactionId: transaction.transaction_id,
    connectionId,
    accountId: transaction.account_id,
    date: transaction.date,
    authorizedDate: nullableString(transaction.authorized_date),
    name: nullableString(transaction.name),
    merchantName: nullableString(transaction.merchant_name),
    amount: transaction.amount,
    direction: getTransactionDirection(transaction.amount),
    transactionType: defaultTransactionType(transaction.amount),
    isoCurrencyCode: nullableString(transaction.iso_currency_code),
    providerCategoryPrimary: nullableString(personalFinanceCategory.primary),
    providerCategoryDetailed: nullableString(personalFinanceCategory.detailed),
    categoryConfidence: nullableString(personalFinanceCategory.confidence_level),
    paymentChannel: nullableString(transaction.payment_channel),
    locationAddress: nullableString(location.address),
    locationCity: nullableString(location.city),
    locationRegion: nullableString(location.region),
    locationPostalCode: nullableString(location.postal_code),
    locationCountry: nullableString(location.country),
    lat: nullableNumber(location.lat),
    lon: nullableNumber(location.lon),
    source,
    rawProviderPayload: storedProviderPayload(transaction),
    enrichmentState: null,
    lastSyncedAt: syncedAt,
    updatedAt: syncedAt
  };
}

export function normalizeAccount(account: AccountLike, connectionId: string, syncedAt: string): AccountRecord {
  const balances = account.balances ?? {};
  return {
    accountId: account.account_id,
    connectionId,
    name: nullableString(account.name),
    officialName: nullableString(account.official_name),
    type: nullableString(account.type),
    subtype: nullableString(account.subtype),
    mask: nullableString(account.mask),
    isoCurrencyCode: nullableString(balances.iso_currency_code),
    unofficialCurrencyCode: nullableString(balances.unofficial_currency_code),
    balanceAvailable: nullableNumber(balances.available),
    balanceCurrent: nullableNumber(balances.current),
    balanceLimit: nullableNumber(balances.limit),
    balanceAsOf: syncedAt,
    hiddenAt: null,
    closedAt: null,
    excludedAt: null,
    updatedAt: syncedAt
  };
}
