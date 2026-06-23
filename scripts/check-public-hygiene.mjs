#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

function gitFiles() {
  try {
    return execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

function walk(dir, prefix = "") {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if ([".git", "node_modules", "dist", "coverage"].includes(entry.name)) {
      continue;
    }
    const relative = path.join(prefix, entry.name);
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(absolute, relative));
    } else {
      files.push(relative);
    }
  }
  return files;
}

const files = gitFiles();
const scannedFiles = files.length > 0 ? files : walk(root);

const blockedPathPatterns = [
  /^\.env(?:\.|$)/,
  /^\.argent\//,
  /^\.bank-transactions\//,
  /^exports\/.*\.csv$/i,
  /(^|\/)[^/]*\.(?:sqlite|sqlite-\w+|db|db-\w+)$/i,
  /(^|\/)[^/]*oauth[^/]*token[^/]*\.json$/i,
  /(^|\/)[^/]*oauth[^/]*credentials[^/]*\.json$/i
];

const blockedContentPatterns = [
  { name: "plaid access token", pattern: /\baccess-(?:sandbox|development|production)-[A-Za-z0-9_-]{12,}\b/ },
  { name: "openai api key", pattern: /\bsk-(?:proj|live|test|ant)-[A-Za-z0-9_-]{16,}\b/ },
  { name: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/ }
];

const failures = [];

for (const file of scannedFiles) {
  const normalized = file.split(path.sep).join("/");
  if (blockedPathPatterns.some((pattern) => pattern.test(normalized))) {
    if (normalized !== ".env.example") {
      failures.push(`${normalized}: blocked private/generated path`);
    }
    continue;
  }

  const absolute = path.join(root, file);
  let content;
  try {
    const stat = fs.statSync(absolute);
    if (stat.size > 1_000_000) {
      continue;
    }
    content = fs.readFileSync(absolute, "utf8");
  } catch {
    continue;
  }

  for (const { name, pattern } of blockedContentPatterns) {
    if (pattern.test(content)) {
      failures.push(`${normalized}: matched ${name}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Public hygiene check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Public hygiene check passed for ${scannedFiles.length} files.`);
