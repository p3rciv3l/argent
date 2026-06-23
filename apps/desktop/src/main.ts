import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "../../..");
const cliPath = path.join(workspaceRoot, "apps", "cli", "dist", "main.js");

function nodeBinary(): string {
  return process.env.ARGENT_NODE_BINARY || "node";
}

function runArgentJson<T>(args: string[]): Promise<T> {
  return new Promise((resolve, reject) => {
    execFile(
      nodeBinary(),
      [cliPath, ...args, "--json"],
      {
        cwd: workspaceRoot,
        env: process.env,
        maxBuffer: 10 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as T);
        } catch (parseError) {
          reject(
            new Error(
              `Unable to parse Argent CLI JSON output: ${
                parseError instanceof Error ? parseError.message : String(parseError)
              }`
            )
          );
        }
      }
    );
  });
}

function transactionFilterArgs(filters: Record<string, unknown>): string[] {
  const args = ["transactions", "list", "--limit", "200"];
  const mapping: Array<[string, string]> = [
    ["accountId", "--account"],
    ["categoryId", "--category"],
    ["startDate", "--start"],
    ["endDate", "--end"],
    ["recurringId", "--recurring"],
    ["reviewStatus", "--review-status"],
    ["tag", "--tag"],
    ["type", "--type"],
    ["search", "--search"]
  ];

  for (const [key, flag] of mapping) {
    const value = filters[key];
    if (typeof value === "string" && value.trim()) {
      args.push(flag, value);
    }
  }

  return args;
}

export function registerIpc(): void {
  ipcMain.removeHandler("argent:load-data");
  ipcMain.removeHandler("argent:transactions");
  ipcMain.removeHandler("argent:review-transactions");
  ipcMain.removeHandler("argent:apply-proposal");
  ipcMain.removeHandler("argent:setup-connector");
  ipcMain.removeHandler("argent:sync-connection");

  ipcMain.handle("argent:load-data", async () => {
    const [
      dashboard,
      cashFlow,
      transactions,
      budgets,
      accounts,
      recurrings,
      investments,
      liabilities,
      proposals,
      connections,
      connectorCatalog
    ] = await Promise.all([
      runArgentJson(["report", "dashboard"]),
      runArgentJson(["report", "cash-flow", "--months", "12"]),
      runArgentJson(["transactions", "list", "--limit", "200"]),
      runArgentJson(["budget", "list"]),
      runArgentJson(["report", "accounts"]),
      runArgentJson(["recurrings", "list"]),
      runArgentJson(["report", "investments"]),
      runArgentJson(["report", "liabilities"]),
      runArgentJson(["proposals", "list"]),
      runArgentJson(["connections", "list"]),
      runArgentJson(["connectors", "catalog"])
    ]);

    return {
      dashboard,
      cashFlow,
      transactions,
      budgets,
      accounts,
      recurrings,
      investments,
      liabilities,
      proposals,
      connections,
      connectorCatalog
    };
  });

  ipcMain.handle("argent:transactions", (_event, filters: Record<string, unknown>) =>
    runArgentJson(transactionFilterArgs(filters))
  );

  ipcMain.handle(
    "argent:review-transactions",
    (_event, transactionIds: string[], status: "reviewed" | "unreviewed" | "needs_review") =>
      runArgentJson(["review", "--ids", transactionIds.join(","), "--status", status])
  );

  ipcMain.handle("argent:apply-proposal", (_event, proposalId: string) =>
    runArgentJson(["proposals", "apply", proposalId])
  );

  ipcMain.handle("argent:setup-connector", (_event, connectorId: string, options: Record<string, unknown> = {}) => {
    const args = ["connectors", "setup", connectorId];
    if (options.demo !== false) {
      args.push("--demo");
    }
    return runArgentJson(args);
  });

  ipcMain.handle("argent:sync-connection", (_event, connectionId: string) =>
    runArgentJson(["connectors", "sync", connectionId])
  );
}

export async function createWindow(): Promise<BrowserWindow> {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 680,
    title: "Argent",
    backgroundColor: "#f7f5ef",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devServer = process.env.ARGENT_DESKTOP_DEV_SERVER;
  if (devServer) {
    await mainWindow.loadURL(devServer);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  }

  return mainWindow;
}

export async function startDesktopApp(): Promise<BrowserWindow> {
  await app.whenReady();
  registerIpc();
  return createWindow();
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : "";

if (currentFile === invokedFile) {
  void startDesktopApp();
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void startDesktopApp();
  }
});
