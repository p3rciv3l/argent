import { randomUUID } from "node:crypto";
import type { SqliteDatabase } from "./db.js";
import { getExportRows, insertAuditLog, insertEnrichmentEvent } from "./db.js";
import type {
  ProposalKind,
  ReviewStatus,
  TransactionFilters,
  TransactionListRow,
  TransactionType
} from "./types.js";

export interface DashboardSnapshot {
  reviewQueueCount: number;
  month: string;
  monthSpent: number;
  monthIncome: number;
  monthNet: number;
  budgetProgress: Array<{ name: string; amount: number; spent: number; remaining: number }>;
  upcomingRecurringCount: number;
  connectionAttentionCount: number;
  netWorth: number;
}

export interface CashFlowPoint {
  month: string;
  spent: number;
  income: number;
  net: number;
}

export interface AgentProposalInput {
  kind: ProposalKind;
  source: string;
  confidence?: number | null;
  reason: string;
  payload: unknown;
  createdAt?: string;
}

function monthKey(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

function addMonths(month: string, offset: number): string {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const date = new Date(Date.UTC(year, monthIndex + offset, 1));
  return date.toISOString().slice(0, 7);
}

function monthStart(month: string): string {
  return `${month}-01`;
}

function addFilter(clauses: string[], params: Record<string, unknown>, filters: TransactionFilters): void {
  if (filters.accountId) {
    clauses.push("t.account_id = @accountId");
    params.accountId = filters.accountId;
  }
  if (filters.categoryId) {
    clauses.push("t.category_id = @categoryId");
    params.categoryId = filters.categoryId;
  }
  if (filters.startDate) {
    clauses.push("t.date >= @startDate");
    params.startDate = filters.startDate;
  }
  if (filters.endDate) {
    clauses.push("t.date <= @endDate");
    params.endDate = filters.endDate;
  }
  if (filters.recurringId) {
    clauses.push("t.recurring_id = @recurringId");
    params.recurringId = filters.recurringId;
  }
  if (filters.reviewStatus) {
    clauses.push("t.review_status = @reviewStatus");
    params.reviewStatus = filters.reviewStatus;
  }
  if (filters.type) {
    clauses.push("t.transaction_type = @transactionType");
    params.transactionType = filters.type;
  }
  if (filters.search) {
    clauses.push("(t.name LIKE @search OR t.merchant_name LIKE @search)");
    params.search = `%${filters.search}%`;
  }
  if (filters.tag) {
    clauses.push(`
      EXISTS (
        SELECT 1
        FROM transaction_tags ft
        JOIN tags ftag ON ftag.tag_id = ft.tag_id
        WHERE ft.transaction_id = t.transaction_id AND ftag.name = @tag
      )
    `);
    params.tag = filters.tag;
  }
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function listTransactions(db: SqliteDatabase, filters: TransactionFilters = {}): TransactionListRow[] {
  const clauses = ["t.removed_at IS NULL"];
  const params: Record<string, unknown> = {
    limit: Math.min(filters.limit ?? 100, 500),
    offset: Math.max(filters.offset ?? 0, 0)
  };
  addFilter(clauses, params, filters);
  const rows = db
    .prepare(
      `
      SELECT
        t.transaction_id AS transactionId,
        t.account_id AS accountId,
        a.name AS accountName,
        t.date,
        t.name,
        t.merchant_name AS merchantName,
        t.amount,
        t.direction,
        t.transaction_type AS transactionType,
        c.name AS categoryName,
        t.user_category AS userCategory,
        t.review_status AS reviewStatus,
        t.reviewed_at AS reviewedAt,
        COALESCE(tag_names.tags, '') AS tagNames
      FROM transactions t
      LEFT JOIN accounts a ON a.account_id = t.account_id
      LEFT JOIN categories c ON c.category_id = t.category_id
      LEFT JOIN (
        SELECT tt.transaction_id, group_concat(tags.name, '|') AS tags
        FROM transaction_tags tt
        JOIN tags ON tags.tag_id = tt.tag_id
        GROUP BY tt.transaction_id
      ) tag_names ON tag_names.transaction_id = t.transaction_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY t.date DESC, t.authorized_date DESC, t.transaction_id DESC
      LIMIT @limit OFFSET @offset
    `
    )
    .all(params) as Array<Omit<TransactionListRow, "tags"> & { tagNames: string }>;

  return rows.map((row) => {
    const { tagNames, ...transaction } = row;
    return {
      ...transaction,
      tags: tagNames ? tagNames.split("|") : []
    };
  });
}

export function getDashboard(db: SqliteDatabase, referenceDate = new Date()): DashboardSnapshot {
  const month = monthKey(referenceDate);
  const start = monthStart(month);
  const next = monthStart(addMonths(month, 1));
  const reviewQueue = db
    .prepare("SELECT count(*) AS count FROM transactions WHERE removed_at IS NULL AND review_status != 'reviewed'")
    .get() as { count: number };
  const flow = db
    .prepare(
      `
      SELECT
        COALESCE(sum(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS spent,
        COALESCE(sum(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) AS income
      FROM transactions
      WHERE removed_at IS NULL
        AND transaction_type NOT IN ('excluded', 'internal_transfer')
        AND date >= @start
        AND date < @next
    `
    )
    .get({ start, next }) as { spent: number; income: number };
  const netWorth = db
    .prepare(
      `
      SELECT COALESCE(sum(value), 0) AS value
      FROM (
        SELECT
          CASE
            WHEN type IN ('credit', 'loan') THEN -COALESCE(balance_current, 0)
            ELSE COALESCE(balance_current, 0)
          END AS value
        FROM accounts
        WHERE hidden_at IS NULL AND closed_at IS NULL AND excluded_at IS NULL

        UNION ALL

        SELECT COALESCE(av.mid_estimate, av.value_amount, 0) AS value
        FROM external_assets ea
        JOIN asset_valuations av ON av.asset_id = ea.asset_id
        JOIN (
          SELECT asset_id, max(as_of) AS as_of
          FROM asset_valuations
          GROUP BY asset_id
        ) latest ON latest.asset_id = av.asset_id AND latest.as_of = av.as_of
      )
    `
    )
    .get() as { value: number };
  const budgetProgress = getBudgets(db, month).slice(0, 6);
  const upcoming = db
    .prepare(
      `
      SELECT count(*) AS count
      FROM recurrings
      WHERE status != 'dismissed'
        AND next_due_date IS NOT NULL
        AND next_due_date >= @start
        AND next_due_date < date(@start, '+35 day')
    `
    )
    .get({ start: referenceDate.toISOString().slice(0, 10) }) as { count: number };
  const unhealthy = db
    .prepare("SELECT count(*) AS count FROM connections WHERE status != 'healthy'")
    .get() as { count: number };

  return {
    reviewQueueCount: reviewQueue.count,
    month,
    monthSpent: numeric(flow.spent),
    monthIncome: numeric(flow.income),
    monthNet: numeric(flow.income) - numeric(flow.spent),
    budgetProgress,
    upcomingRecurringCount: upcoming.count,
    connectionAttentionCount: unhealthy.count,
    netWorth: numeric(netWorth.value)
  };
}

export function getCashFlow(db: SqliteDatabase, months = 12, referenceMonth = monthKey()): CashFlowPoint[] {
  const startMonth = addMonths(referenceMonth, -(months - 1));
  const rows = db
    .prepare(
      `
      SELECT
        substr(date, 1, 7) AS month,
        COALESCE(sum(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS spent,
        COALESCE(sum(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) AS income
      FROM transactions
      WHERE removed_at IS NULL
        AND transaction_type NOT IN ('excluded', 'internal_transfer')
        AND substr(date, 1, 7) >= @startMonth
        AND substr(date, 1, 7) <= @referenceMonth
      GROUP BY substr(date, 1, 7)
    `
    )
    .all({ startMonth, referenceMonth }) as Array<{ month: string; spent: number; income: number }>;
  const byMonth = new Map(rows.map((row) => [row.month, row]));
  const result: CashFlowPoint[] = [];
  for (let offset = 0; offset < months; offset += 1) {
    const month = addMonths(startMonth, offset);
    const row = byMonth.get(month);
    const spent = numeric(row?.spent);
    const income = numeric(row?.income);
    result.push({ month, spent, income, net: income - spent });
  }
  return result;
}

export function getBudgets(
  db: SqliteDatabase,
  month = monthKey()
): Array<{ name: string; amount: number; spent: number; remaining: number }> {
  const start = monthStart(month);
  const next = monthStart(addMonths(month, 1));
  const rows = db
    .prepare(
      `
      SELECT
        COALESCE(c.name, bg.name, 'Uncategorized') AS name,
        b.amount,
        COALESCE(sum(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END), 0) AS spent
      FROM budgets b
      LEFT JOIN categories c ON c.category_id = b.category_id
      LEFT JOIN budget_groups bg ON bg.budget_group_id = b.budget_group_id
      LEFT JOIN transactions t ON t.category_id = b.category_id
        AND t.removed_at IS NULL
        AND t.transaction_type NOT IN ('excluded', 'internal_transfer')
        AND t.date >= @start
        AND t.date < @next
      WHERE b.month = @month
      GROUP BY b.budget_id
      ORDER BY bg.sort_order ASC, name ASC
    `
    )
    .all({ month, start, next }) as Array<{ name: string; amount: number; spent: number }>;
  return rows.map((row) => ({
    name: row.name,
    amount: numeric(row.amount),
    spent: numeric(row.spent),
    remaining: numeric(row.amount) - numeric(row.spent)
  }));
}

export function getAccounts(db: SqliteDatabase): Array<Record<string, unknown>> {
  return db
    .prepare(
      `
      SELECT
        a.account_id AS accountId,
        a.name,
        a.official_name AS officialName,
        a.type,
        a.subtype,
        a.mask,
        a.balance_available AS balanceAvailable,
        a.balance_current AS balanceCurrent,
        a.balance_limit AS balanceLimit,
        a.balance_as_of AS balanceAsOf,
        c.provider,
        c.institution_name AS institutionName,
        c.status AS connectionStatus
      FROM accounts a
      JOIN connections c ON c.connection_id = a.connection_id
      ORDER BY c.institution_name ASC, a.name ASC
    `
    )
    .all() as Array<Record<string, unknown>>;
}

export function getRecurrings(db: SqliteDatabase): Array<Record<string, unknown>> {
  return db
    .prepare(
      `
      SELECT
        recurring_id AS recurringId,
        merchant_name AS merchantName,
        cadence,
        average_amount AS averageAmount,
        next_due_date AS nextDueDate,
        confidence,
        status,
        source,
        updated_at AS updatedAt
      FROM recurrings
      ORDER BY next_due_date ASC, merchant_name ASC
    `
    )
    .all() as Array<Record<string, unknown>>;
}

export function getInvestments(db: SqliteDatabase): Record<string, unknown> {
  const holdings = db
    .prepare(
      `
      SELECT
        h.holding_id AS holdingId,
        a.name AS accountName,
        s.name AS securityName,
        s.ticker_symbol AS tickerSymbol,
        h.quantity,
        h.institution_value AS institutionValue,
        h.institution_price AS institutionPrice,
        h.cost_basis AS costBasis,
        h.iso_currency_code AS currency,
        h.as_of AS asOf
      FROM holdings h
      JOIN accounts a ON a.account_id = h.account_id
      JOIN securities s ON s.security_id = h.security_id
      ORDER BY h.institution_value DESC
    `
    )
    .all();
  const transactions = db
    .prepare(
      `
      SELECT
        investment_transaction_id AS investmentTransactionId,
        account_id AS accountId,
        security_id AS securityId,
        date,
        name,
        type,
        subtype,
        quantity,
        amount,
        price,
        fees,
        iso_currency_code AS currency
      FROM investment_transactions
      ORDER BY date DESC
      LIMIT 100
    `
    )
    .all();
  const externalAssets = db
    .prepare(
      `
      SELECT
        ea.asset_id AS assetId,
        ea.asset_type AS assetType,
        ea.name,
        ea.symbol,
        ea.quantity,
        ea.currency,
        ea.address,
        c.display_name AS connectionName,
        c.connector_id AS connectorId,
        av.value_amount AS valueAmount,
        av.low_estimate AS lowEstimate,
        av.mid_estimate AS midEstimate,
        av.high_estimate AS highEstimate,
        av.as_of AS asOf,
        av.source AS valuationSource
      FROM external_assets ea
      JOIN connections c ON c.connection_id = ea.connection_id
      LEFT JOIN asset_valuations av ON av.asset_id = ea.asset_id
      LEFT JOIN (
        SELECT asset_id, max(as_of) AS as_of
        FROM asset_valuations
        GROUP BY asset_id
      ) latest ON latest.asset_id = av.asset_id AND latest.as_of = av.as_of
      WHERE av.valuation_id IS NULL OR latest.asset_id IS NOT NULL
      ORDER BY COALESCE(av.mid_estimate, av.value_amount, 0) DESC, ea.name ASC
    `
    )
    .all();
  return { holdings, transactions, externalAssets };
}

export function getLiabilities(db: SqliteDatabase): Array<Record<string, unknown>> {
  return db
    .prepare(
      `
      SELECT
        l.liability_id AS liabilityId,
        l.account_id AS accountId,
        a.name AS accountName,
        c.institution_name AS institutionName,
        l.type,
        l.apr,
        l.balance,
        l.credit_limit AS creditLimit,
        CASE
          WHEN l.credit_limit IS NOT NULL AND l.credit_limit > 0
          THEN round((COALESCE(l.balance, 0) / l.credit_limit) * 100, 2)
          ELSE NULL
        END AS creditUtilization,
        l.minimum_payment_amount AS minimumPaymentAmount,
        l.next_payment_due_date AS nextPaymentDueDate,
        l.last_payment_amount AS lastPaymentAmount,
        l.last_payment_date AS lastPaymentDate,
        l.updated_at AS updatedAt
      FROM liabilities l
      JOIN accounts a ON a.account_id = l.account_id
      JOIN connections c ON c.connection_id = a.connection_id
      ORDER BY l.next_payment_due_date ASC, a.name ASC
    `
    )
    .all() as Array<Record<string, unknown>>;
}

export function reviewTransactions(
  db: SqliteDatabase,
  transactionIds: string[],
  status: ReviewStatus = "reviewed",
  actor = "user",
  reviewedAt = new Date().toISOString()
): number {
  if (transactionIds.length === 0) {
    return 0;
  }
  const update = db.prepare(`
    UPDATE transactions
    SET review_status = @status, reviewed_at = @reviewedAt, updated_at = @reviewedAt
    WHERE transaction_id = @transactionId AND removed_at IS NULL
  `);
  const insertReview = db.prepare(`
    INSERT INTO transaction_reviews (review_id, transaction_id, status, note, reviewed_by, reviewed_at)
    VALUES (@reviewId, @transactionId, @status, NULL, @actor, @reviewedAt)
  `);
  let changed = 0;
  const write = db.transaction(() => {
    for (const transactionId of transactionIds) {
      const result = update.run({ status, reviewedAt, transactionId });
      changed += result.changes;
      if (result.changes > 0) {
        insertReview.run({ reviewId: randomUUID(), transactionId, status, actor, reviewedAt });
      }
    }
    insertAuditLog(db, {
      actor,
      action: "transactions.review",
      targetType: "transaction",
      metadata: { transactionIds, status },
      createdAt: reviewedAt
    });
  });
  write();
  return changed;
}

export function createAgentProposal(db: SqliteDatabase, input: AgentProposalInput): string {
  const proposalId = randomUUID();
  db.prepare(`
    INSERT INTO agent_proposals (
      proposal_id, kind, status, source, confidence, reason, payload_json, created_at
    )
    VALUES (@proposalId, @kind, 'pending', @source, @confidence, @reason, @payloadJson, @createdAt)
  `).run({
    proposalId,
    kind: input.kind,
    source: input.source,
    confidence: input.confidence ?? null,
    reason: input.reason,
    payloadJson: JSON.stringify(input.payload),
    createdAt: input.createdAt ?? new Date().toISOString()
  });
  return proposalId;
}

function slugId(prefix: string, value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${prefix}-${slug || randomUUID()}`;
}

function parsePayload(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Proposal payload must be an object.");
  }
  return parsed as Record<string, unknown>;
}

export function applyAgentProposal(
  db: SqliteDatabase,
  proposalId: string,
  actor = "user",
  appliedAt = new Date().toISOString()
): void {
  const proposal = db
    .prepare("SELECT proposal_id AS proposalId, kind, payload_json AS payloadJson FROM agent_proposals WHERE proposal_id = ? AND status = 'pending'")
    .get(proposalId) as { proposalId: string; kind: ProposalKind; payloadJson: string } | undefined;
  if (!proposal) {
    throw new Error(`No pending proposal found for ${proposalId}.`);
  }
  const payload = parsePayload(proposal.payloadJson);
  const write = db.transaction(() => {
    if (proposal.kind === "category_change") {
      const transactionIds = Array.isArray(payload.transactionIds) ? payload.transactionIds.filter((id): id is string => typeof id === "string") : [];
      const categoryName = typeof payload.categoryName === "string" ? payload.categoryName : null;
      if (!categoryName || transactionIds.length === 0) {
        throw new Error("Category change proposals require categoryName and transactionIds.");
      }
      const update = db.prepare(`
        UPDATE transactions
        SET user_category = @categoryName,
            category_source = @actor,
            review_status = 'needs_review',
            updated_at = @appliedAt
        WHERE transaction_id = @transactionId
      `);
      for (const transactionId of transactionIds) {
        update.run({ categoryName, actor, appliedAt, transactionId });
      }
    } else if (proposal.kind === "rule") {
      const name = typeof payload.name === "string" ? payload.name : `Rule ${proposalId}`;
      const match = payload.match && typeof payload.match === "object" ? payload.match : {};
      const set = payload.set && typeof payload.set === "object" ? payload.set : {};
      db.prepare(`
        INSERT INTO rules (rule_id, name, enabled, match_json, set_json, source, created_at, updated_at)
        VALUES (@ruleId, @name, 1, @matchJson, @setJson, @actor, @appliedAt, @appliedAt)
      `).run({
        ruleId: slugId("rule", name),
        name,
        matchJson: JSON.stringify(match),
        setJson: JSON.stringify(set),
        actor,
        appliedAt
      });
    } else if (proposal.kind === "budget") {
      const categoryName = typeof payload.categoryName === "string" ? payload.categoryName : null;
      const amount = typeof payload.amount === "number" ? payload.amount : null;
      const month = typeof payload.month === "string" ? payload.month : monthKey(new Date(appliedAt));
      if (!categoryName || amount === null) {
        throw new Error("Budget proposals require categoryName and numeric amount.");
      }
      const categoryId = slugId("cat", categoryName);
      db.prepare(`
        INSERT OR IGNORE INTO categories (category_id, group_id, name, excluded, created_at, updated_at)
        VALUES (@categoryId, NULL, @categoryName, 0, @appliedAt, @appliedAt)
      `).run({ categoryId, categoryName, appliedAt });
      db.prepare(`
        INSERT INTO budgets (budget_id, budget_group_id, category_id, month, amount, rollover_enabled, created_at, updated_at)
        VALUES (@budgetId, NULL, @categoryId, @month, @amount, 0, @appliedAt, @appliedAt)
        ON CONFLICT(category_id, month) DO UPDATE SET amount = excluded.amount, updated_at = excluded.updated_at
      `).run({ budgetId: `${categoryId}-${month}`, categoryId, month, amount, appliedAt });
    } else if (proposal.kind === "recurring") {
      const merchantName = typeof payload.merchantName === "string" ? payload.merchantName : null;
      const cadence = typeof payload.cadence === "string" ? payload.cadence : "monthly";
      if (!merchantName) {
        throw new Error("Recurring proposals require merchantName.");
      }
      db.prepare(`
        INSERT INTO recurrings (
          recurring_id, merchant_name, cadence, average_amount, next_due_date,
          confidence, status, source, created_at, updated_at
        )
        VALUES (
          @recurringId, @merchantName, @cadence, @averageAmount, @nextDueDate,
          @confidence, 'confirmed', @actor, @appliedAt, @appliedAt
        )
        ON CONFLICT(recurring_id) DO UPDATE SET
          cadence = excluded.cadence,
          average_amount = excluded.average_amount,
          next_due_date = excluded.next_due_date,
          confidence = excluded.confidence,
          status = 'confirmed',
          updated_at = excluded.updated_at
      `).run({
        recurringId: slugId("rec", merchantName),
        merchantName,
        cadence,
        averageAmount: typeof payload.averageAmount === "number" ? payload.averageAmount : null,
        nextDueDate: typeof payload.nextDueDate === "string" ? payload.nextDueDate : null,
        confidence: typeof payload.confidence === "number" ? payload.confidence : null,
        actor,
        appliedAt
      });
    }

    db.prepare("UPDATE agent_proposals SET status = 'applied', applied_at = ? WHERE proposal_id = ?").run(
      appliedAt,
      proposalId
    );
    insertAuditLog(db, {
      actor,
      action: "proposal.apply",
      targetType: "agent_proposal",
      targetId: proposalId,
      metadata: { kind: proposal.kind },
      createdAt: appliedAt
    });
  });
  write();
}

export function listAgentProposals(db: SqliteDatabase, status = "pending"): Array<Record<string, unknown>> {
  return db
    .prepare(
      `
      SELECT
        proposal_id AS proposalId,
        kind,
        status,
        source,
        confidence,
        reason,
        payload_json AS payloadJson,
        created_at AS createdAt,
        applied_at AS appliedAt,
        rejected_at AS rejectedAt
      FROM agent_proposals
      WHERE status = @status
      ORDER BY created_at DESC
    `
    )
    .all({ status }) as Array<Record<string, unknown>>;
}

export function suggestRecurringCandidates(db: SqliteDatabase): Array<Record<string, unknown>> {
  return db
    .prepare(
      `
      SELECT
        COALESCE(merchant_name, name) AS merchantName,
        count(*) AS transactionCount,
        round(avg(amount), 2) AS averageAmount,
        min(date) AS firstDate,
        max(date) AS lastDate,
        round((julianday(max(date)) - julianday(min(date))) / max(count(*) - 1, 1), 1) AS averageDays
      FROM transactions
      WHERE removed_at IS NULL
        AND amount > 0
        AND transaction_type = 'regular'
        AND COALESCE(merchant_name, name) IS NOT NULL
      GROUP BY lower(COALESCE(merchant_name, name))
      HAVING count(*) >= 3 AND averageDays BETWEEN 20 AND 45
      ORDER BY transactionCount DESC, averageAmount DESC
    `
    )
    .all() as Array<Record<string, unknown>>;
}

export function runRecurringEnrichment(
  db: SqliteDatabase,
  source = "argent.recurring-detector",
  createdAt = new Date().toISOString()
): number {
  const candidates = suggestRecurringCandidates(db);
  const write = db.transaction(() => {
    for (const candidate of candidates) {
      const merchantName = String(candidate.merchantName);
      const confidence = 0.72;
      const reason = "Similar monthly charges appeared at least three times.";
      insertEnrichmentEvent(db, {
        source,
        targetType: "merchant",
        targetId: merchantName,
        confidence,
        reason,
        payload: candidate,
        createdAt
      });
      createAgentProposal(db, {
        kind: "recurring",
        source,
        confidence,
        reason,
        payload: {
          merchantName,
          cadence: "monthly",
          averageAmount: candidate.averageAmount,
          confidence
        },
        createdAt
      });
    }
    insertAuditLog(db, {
      actor: source,
      action: "enrichment.recurring_candidates",
      targetType: "merchant",
      metadata: { count: candidates.length },
      createdAt
    });
  });
  write();
  return candidates.length;
}

export function exportTransactions(db: SqliteDatabase): ReturnType<typeof getExportRows> {
  return getExportRows(db);
}
