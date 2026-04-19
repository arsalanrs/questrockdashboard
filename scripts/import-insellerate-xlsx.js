#!/usr/bin/env node
/**
 * Import an Insellerate .xlsx export into Supabase via the dev server.
 *
 * Usage:
 *   1. npm run dev
 *   2. node scripts/import-insellerate-xlsx.js <path/to/file.xlsx> [--no-merge]
 *
 * Flags:
 *   --no-merge   Write to historical_leads only; skip merging active rows into loans.
 *
 * Requires .env.local with:
 *   CRON_SECRET (so the API accepts the request without browser auth)
 *   optional: NEXT_PUBLIC_APP_URL (defaults to http://localhost:3000)
 */

/* eslint-disable no-console */

const path = require("node:path");
const fs = require("node:fs");

function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) {
    console.error("Missing .env.local");
    process.exit(1);
  }
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}

async function main() {
  loadEnvLocal();

  const args = process.argv.slice(2);
  const filePath = args.find((a) => !a.startsWith("--"));
  const noMerge = args.includes("--no-merge");

  if (!filePath) {
    console.error("Usage: node scripts/import-insellerate-xlsx.js <path/to/file.xlsx> [--no-merge]");
    process.exit(1);
  }

  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    console.error(`File not found: ${abs}`);
    process.exit(1);
  }

  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    console.error("Set CRON_SECRET in .env.local.");
    process.exit(1);
  }

  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const url =
    `${base.replace(/\/$/, "")}/api/admin/import/insellerate` +
    (noMerge ? "?noMerge=1" : "");

  const form = new FormData();
  const buf = fs.readFileSync(abs);
  form.append("file", new Blob([buf]), path.basename(abs));

  console.log("POST", url, "(", buf.length, "bytes )");
  const res = await fetch(url, {
    method: "POST",
    headers: { "x-cron-secret": cronSecret },
    body: form,
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    console.error("HTTP", res.status, body);
    process.exit(1);
  }
  console.log(JSON.stringify(body, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
