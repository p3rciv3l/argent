import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function runCli(args: string[], env: NodeJS.ProcessEnv): string {
  return execFileSync(process.execPath, [path.resolve(process.cwd(), "dist/main.js"), ...args], {
    cwd: path.resolve(process.cwd(), "../.."),
    env,
    encoding: "utf8"
  });
}

describe("cli smoke", () => {
  test("initializes, mock syncs, detects/apply proposals, and reports", () => {
    const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-cli-"));
    const env = {
      ...process.env,
      ARGENT_HOME: path.join(tmpdir, "home")
    };
    const databasePath = path.join(tmpdir, "state.sqlite");

    try {
      const init = JSON.parse(runCli(["init", "--db", databasePath, "--json"], env)) as {
        databasePath: string;
      };
      expect(init.databasePath).toBe(databasePath);

      const sync = JSON.parse(runCli(["sync", "plaid", "--mock", "--db", databasePath, "--json"], env)) as {
        added: number;
      };
      expect(sync.added).toBe(5);
      const connections = JSON.parse(runCli(["connections", "list", "--db", databasePath, "--json"], env)) as Array<{
        provider: string;
        accessToken?: string;
        hasAccessToken: boolean;
      }>;
      expect(connections).toHaveLength(1);
      expect(connections[0]).toMatchObject({ provider: "mock", hasAccessToken: true });
      expect(connections[0]).not.toHaveProperty("accessToken");

      const recurring = JSON.parse(runCli(["recurrings", "detect", "--db", databasePath, "--json"], env)) as {
        proposalsCreated: number;
      };
      expect(recurring.proposalsCreated).toBe(1);

      const proposals = JSON.parse(runCli(["proposals", "list", "--db", databasePath, "--json"], env)) as Array<{
        proposalId: string;
      }>;
      expect(proposals).toHaveLength(1);
      const apply = JSON.parse(runCli(["proposals", "apply", proposals[0]!.proposalId, "--db", databasePath, "--json"], env)) as {
        applied: boolean;
      };
      expect(apply.applied).toBe(true);

      const dashboard = JSON.parse(runCli(["report", "dashboard", "--db", databasePath, "--json"], env)) as {
        monthIncome: number;
      };
      expect(dashboard.monthIncome).toBe(3200);
      const liabilities = JSON.parse(runCli(["report", "liabilities", "--db", databasePath, "--json"], env)) as unknown[];
      expect(liabilities).toEqual([]);

      const catalog = JSON.parse(runCli(["connectors", "catalog", "--json"], env)) as Array<{ id: string; status: string }>;
      expect(catalog.map((connector) => connector.id)).toEqual(expect.arrayContaining(["amazon-orders", "coinbase", "crypto-wallet"]));

      const setup = JSON.parse(runCli(["connectors", "setup", "coinbase", "--demo", "--db", databasePath, "--json"], env)) as {
        connectionId: string;
        accessToken?: string;
        hasAccessToken: boolean;
        setupState: Record<string, unknown>;
      };
      expect(setup.connectionId).toContain("coinbase");
      expect(setup.hasAccessToken).toBe(false);
      expect(setup).not.toHaveProperty("accessToken");
      expect(setup.setupState).toMatchObject({ mode: "demo_fixture" });

      const connectorSync = JSON.parse(runCli(["connectors", "sync", setup.connectionId, "--db", databasePath, "--json"], env)) as {
        status: string;
        externalAssets: number;
        assetValuations: number;
      };
      expect(connectorSync).toMatchObject({ status: "succeeded", externalAssets: 2, assetValuations: 2 });

      const investments = JSON.parse(runCli(["report", "investments", "--db", databasePath, "--json"], env)) as {
        externalAssets: Array<Record<string, unknown>>;
      };
      expect(investments.externalAssets.some((asset) => asset.assetType === "crypto")).toBe(true);
    } finally {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    }
  }, 20_000);
});
