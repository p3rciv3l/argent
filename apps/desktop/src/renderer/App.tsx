import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Gauge,
  ListChecks,
  PieChart,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  WalletCards
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { DesktopData, ViewName } from "../shared/ipc.js";

const views: Array<{ id: ViewName; label: string; icon: typeof Gauge }> = [
  { id: "dashboard", label: "Dashboard", icon: Gauge },
  { id: "transactions", label: "Transactions", icon: ListChecks },
  { id: "budgets", label: "Budgets", icon: PieChart },
  { id: "accounts", label: "Accounts", icon: WalletCards },
  { id: "recurrings", label: "Recurrings", icon: CalendarClock },
  { id: "investments", label: "Investments", icon: BarChart3 },
  { id: "liabilities", label: "Liabilities", icon: ShieldAlert },
  { id: "proposals", label: "Proposals", icon: Sparkles }
];

const emptyData: DesktopData = {
  dashboard: {},
  cashFlow: [],
  transactions: [],
  budgets: [],
  accounts: [],
  recurrings: [],
  investments: { holdings: [], transactions: [] },
  liabilities: [],
  proposals: []
};

function money(value: unknown): string {
  const amount = typeof value === "number" ? value : Number(value ?? 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(amount);
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function App() {
  const [view, setView] = useState<ViewName>("dashboard");
  const [data, setData] = useState<DesktopData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function refresh() {
    setLoading(true);
    const next = await window.argent.loadData();
    setData(next);
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, []);

  const filteredTransactions = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return data.transactions;
    }
    return data.transactions.filter((transaction) =>
      [transaction.name, transaction.merchantName, transaction.categoryName, transaction.userCategory]
        .map((value) => asString(value).toLowerCase())
        .some((value) => value.includes(term))
    );
  }, [data.transactions, search]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "r" && selected.size > 0) {
        event.preventDefault();
        void reviewSelected();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected]);

  async function reviewSelected() {
    const ids = [...selected];
    if (ids.length === 0) {
      return;
    }
    await window.argent.reviewTransactions(ids, "reviewed");
    setSelected(new Set());
    await refresh();
  }

  async function applyProposal(proposalId: string) {
    await window.argent.applyProposal(proposalId);
    await refresh();
  }

  const dashboard = data.dashboard;
  const Icon = views.find((item) => item.id === view)?.icon ?? Gauge;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">A</span>
          <span>Argent</span>
        </div>
        <nav className="nav-list">
          {views.map((item) => {
            const ItemIcon = item.icon;
            return (
              <button
                key={item.id}
                className={view === item.id ? "nav-item active" : "nav-item"}
                onClick={() => setView(item.id)}
                title={item.label}
              >
                <ItemIcon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="view-title">
            <Icon size={22} />
            <h1>{views.find((item) => item.id === view)?.label}</h1>
          </div>
          <button className="icon-button" onClick={() => void refresh()} title="Refresh">
            <RefreshCw size={18} className={loading ? "spin" : ""} />
          </button>
        </header>

        {view === "dashboard" && (
          <section className="dashboard-grid">
            <Metric label="Review queue" value={String(dashboard.reviewQueueCount ?? 0)} tone="amber" />
            <Metric label="Month spent" value={money(dashboard.monthSpent)} tone="red" />
            <Metric label="Month net" value={money(dashboard.monthNet)} tone="green" />
            <Metric label="Net worth" value={money(dashboard.netWorth)} tone="blue" />
            <div className="panel span-2 chart-panel">
              <h2>Cash Flow</h2>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={data.cashFlow}>
                  <CartesianGrid stroke="#ddd7cb" vertical={false} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
                  <Tooltip formatter={(value) => money(value)} />
                  <Area type="monotone" dataKey="income" stackId="1" stroke="#247a5a" fill="#7abf9a" />
                  <Area type="monotone" dataKey="spent" stackId="2" stroke="#a5483d" fill="#d98a77" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="panel chart-panel">
              <h2>Budgets</h2>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={data.budgets}>
                  <CartesianGrid stroke="#ddd7cb" vertical={false} />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
                  <Tooltip formatter={(value) => money(value)} />
                  <Bar dataKey="spent" fill="#526c9f" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        {view === "transactions" && (
          <section className="panel table-panel">
            <div className="table-actions">
              <label className="search-field">
                <Search size={16} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" />
              </label>
              <button className="command-button" onClick={() => void reviewSelected()} disabled={selected.size === 0}>
                <CheckCircle2 size={16} />
                <span>Review</span>
              </button>
            </div>
            <TransactionTable rows={filteredTransactions} selected={selected} onSelected={setSelected} />
          </section>
        )}

        {view === "budgets" && (
          <section className="panel table-panel">
            <SimpleTable
              rows={data.budgets}
              columns={[
                ["name", "Budget"],
                ["amount", "Amount", money],
                ["spent", "Spent", money],
                ["remaining", "Remaining", money]
              ]}
            />
          </section>
        )}

        {view === "accounts" && (
          <section className="panel table-panel">
            <SimpleTable
              rows={data.accounts}
              columns={[
                ["institutionName", "Institution"],
                ["name", "Account"],
                ["type", "Type"],
                ["balanceCurrent", "Balance", money],
                ["connectionStatus", "Status"]
              ]}
            />
          </section>
        )}

        {view === "recurrings" && (
          <section className="panel table-panel">
            <SimpleTable
              rows={data.recurrings}
              columns={[
                ["merchantName", "Merchant"],
                ["cadence", "Cadence"],
                ["averageAmount", "Average", money],
                ["nextDueDate", "Next"],
                ["status", "Status"]
              ]}
            />
          </section>
        )}

        {view === "investments" && (
          <section className="panel table-panel">
            <SimpleTable
              rows={(data.investments.holdings as Array<Record<string, unknown>>) ?? []}
              columns={[
                ["accountName", "Account"],
                ["securityName", "Security"],
                ["tickerSymbol", "Ticker"],
                ["quantity", "Qty"],
                ["institutionValue", "Value", money]
              ]}
            />
          </section>
        )}

        {view === "liabilities" && (
          <section className="panel table-panel">
            <SimpleTable
              rows={data.liabilities}
              columns={[
                ["institutionName", "Institution"],
                ["accountName", "Account"],
                ["type", "Type"],
                ["balance", "Balance", money],
                ["creditLimit", "Limit", money],
                ["creditUtilization", "Utilization", (value) => (value === null || value === undefined ? "" : `${value}%`)],
                ["minimumPaymentAmount", "Minimum", money],
                ["nextPaymentDueDate", "Due"]
              ]}
            />
          </section>
        )}

        {view === "proposals" && (
          <section className="proposal-list">
            {data.proposals.map((proposal) => (
              <article className="proposal-card" key={asString(proposal.proposalId)}>
                <div>
                  <strong>{asString(proposal.kind)}</strong>
                  <p>{asString(proposal.reason)}</p>
                </div>
                <button className="command-button" onClick={() => void applyProposal(asString(proposal.proposalId))}>
                  <CheckCircle2 size={16} />
                  <span>Apply</span>
                </button>
              </article>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className={`metric metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TransactionTable({
  rows,
  selected,
  onSelected
}: {
  rows: Array<Record<string, unknown>>;
  selected: Set<string>;
  onSelected: (selected: Set<string>) => void;
}) {
  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onSelected(next);
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th className="select-col"></th>
            <th>Date</th>
            <th>Name</th>
            <th>Category</th>
            <th>Account</th>
            <th>Type</th>
            <th className="amount-col">Amount</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const id = asString(row.transactionId);
            return (
              <tr key={id}>
                <td className="select-col">
                  <input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} />
                </td>
                <td>{asString(row.date)}</td>
                <td>{asString(row.merchantName) || asString(row.name)}</td>
                <td>{asString(row.userCategory) || asString(row.categoryName) || "Uncategorized"}</td>
                <td>{asString(row.accountName)}</td>
                <td>{asString(row.transactionType)}</td>
                <td className={asNumber(row.amount) < 0 ? "amount credit" : "amount"}>{money(row.amount)}</td>
                <td>{asString(row.reviewStatus)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SimpleTable({
  rows,
  columns
}: {
  rows: Array<Record<string, unknown>>;
  columns: Array<[string, string, ((value: unknown) => string)?]>;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map(([, label]) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map(([key, label, formatter]) => (
                <td key={label}>{formatter ? formatter(row[key]) : String(row[key] ?? "")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
