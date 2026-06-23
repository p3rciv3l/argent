import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import type { ArgentPaths } from "./types.js";

function expandHome(value: string): string {
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function resolvePath(value: string): string {
  const expanded = expandHome(value);
  return path.isAbsolute(expanded) ? expanded : path.resolve(process.cwd(), expanded);
}

function optionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function getArgentPaths(): ArgentPaths {
  const homeDir = resolvePath(optionalEnv("ARGENT_HOME") ?? "~/.argent");
  const databasePath = resolvePath(optionalEnv("ARGENT_DB_PATH") ?? path.join(homeDir, "state.sqlite"));
  const exportDir = resolvePath(optionalEnv("ARGENT_EXPORT_DIR") ?? path.join(homeDir, "exports"));
  return {
    homeDir,
    databasePath,
    exportDir,
    exportCsvPath: path.join(exportDir, "transactions.csv"),
    rulesPath: resolvePath(optionalEnv("ARGENT_RULES_PATH") ?? path.join(homeDir, "rules.json"))
  };
}

export function ensureArgentPaths(paths = getArgentPaths()): ArgentPaths {
  fs.mkdirSync(paths.homeDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.dirname(paths.databasePath), { recursive: true, mode: 0o700 });
  fs.mkdirSync(paths.exportDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.dirname(paths.rulesPath), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(paths.rulesPath)) {
    fs.writeFileSync(paths.rulesPath, `${JSON.stringify({ version: 1, rules: [] }, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
  }
  return paths;
}
