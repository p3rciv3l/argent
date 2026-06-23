import type { ConnectorDefinition, ConnectorModule } from "./types.js";
import { cashReceiptsConnector } from "./providers/cash-receipts.js";
import { amazonOrdersConnector } from "./providers/amazon-orders.js";
import { coinbaseConnector } from "./providers/coinbase.js";
import { cryptoWalletConnector } from "./providers/crypto-wallet.js";

export const blockedConnectorDefinitions: ConnectorDefinition[] = [
  {
    id: "plaid",
    name: "Plaid",
    category: "banks",
    status: "available",
    summary: "Existing bank, card, investment, and liability provider.",
    capabilities: ["transactions", "balances", "investments", "liabilities"],
    setupFields: [{ name: "oauth", label: "Plaid Link", kind: "oauth", required: true }]
  },
  {
    id: "mastercard-finicity",
    name: "Mastercard Open Finance / Finicity",
    category: "banks",
    status: "partner_required",
    summary: "Catalog entry only; live sync requires partner credentials.",
    capabilities: ["transactions", "balances"],
    setupFields: [{ name: "partnerCredentials", label: "Partner credentials", kind: "api_key", required: true, secret: true }],
    partnerRequired: true
  },
  {
    id: "mx",
    name: "MX",
    category: "banks",
    status: "partner_required",
    summary: "Catalog entry only; live sync requires MX partner access.",
    capabilities: ["transactions", "balances"],
    setupFields: [{ name: "partnerCredentials", label: "Partner credentials", kind: "api_key", required: true, secret: true }],
    partnerRequired: true
  },
  {
    id: "akoya",
    name: "Akoya",
    category: "banks",
    status: "partner_required",
    summary: "Catalog entry for Akoya-backed institutions such as Fidelity.",
    capabilities: ["accounts", "transactions", "investments"],
    setupFields: [{ name: "partnerCredentials", label: "Partner credentials", kind: "api_key", required: true, secret: true }],
    partnerRequired: true
  },
  {
    id: "fidelity-akoya",
    name: "Fidelity via Akoya",
    category: "investments",
    status: "partner_required",
    summary: "Routes through Akoya when partner credentials exist; Plaid remains the fallback today.",
    capabilities: ["investment_accounts", "holdings"],
    setupFields: [{ name: "akoyaAccess", label: "Akoya access", kind: "oauth", required: true }],
    partnerRequired: true
  },
  {
    id: "capital-one-direct",
    name: "Capital One Direct",
    category: "banks",
    status: "partner_required",
    summary: "Direct integration placeholder; not presented as a working connector.",
    capabilities: ["transactions", "balances"],
    setupFields: [{ name: "partnerCredentials", label: "Partner credentials", kind: "api_key", required: true, secret: true }],
    partnerRequired: true
  },
  {
    id: "public",
    name: "Public",
    category: "investments",
    status: "partner_required",
    summary: "Catalog entry for Public API access when approved credentials exist.",
    capabilities: ["holdings", "investment_transactions"],
    setupFields: [{ name: "apiKey", label: "API key", kind: "api_key", required: true, secret: true }],
    partnerRequired: true
  },
  {
    id: "apple-financekit",
    name: "Apple FinanceKit",
    category: "banks",
    status: "blocked",
    summary: "Requires an iOS app flow; Electron-only setup is not claimed.",
    capabilities: ["apple_card", "apple_cash", "apple_savings"],
    setupFields: [{ name: "iosFlow", label: "iOS app flow", kind: "oauth", required: true }]
  },
  {
    id: "zillow",
    name: "Zillow",
    category: "real_estate",
    status: "planned",
    summary: "Tracked as a later best-effort connector because there is no stable public Zillow API path.",
    capabilities: ["home_value"],
    setupFields: [{ name: "url", label: "Property URL", kind: "property_address", required: true }]
  },
  {
    id: "angellist",
    name: "AngelList",
    category: "investments",
    status: "planned",
    summary: "Tracked for later private-market support when API or document sources are confirmed.",
    capabilities: ["private_assets"],
    setupFields: [{ name: "apiKey", label: "API key", kind: "api_key", required: true, secret: true }]
  }
];

export const connectorModules: ConnectorModule[] = [
  cashReceiptsConnector,
  amazonOrdersConnector,
  coinbaseConnector,
  cryptoWalletConnector
];

export function listConnectorDefinitions(): ConnectorDefinition[] {
  return [...connectorModules.map((module) => module.definition), ...blockedConnectorDefinitions];
}

export function getConnectorModule(connectorId: string): ConnectorModule | null {
  return connectorModules.find((module) => module.definition.id === connectorId) ?? null;
}
