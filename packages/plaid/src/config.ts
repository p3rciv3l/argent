export type PlaidEnvName = "sandbox" | "development" | "production";

export interface PlaidConfig {
  clientId: string;
  secret: string;
  env: PlaidEnvName;
  clientName: string;
  clientUserId: string;
  redirectUri: string | null;
  webhookUrl: string | null;
  plaidVersion: string;
}

function optionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function requiredEnv(name: string): string {
  const value = optionalEnv(name);
  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value;
}

export function getPlaidConfig(): PlaidConfig {
  const env = (process.env.PLAID_ENV || "sandbox").trim() as PlaidEnvName;
  if (!["sandbox", "development", "production"].includes(env)) {
    throw new Error("PLAID_ENV must be one of sandbox, development, or production.");
  }
  return {
    clientId: requiredEnv("PLAID_CLIENT_ID"),
    secret: requiredEnv("PLAID_SECRET"),
    env,
    clientName: process.env.PLAID_CLIENT_NAME || "Argent",
    clientUserId: process.env.PLAID_CLIENT_USER_ID || "local-user",
    redirectUri: optionalEnv("PLAID_REDIRECT_URI"),
    webhookUrl: optionalEnv("PLAID_WEBHOOK_URL"),
    plaidVersion: process.env.PLAID_VERSION || "2020-09-14"
  };
}
