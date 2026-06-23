import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  applyAgentProposal,
  createAgentProposal,
  getAccounts,
  getBudgets,
  getCashFlow,
  getDashboard,
  getInvestments,
  getLiabilities,
  getRecurrings,
  listAgentProposals,
  listTransactions,
  openDatabase
} from "@argent/core";
import type { TransactionFilters } from "@argent/core";

const databasePathShape = {
  databasePath: z.string().optional().describe("Optional path to the local Argent SQLite database.")
};

function withDb<T>(databasePath: string | undefined, fn: (db: ReturnType<typeof openDatabase>) => T): T {
  const db = openDatabase(databasePath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function jsonContent(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function cleanTransactionFilters(filters: Record<string, unknown>): TransactionFilters {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) {
      cleaned[key] = value;
    }
  }
  return cleaned as TransactionFilters;
}

export function createArgentMcpServer(): McpServer {
  const server = new McpServer({
    name: "argent",
    version: "0.1.0"
  });

  server.registerTool(
    "argent_dashboard",
    {
      title: "Argent Dashboard",
      description: "Read the local Argent dashboard snapshot.",
      inputSchema: databasePathShape
    },
    ({ databasePath }) => jsonContent(withDb(databasePath, (db) => getDashboard(db)))
  );

  server.registerTool(
    "argent_accounts",
    {
      title: "Argent Accounts",
      description: "Read local account and connection state.",
      inputSchema: databasePathShape
    },
    ({ databasePath }) => jsonContent(withDb(databasePath, (db) => getAccounts(db)))
  );

  server.registerTool(
    "argent_transactions",
    {
      title: "Argent Transactions",
      description: "Read local transactions with filters.",
      inputSchema: {
        ...databasePathShape,
        accountId: z.string().optional(),
        categoryId: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        recurringId: z.string().optional(),
        reviewStatus: z.enum(["unreviewed", "reviewed", "needs_review"]).optional(),
        tag: z.string().optional(),
        type: z.enum(["regular", "income", "internal_transfer", "excluded", "recurring_linked"]).optional(),
        search: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional()
      }
    },
    ({ databasePath, ...filters }) =>
      jsonContent(
        withDb(databasePath, (db) =>
          listTransactions(db, cleanTransactionFilters({ ...filters, limit: filters.limit ?? 100 }))
        )
      )
  );

  server.registerTool(
    "argent_cash_flow",
    {
      title: "Argent Cash Flow",
      description: "Read monthly income, spending, and net cash flow.",
      inputSchema: {
        ...databasePathShape,
        months: z.number().int().min(1).max(60).optional()
      }
    },
    ({ databasePath, months }) => jsonContent(withDb(databasePath, (db) => getCashFlow(db, months ?? 12)))
  );

  server.registerTool(
    "argent_budgets",
    {
      title: "Argent Budgets",
      description: "Read local budgets for a month.",
      inputSchema: {
        ...databasePathShape,
        month: z.string().optional()
      }
    },
    ({ databasePath, month }) => jsonContent(withDb(databasePath, (db) => getBudgets(db, month)))
  );

  server.registerTool(
    "argent_recurrings",
    {
      title: "Argent Recurrings",
      description: "Read detected or confirmed recurring charges.",
      inputSchema: databasePathShape
    },
    ({ databasePath }) => jsonContent(withDb(databasePath, (db) => getRecurrings(db)))
  );

  server.registerTool(
    "argent_investments",
    {
      title: "Argent Investments",
      description: "Read investment holdings and investment transaction summaries.",
      inputSchema: databasePathShape
    },
    ({ databasePath }) => jsonContent(withDb(databasePath, (db) => getInvestments(db)))
  );

  server.registerTool(
    "argent_liabilities",
    {
      title: "Argent Liabilities",
      description: "Read local credit, loan, and liability details including due dates and utilization.",
      inputSchema: databasePathShape
    },
    ({ databasePath }) => jsonContent(withDb(databasePath, (db) => getLiabilities(db)))
  );

  server.registerTool(
    "argent_list_proposals",
    {
      title: "Argent Proposals",
      description: "Read pending, applied, or rejected agent proposals.",
      inputSchema: {
        ...databasePathShape,
        status: z.enum(["pending", "applied", "rejected"]).optional()
      }
    },
    ({ databasePath, status }) => jsonContent(withDb(databasePath, (db) => listAgentProposals(db, status ?? "pending")))
  );

  server.registerTool(
    "argent_propose_category_change",
    {
      title: "Propose Category Change",
      description: "Create a pending local proposal to change transaction categories.",
      inputSchema: {
        ...databasePathShape,
        transactionIds: z.array(z.string()).min(1),
        categoryName: z.string().min(1),
        reason: z.string().min(1),
        confidence: z.number().min(0).max(1).optional(),
        source: z.string().optional()
      }
    },
    ({ databasePath, transactionIds, categoryName, reason, confidence, source }) =>
      jsonContent(
        withDb(databasePath, (db) => ({
          proposalId: createAgentProposal(db, {
            kind: "category_change",
            source: source ?? "mcp.agent",
            confidence: confidence ?? null,
            reason,
            payload: { transactionIds, categoryName }
          })
        }))
      )
  );

  server.registerTool(
    "argent_propose_rule",
    {
      title: "Propose Rule",
      description: "Create a pending local proposal for a transaction rule.",
      inputSchema: {
        ...databasePathShape,
        name: z.string().min(1),
        match: z.record(z.string(), z.unknown()),
        set: z.record(z.string(), z.unknown()),
        reason: z.string().min(1),
        confidence: z.number().min(0).max(1).optional(),
        source: z.string().optional()
      }
    },
    ({ databasePath, name, match, set, reason, confidence, source }) =>
      jsonContent(
        withDb(databasePath, (db) => ({
          proposalId: createAgentProposal(db, {
            kind: "rule",
            source: source ?? "mcp.agent",
            confidence: confidence ?? null,
            reason,
            payload: { name, match, set }
          })
        }))
      )
  );

  server.registerTool(
    "argent_propose_budget",
    {
      title: "Propose Budget",
      description: "Create a pending local proposal for a category budget.",
      inputSchema: {
        ...databasePathShape,
        categoryName: z.string().min(1),
        amount: z.number().nonnegative(),
        month: z.string().optional(),
        reason: z.string().min(1),
        confidence: z.number().min(0).max(1).optional(),
        source: z.string().optional()
      }
    },
    ({ databasePath, categoryName, amount, month, reason, confidence, source }) =>
      jsonContent(
        withDb(databasePath, (db) => ({
          proposalId: createAgentProposal(db, {
            kind: "budget",
            source: source ?? "mcp.agent",
            confidence: confidence ?? null,
            reason,
            payload: { categoryName, amount, month }
          })
        }))
      )
  );

  server.registerTool(
    "argent_propose_recurring",
    {
      title: "Propose Recurring",
      description: "Create a pending local proposal for a recurring charge.",
      inputSchema: {
        ...databasePathShape,
        merchantName: z.string().min(1),
        cadence: z.string().min(1),
        averageAmount: z.number().optional(),
        nextDueDate: z.string().optional(),
        reason: z.string().min(1),
        confidence: z.number().min(0).max(1).optional(),
        source: z.string().optional()
      }
    },
    ({ databasePath, merchantName, cadence, averageAmount, nextDueDate, reason, confidence, source }) =>
      jsonContent(
        withDb(databasePath, (db) => ({
          proposalId: createAgentProposal(db, {
            kind: "recurring",
            source: source ?? "mcp.agent",
            confidence: confidence ?? null,
            reason,
            payload: { merchantName, cadence, averageAmount, nextDueDate, confidence }
          })
        }))
      )
  );

  server.registerTool(
    "argent_apply_proposal",
    {
      title: "Apply Proposal",
      description: "Explicitly apply a pending Argent agent proposal and write an audit entry.",
      inputSchema: {
        ...databasePathShape,
        proposalId: z.string().min(1),
        actor: z.string().optional()
      }
    },
    ({ databasePath, proposalId, actor }) =>
      jsonContent(
        withDb(databasePath, (db) => {
          applyAgentProposal(db, proposalId, actor ?? "mcp");
          return { applied: true, proposalId };
        })
      )
  );

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createArgentMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
