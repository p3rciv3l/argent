import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import type { PlaidConfig } from "./config.js";

export function createPlaidClient(config: PlaidConfig): PlaidApi {
  const environments = PlaidEnvironments as Record<string, string>;
  const basePath = environments[config.env];
  if (!basePath) {
    throw new Error(`Plaid environment ${config.env} is not supported by the installed Plaid SDK.`);
  }
  const configuration = new Configuration({
    basePath,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": config.clientId,
        "PLAID-SECRET": config.secret,
        "Plaid-Version": config.plaidVersion
      }
    }
  });
  return new PlaidApi(configuration);
}
