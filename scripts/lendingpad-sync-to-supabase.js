/**
 * Calls GET /api/sync/lendingpad (loans list + conditions) with x-cron-secret.
 * Run with dev server: npm run dev (then) npm run lendingpad:sync
 *
 * Requires .env.local:
 *   LENDINGPAD_* (see .env.local.example)
 *   LENDINGPAD_LIST_USER_ID or LENDINGPAD_OFFICERS_JSON — required for loan rows from list/loans
 *   CRON_SECRET
 *   LendingPad: enable inbound API for the integration contact
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
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

async function main() {
  loadEnvLocal();

  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const url = `${base.replace(/\/$/, "")}/api/sync/lendingpad`;
  const cronSecret = process.env.CRON_SECRET?.trim();

  if (!cronSecret) {
    console.error("Set CRON_SECRET in .env.local so the sync API accepts this request.");
    process.exit(1);
  }

  if (!process.env.LENDINGPAD_LIST_USER_ID?.trim()) {
    console.warn(
      "LENDINGPAD_LIST_USER_ID is unset — loan list sync will be skipped (conditions may still run).",
    );
  }

  console.log("GET", url);
  const res = await fetch(url, {
    method: "GET",
    headers: { "x-cron-secret": cronSecret },
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    console.error("Response:", text.slice(0, 400));
    process.exit(1);
  }

  if (!res.ok) {
    console.error("Sync failed:", res.status, json.error || text.slice(0, 200));
    process.exit(1);
  }

  console.log(JSON.stringify(json, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
