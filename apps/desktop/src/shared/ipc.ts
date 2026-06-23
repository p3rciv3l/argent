export type ViewName =
  | "dashboard"
  | "transactions"
  | "budgets"
  | "accounts"
  | "recurrings"
  | "investments"
  | "liabilities"
  | "proposals";

export interface DesktopData {
  dashboard: Record<string, unknown>;
  cashFlow: Array<Record<string, unknown>>;
  transactions: Array<Record<string, unknown>>;
  budgets: Array<Record<string, unknown>>;
  accounts: Array<Record<string, unknown>>;
  recurrings: Array<Record<string, unknown>>;
  investments: Record<string, unknown>;
  liabilities: Array<Record<string, unknown>>;
  proposals: Array<Record<string, unknown>>;
}

export interface ArgentBridge {
  loadData(): Promise<DesktopData>;
  transactions(filters: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  reviewTransactions(transactionIds: string[], status: "reviewed" | "unreviewed" | "needs_review"): Promise<{ changed: number }>;
  applyProposal(proposalId: string): Promise<{ applied: true; proposalId: string }>;
}
