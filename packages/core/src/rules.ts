import fs from "node:fs";
import { getArgentPaths } from "./config.js";
import type { SqliteDatabase } from "./db.js";

type RuleValue = string | number | boolean | null;
type MatchValue = RuleValue | RuleValue[];

const MATCH_COLUMNS = {
  transactionId: "transaction_id",
  connectionId: "connection_id",
  accountId: "account_id",
  date: "date",
  name: "name",
  merchantName: "merchant_name",
  amount: "amount",
  direction: "direction",
  transactionType: "transaction_type",
  categoryId: "category_id",
  userCategory: "user_category",
  providerCategoryPrimary: "provider_category_primary",
  providerCategoryDetailed: "provider_category_detailed",
  paymentChannel: "payment_channel",
  reviewStatus: "review_status",
  source: "source"
} as const;

const SET_COLUMNS = {
  transactionType: "transaction_type",
  categoryId: "category_id",
  userCategory: "user_category",
  aiCategory: "ai_category",
  aiConfidence: "ai_confidence",
  categorySource: "category_source",
  reviewStatus: "review_status",
  recurringId: "recurring_id"
} as const;

type MatchKey = keyof typeof MATCH_COLUMNS;
type SetKey = keyof typeof SET_COLUMNS;

export type TransactionRuleMatch = Partial<Record<MatchKey, MatchValue>> & {
  amounts?: number[];
  dateFrom?: string;
  dateTo?: string;
  search?: string;
};

export type TransactionRuleSet = Partial<Record<SetKey, RuleValue>>;

export interface TransactionRule {
  id?: string;
  name?: string;
  enabled?: boolean;
  includeRemoved?: boolean;
  match: TransactionRuleMatch;
  set: TransactionRuleSet;
}

export interface TransactionRulesConfig {
  version?: number;
  rules: TransactionRule[];
}

export interface TransactionRulesApplyResult {
  changedRows: number;
  appliedRules: Array<{ id: string; changedRows: number }>;
}

type SqlParams = Record<string, RuleValue>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRuleConfig(value: unknown, filePath: string): TransactionRulesConfig {
  if (Array.isArray(value)) {
    return { version: 1, rules: value as TransactionRule[] };
  }
  if (!isObject(value) || !Array.isArray(value.rules)) {
    throw new Error(`Transaction rules file ${filePath} must contain a rules array.`);
  }
  return {
    version: typeof value.version === "number" ? value.version : 1,
    rules: value.rules as TransactionRule[]
  };
}

