/**
 * Calls POST /api/sync/shape to pull Shape leads and write to Supabase (raw_shape_kpi_leads + loans).
 * Run with dev server up: npm run dev (then in another terminal) npm run shape:sync
 *
 * Requires .env.local:
 *   SHAPE_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   CRON_SECRET (so the API accepts the request without browser auth)
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
  const url = `${base.replace(/\/$/, "")}/api/sync/shape`;
  const cronSecret = process.env.CRON_SECRET?.trim();

  if (!cronSecret) {
    console.error("Set CRON_SECRET in .env.local so the sync API accepts this request.");
    console.error("Then start the app (npm run dev) and run this script: npm run shape:sync");
    process.exit(1);
  }

  console.log("POST", url);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-cron-secret": cronSecret },
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

  console.log("Synced to Supabase:", json);
  console.log(
    "Pages:",
    json.pages,
    "Records:",
    json.recordsProcessed,
    "Loans upserted:",
    json.loansUpserted
  );
  if (json.unmappedStatuses?.length) {
    console.log("Unmapped statuses:", json.unmappedStatuses.join(", "));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
