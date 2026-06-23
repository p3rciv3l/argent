import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import { startDesktopApp } from "./main.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function waitFor<T>(fn: () => Promise<T>, predicate: (value: T) => boolean, label: string): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    const value = await fn();
    if (predicate(value)) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function main(): Promise<void> {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-desktop-"));
  const workspaceRoot = path.resolve(__dirname, "../../..");
  const cliPath = path.join(workspaceRoot, "apps", "cli", "dist", "main.js");
  const artifactsDir = path.join(workspaceRoot, "artifacts");
  fs.mkdirSync(artifactsDir, { recursive: true });

  process.env.ARGENT_HOME = path.join(tmpdir, "home");
  process.env.ARGENT_DB_PATH = path.join(tmpdir, "state.sqlite");
  const cliEnv = { ...process.env };
  const cli = (...args: string[]) =>
    execFileSync(process.env.ARGENT_NODE_BINARY || "node", [cliPath, ...args, "--json"], {
      cwd: workspaceRoot,
      env: cliEnv,
      encoding: "utf8"
    });

  cli("init");
  cli("sync", "plaid", "--mock");
  cli("recurrings", "detect");

  const window = await startDesktopApp();
  try {
    const bodyText = await waitFor(
      () => window.webContents.executeJavaScript("document.body.innerText"),
      (text: string) => text.includes("Dashboard") && text.includes("Review queue"),
      "dashboard text"
    );
    if (!bodyText.includes("Month spent") || !bodyText.includes("Net worth")) {
      throw new Error("Dashboard metrics did not render.");
    }
    const loadedDataCheck = (await window.webContents.executeJavaScript(`
      (async () => {
        try {
          if (!window.argent) return { ok: false, error: 'window.argent is missing' };
          const data = await window.argent.loadData();
          return { ok: true, transactionCount: data.transactions.length };
        } catch (error) {
          return { ok: false, error: String(error?.stack || error?.message || error) };
        }
      })()
    `)) as { ok: boolean; transactionCount?: number; error?: string };
    if (!loadedDataCheck.ok || (loadedDataCheck.transactionCount ?? 0) < 5) {
      throw new Error(
        `Expected at least 5 transactions from desktop IPC, got ${loadedDataCheck.transactionCount ?? 0}: ${
          loadedDataCheck.error ?? "no error"
        }`
      );
    }

    const chartCount = await waitFor(
      () => window.webContents.executeJavaScript("document.querySelectorAll('.recharts-wrapper svg').length"),
      (count: number) => count >= 2,
      "dashboard charts"
    );

    await window.webContents.executeJavaScript(`
      [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Transactions'))?.click();
    `);
    const transactionText = await waitFor(
      () => window.webContents.executeJavaScript("document.body.innerText"),
      (text: string) => text.includes("Northside Market") && text.includes("Streambox"),
      "transactions table"
    ).catch(async (error: unknown) => {
      const text = await window.webContents.executeJavaScript("document.body.innerText");
      throw new Error(`${error instanceof Error ? error.message : String(error)}. Visible text: ${text}`);
    });
    await window.webContents.executeJavaScript(`
      document.querySelector('tbody input[type="checkbox"]')?.click();
    `);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await window.webContents.executeJavaScript(`
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
    `);
    const reviewedCount = await waitFor(
      () =>
        window.webContents.executeJavaScript(
          "window.argent.transactions({ reviewStatus: 'reviewed' }).then((rows) => rows.length)"
        ),
      (count: number) => count >= 1,
      "keyboard review action"
    );

    await window.webContents.executeJavaScript(`
      [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Liabilities'))?.click();
    `);
    const liabilitiesText = await waitFor(
      () => window.webContents.executeJavaScript("document.body.innerText"),
      (text: string) => text.includes("Institution") && text.includes("Utilization"),
      "liabilities view"
    );

    const screenshot = await window.webContents.capturePage();
    const screenshotPath = path.join(artifactsDir, "desktop-smoke.png");
    fs.writeFileSync(screenshotPath, screenshot.toPNG());
    const screenshotSize = fs.statSync(screenshotPath).size;
    if (screenshotSize < 10_000) {
      throw new Error(`Desktop smoke screenshot is unexpectedly small: ${screenshotSize} bytes.`);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          chartCount,
          loadedTransactionCount: loadedDataCheck.transactionCount,
          transactionRowsVisible: transactionText.includes("Northside Market"),
          reviewedCount,
          liabilitiesVisible: liabilitiesText.includes("Utilization"),
          screenshotPath,
          screenshotSize
        },
        null,
        2
      )
    );
  } finally {
    fs.rmSync(tmpdir, { recursive: true, force: true });
    window.close();
    app.quit();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  app.exit(1);
});
