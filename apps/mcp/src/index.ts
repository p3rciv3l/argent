#!/usr/bin/env node
export * from "./server.js";

import path from "node:path";
import { fileURLToPath } from "node:url";
import { startMcpServer } from "./server.js";

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : "";

if (currentFile === invokedFile) {
  startMcpServer().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
