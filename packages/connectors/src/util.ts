import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ConnectionRecord, NormalizedTransaction } from "@argent/core";
import type { ConnectorSyncPayload } from "./types.js";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function fixturePath(name: string): string {
  return path.resolve(sourceRoot, "fixtures", name);
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

export function setupState(connection: ConnectionRecord): Record<string, unknown> {
  if (!connection.setupStateJson) {
    return {};
  }
  const parsed = JSON.parse(connection.setupStateJson) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

export function stringField(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

export function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function numberField(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function transaction(input: {
  connection: ConnectionRecord;
  transactionId: string;
  accountId: string;
  date: string;
  name: string;
  merchantName?: string | null;
  amount: number;
  currency?: string | null;
  source: string;
  raw: unknown;
  syncedAt: string;
}): NormalizedTransaction {
  return {
    transactionId: input.transactionId,
    connectionId: input.connection.connectionId,
    accountId: input.accountId,
    date: input.date,
    authorizedDate: null,
    name: input.name,
    merchantName: input.merchantName ?? null,
    amount: input.amount,
    direction: input.amount < 0 ? "credit" : "debit",
    transactionType: input.amount < 0 ? "income" : "regular",
    isoCurrencyCode: input.currency ?? "USD",
    providerCategoryPrimary: null,
    providerCategoryDetailed: null,
    categoryConfidence: null,
    paymentChannel: "online",
    locationAddress: null,
    locationCity: null,
    locationRegion: null,
    locationPostalCode: null,
    locationCountry: null,
    lat: null,
    lon: null,
    source: input.source,
    rawProviderPayload: JSON.stringify(input.raw),
    enrichmentState: null,
    lastSyncedAt: input.syncedAt,
    updatedAt: input.syncedAt
  };
}

export function emptyPayload(connection: ConnectionRecord, provider: string, syncedAt: string): ConnectorSyncPayload {
  return {
    connectionId: connection.connectionId,
    provider,
    syncedAt,
    accounts: [],
    added: [],
    modified: [],
    removed: [],
    orders: [],
    externalAssets: [],
    assetValuations: [],
    cursor: null
  };
}
