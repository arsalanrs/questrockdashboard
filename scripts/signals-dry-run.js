/**
 * Dry-run the deal-signal engine via the dev server.
 *
 * Usage:
 *   1. npm run dev
 *   2. node scripts/signals-dry-run.js            # compute, do NOT persist
 *      node scripts/signals-dry-run.js --persist  # compute + upsert + auto-dismiss
 *
 * Requires .env.local with:
 *   CRON_SECRET (so the API accepts the request without browser auth)
 *   optional: NEXT_PUBLIC_APP_URL (defaults to http://localhost:3000)
 */

const path = require("path");
const fs = require("fs");

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
  const persist = process.argv.includes("--persist");

  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const url = `${base.replace(/\/$/, "")}/api/signals/run${persist ? "" : "?dry=1"}`;

  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    console.error("Set CRON_SECRET in .env.local.");
    process.exit(1);
  }

  console.log(persist ? "POST (persist)" : "POST (dry-run)", url);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-cron-secret": cronSecret },
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

  if (persist) {
    console.log("Persisted:", body);
    return;
  }

  console.log(
    `Loans scanned: ${body.loansScanned}   Signals computed: ${body.signalsComputed}`,
  );

  const byType = {};
  for (const s of body.topN ?? []) {
    byType[s.signalType] = (byType[s.signalType] ?? 0) + 1;
  }
  console.log("\n=== By type (top 50 sample) ===");
  for (const [t, n] of Object.entries(byType)) {
    console.log(`  ${t.padEnd(24)} ${n}`);
  }

  console.log("\n=== Top 20 by priority ===");
  for (const s of (body.topN ?? []).slice(0, 20)) {
    console.log(
      `  p${s.priority} ${s.signalType.padEnd(20)} ${(s.loName ?? "-").padEnd(20)} ${s.reason}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
