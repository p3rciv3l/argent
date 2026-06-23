import http from "node:http";
import express from "express";
import getPort from "get-port";
import open from "open";
import type { PlaidApi } from "plaid";
import { CountryCode, Products } from "plaid";
import {
  findDuplicateConnection,
  openDatabase,
  upsertAccounts,
  upsertConnection,
  type SqliteDatabase
} from "@argent/core";
import type { PlaidConfig } from "./config.js";
import { createPlaidClient } from "./client.js";
import { getPlaidConfig } from "./config.js";

export interface LinkOptions {
  port?: number;
  noBrowser?: boolean;
  databasePath?: string;
}

export interface LinkSuccessMetadata {
  institution?: {
    institution_id?: string;
    name?: string;
  } | null;
  link_session_id?: string;
}

function renderLinkPage(linkToken: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Argent Plaid Link</title>
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 3rem; color: #17202a; }
      button { font: inherit; padding: 0.65rem 0.9rem; border: 1px solid #17202a; background: #17202a; color: white; cursor: pointer; }
      #status { margin-top: 1rem; max-width: 42rem; line-height: 1.45; }
    </style>
  </head>
  <body>
    <h1>Connect Account</h1>
    <button id="link">Open Plaid Link</button>
    <p id="status">Waiting to start.</p>
    <script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
    <script>
      const status = document.getElementById("status");
      const handler = Plaid.create({
        token: ${JSON.stringify(linkToken)},
        onSuccess: async (public_token, metadata) => {
          status.textContent = "Exchanging token and storing local metadata...";
          const response = await fetch("/exchange", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ public_token, metadata })
          });
          if (!response.ok) {
            status.textContent = await response.text() || "Token exchange failed.";
            return;
          }
          status.textContent = "Linked. You can close this tab and return to the terminal.";
        },
        onExit: (err) => {
          status.textContent = err ? err.display_message || err.error_message : "Plaid Link exited.";
        }
      });
      document.getElementById("link").addEventListener("click", () => handler.open());
    </script>
  </body>
</html>`;
}

async function listen(server: http.Server, preferredPort: number): Promise<number> {
  const port = await getPort({ port: preferredPort });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  return port;
}

export async function createLinkToken(client: PlaidApi, config: PlaidConfig): Promise<string> {
  const response = await client.linkTokenCreate({
    user: { client_user_id: config.clientUserId },
    client_name: config.clientName,
    products: [Products.Transactions, Products.Investments, Products.Liabilities],
    country_codes: [CountryCode.Us],
    language: "en",
    transactions: { days_requested: 730 },
    ...(config.redirectUri ? { redirect_uri: config.redirectUri } : {}),
    ...(config.webhookUrl ? { webhook: config.webhookUrl } : {})
  });
  return response.data.link_token;
}

export async function exchangeAndStorePublicToken(
  db: SqliteDatabase,
  client: PlaidApi,
  config: PlaidConfig,
  publicToken: string,
  metadata: LinkSuccessMetadata = {}
): Promise<string> {
  const exchange = await client.itemPublicTokenExchange({ public_token: publicToken });
  const accessToken = exchange.data.access_token;
  const itemId = exchange.data.item_id;
  const now = new Date().toISOString();
  const institutionId = metadata.institution?.institution_id ?? null;
  const institutionName = metadata.institution?.name ?? null;
  const accounts = await client.accountsBalanceGet({ access_token: accessToken });
  const duplicate = findDuplicateConnection(db, {
    accounts: accounts.data.accounts,
    institutionId,
    provider: "plaid",
    environment: config.env,
    excludingConnectionId: itemId
  });

  if (duplicate) {
    await client.itemRemove({ access_token: accessToken }).catch(() => undefined);
    const label = institutionName ?? "This institution";
    throw new Error(`${label} is already linked locally as ${duplicate.connectionId}; no duplicate was stored.`);
  }

  const connectionId = upsertConnection(
    db,
    {
      connectionId: itemId,
      provider: "plaid",
      providerItemId: itemId,
      accessToken,
      institutionId,
      institutionName,
      linkSessionId: metadata.link_session_id ?? null,
      environment: config.env,
      cursor: null
    },
    now
  );
  upsertAccounts(db, accounts.data.accounts, connectionId, now);
  return connectionId;
}

export async function startPlaidLink(options: LinkOptions = {}): Promise<void> {
  const config = getPlaidConfig();
  const client = createPlaidClient(config);
  const linkToken = await createLinkToken(client, config);
  const db = openDatabase(options.databasePath);
  const app = express();
  const preferredPort = options.port ?? 3000;

  let complete!: () => void;
  let fail!: (error: Error) => void;
  const completion = new Promise<void>((resolve, reject) => {
    complete = resolve;
    fail = reject;
  });

  app.use(express.json());
  app.get("/", (_request, response) => {
    response.type("html").send(renderLinkPage(linkToken));
  });
  app.post("/exchange", async (request, response) => {
    try {
      const publicToken = request.body?.public_token;
      if (typeof publicToken !== "string" || !publicToken) {
        response.status(400).send("Missing public token.");
        return;
      }
      const metadata = (request.body?.metadata ?? {}) as LinkSuccessMetadata;
      const connectionId = await exchangeAndStorePublicToken(db, client, config, publicToken, metadata);
      response.json({ ok: true, connection_id: connectionId });
      complete();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.status(500).send(message);
      fail(error instanceof Error ? error : new Error(message));
    }
  });

  const server = http.createServer(app);
  const port = await listen(server, preferredPort);
  const url = `http://127.0.0.1:${port}`;
  console.log(`Plaid Link is running at ${url}`);
  if (!options.noBrowser) {
    await open(url);
  }

  try {
    await completion;
    console.log("Plaid connection stored locally.");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
}
