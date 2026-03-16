/**
 * Run Shape sync for a date range via the app API.
 * Requires dev server running (npm run dev) or set BASE_URL to your deployed app.
 *
 * Usage: node scripts/sync-shape-date-range.js [dateFrom] [dateTo]
 * Example: node scripts/sync-shape-date-range.js 2026-01-01 2026-03-16
 * Default: 2026-01-01 to 2026-03-16
 */

const path = require("path");
const fs = require("fs");

const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf8");
  content.split("\n").forEach((line) => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^["']|["']$/g, "");
      process.env[key] = value;
    }
  });
}

const baseUrl = process.env.BASE_URL || "http://localhost:3000";
const cronSecret = process.env.CRON_SECRET;
const dateFrom = process.argv[2] || "2026-01-01";
const dateTo = process.argv[3] || "2026-03-16";

if (!cronSecret) {
  console.error("CRON_SECRET not set in .env.local");
  process.exit(1);
}

async function main() {
  console.log("Syncing Shape data from", dateFrom, "to", dateTo, "via", baseUrl);
  const res = await fetch(`${baseUrl}/api/sync/shape`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-cron-secret": cronSecret,
    },
    body: JSON.stringify({ dateFrom, dateTo }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("Sync failed:", res.status, data);
    process.exit(1);
  }
  console.log("Sync result:", data);
  console.log("Pages:", data.pages, "| Records processed:", data.recordsProcessed, "| Skipped:", data.recordsSkipped, "| Loans upserted:", data.loansUpserted);
  if (data.unmappedStatuses?.length) {
    console.log("Unmapped statuses:", data.unmappedStatuses.slice(0, 15).join(", "));
  }
}

main();
