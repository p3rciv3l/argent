import { describe, expect, test } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createArgentMcpServer } from "../src/index.js";

describe("mcp server", () => {
  test("constructs the Argent MCP server", () => {
    expect(createArgentMcpServer()).toBeTruthy();
  });

  test("serves read and proposal tools over stdio", async () => {
    const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-mcp-"));
    const databasePath = path.join(tmpdir, "state.sqlite");
    const client = new Client({
      name: "argent-test-client",
      version: "0.1.0"
    });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve(process.cwd(), "dist/index.js")],
      env: {
        ...process.env,
        ARGENT_HOME: path.join(tmpdir, "home")
      },
      stderr: "pipe"
    });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name);
      expect(names).toEqual(expect.arrayContaining(["argent_dashboard", "argent_transactions", "argent_liabilities", "argent_apply_proposal"]));

      const dashboard = await client.callTool({
        name: "argent_dashboard",
        arguments: { databasePath }
      });
      expect(JSON.stringify(dashboard.content)).toContain("reviewQueueCount");

      const proposal = await client.callTool({
        name: "argent_propose_budget",
        arguments: {
          databasePath,
          categoryName: "Groceries",
          amount: 500,
          month: "2026-06",
          reason: "Contract test budget proposal.",
          confidence: 1
        }
      });
      expect(JSON.stringify(proposal.content)).toContain("proposalId");
    } finally {
      await client.close();
      fs.rmSync(tmpdir, { recursive: true, force: true });
    }
  });
});
