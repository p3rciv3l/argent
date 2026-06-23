import fs from "node:fs/promises";
import path from "node:path";
import { EXPORT_COLUMNS, type ExportRow, type ExportValue } from "./types.js";

export function formatCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value);
}

function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  const cell = formatCell(value);
  if (/[",\n\r]/.test(cell)) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

export function rowsToValues(rows: ExportRow[]): ExportValue[][] {
  return [
    [...EXPORT_COLUMNS],
    ...rows.map((row) => EXPORT_COLUMNS.map((column) => row[column] ?? ""))
  ];
}

export function buildCsv(rows: ExportRow[]): string {
  return rowsToValues(rows)
    .map((row) => row.map((cell) => escapeCsvCell(cell)).join(","))
    .join("\n")
    .concat("\n");
}

export async function writeCsv(filePath: string, rows: ExportRow[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buildCsv(rows), "utf8");
}