export function loadTransactionRules(filePath = getArgentPaths().rulesPath): TransactionRulesConfig {
  if (!fs.existsSync(filePath)) {
    return { version: 1, rules: [] };
  }
  const content = fs.readFileSync(filePath, "utf8");
  try {
    return asRuleConfig(JSON.parse(content), filePath);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Unable to parse transaction rules file ${filePath}: ${error.message}`);
    }
    throw error;
  }
}

function normalizeSetValue(value: RuleValue): RuleValue {
  return typeof value === "boolean" ? (value ? 1 : 0) : value;
}

function addParam(params: SqlParams, name: string, value: RuleValue): string {
  params[name] = value;
  return `@${name}`;
}

function addExactPredicate(
  predicates: string[],
  params: SqlParams,
  column: string,
  paramPrefix: string,
  value: MatchValue
): void {
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0) {
    throw new Error(`Transaction rule match ${paramPrefix} cannot be an empty array.`);
  }

  const nonNullValues = values.filter((candidate): candidate is Exclude<RuleValue, null> => candidate !== null);
  const hasNull = nonNullValues.length !== values.length;
  const parts: string[] = [];

  if (nonNullValues.length > 0) {
    const placeholders = nonNullValues.map((candidate, index) =>
      addParam(params, `${paramPrefix}_${index}`, candidate)
    );
    parts.push(`${column} IN (${placeholders.join(", ")})`);
  }
  if (hasNull) {
    parts.push(`${column} IS NULL`);
  }
  predicates.push(parts.length === 1 ? parts[0]! : `(${parts.join(" OR ")})`);
}

function buildRuleStatement(rule: TransactionRule, ruleIndex: number, appliedAt: string): {
  sql: string;
  params: SqlParams;
} {
  if (!isObject(rule.match)) {
    throw new Error(`Transaction rule ${rule.id ?? ruleIndex + 1} must include a match object.`);
  }
  if (!isObject(rule.set)) {
    throw new Error(`Transaction rule ${rule.id ?? ruleIndex + 1} must include a set object.`);
  }

  const predicates: string[] = rule.includeRemoved ? [] : ["removed_at IS NULL"];
  const params: SqlParams = {};
  let explicitMatchCount = 0;

  for (const key of Object.keys(MATCH_COLUMNS) as MatchKey[]) {
    const value = rule.match[key];
    if (value === undefined) {
      continue;
    }
    addExactPredicate(predicates, params, MATCH_COLUMNS[key], `match_${ruleIndex}_${key}`, value);
    explicitMatchCount += 1;
  }

  if (rule.match.amounts !== undefined) {
    addExactPredicate(predicates, params, "amount", `match_${ruleIndex}_amounts`, rule.match.amounts);
    explicitMatchCount += 1;
  }
  if (rule.match.dateFrom !== undefined) {
    predicates.push(`date >= ${addParam(params, `match_${ruleIndex}_dateFrom`, rule.match.dateFrom)}`);
    explicitMatchCount += 1;
  }
  if (rule.match.dateTo !== undefined) {
    predicates.push(`date <= ${addParam(params, `match_${ruleIndex}_dateTo`, rule.match.dateTo)}`);
    explicitMatchCount += 1;
  }
  if (rule.match.search !== undefined) {
    const search = `%${rule.match.search}%`;
    predicates.push(`(name LIKE ${addParam(params, `match_${ruleIndex}_searchName`, search)} OR merchant_name LIKE @match_${ruleIndex}_searchName)`);
    explicitMatchCount += 1;
  }
  if (explicitMatchCount === 0) {
    throw new Error(`Transaction rule ${rule.id ?? ruleIndex + 1} must include at least one match field.`);
  }

  const setClauses: string[] = [];
  const changedPredicates: string[] = [];
  for (const key of Object.keys(SET_COLUMNS) as SetKey[]) {
    if (!Object.prototype.hasOwnProperty.call(rule.set, key)) {
      continue;
    }
    const column = SET_COLUMNS[key];
    const paramName = `set_${ruleIndex}_${key}`;
    const placeholder = addParam(params, paramName, normalizeSetValue(rule.set[key] ?? null));
    setClauses.push(`${column} = ${placeholder}`);
    changedPredicates.push(`${column} IS NOT ${placeholder}`);
  }
  if (setClauses.length === 0) {
    throw new Error(`Transaction rule ${rule.id ?? ruleIndex + 1} must include at least one set field.`);
  }

  params[`set_${ruleIndex}_updatedAt`] = appliedAt;
  setClauses.push(`updated_at = @set_${ruleIndex}_updatedAt`);
  predicates.push(`(${changedPredicates.join(" OR ")})`);

  return {
    sql: `UPDATE transactions SET ${setClauses.join(", ")} WHERE ${predicates.join(" AND ")}`,
    params
  };
}

export function applyTransactionRules(
  db: SqliteDatabase,
  config: TransactionRulesConfig = loadTransactionRules(),
  appliedAt = new Date().toISOString()
): TransactionRulesApplyResult {
  const appliedRules: Array<{ id: string; changedRows: number }> = [];
  let changedRows = 0;
  const apply = db.transaction(() => {
    config.rules.forEach((rule, index) => {
      if (rule.enabled === false) {
        return;
      }
      const { sql, params } = buildRuleStatement(rule, index, appliedAt);
      const result = db.prepare(sql).run(params);
      if (result.changes > 0) {
        const detail = { id: rule.id ?? `rule-${index + 1}`, changedRows: result.changes };
        appliedRules.push(detail);
        changedRows += result.changes;
      }
    });
  });
  apply();
  return { changedRows, appliedRules };
}
