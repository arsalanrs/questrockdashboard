/**
 * Backfill closed_at for existing Closed/Funded/Purchased loans
 * using the "Date Loan Last Updated" stored in raw_shape_kpi_leads.
 *
 * Usage: node scripts/backfill-closed-at.js
 */
const path = require("path"), fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

function loadEnv() {
  for (const line of fs.readFileSync(path.join(__dirname,"../.env.local"),"utf8").split("\n")) {
    const t=line.trim(); if(!t||t.startsWith("#")) continue;
    const eq=t.indexOf("="); if(eq===-1) continue;
    const k=t.slice(0,eq).trim(), v=t.slice(eq+1).trim();
    if(k&&!process.env[k]) process.env[k]=v;
  }
}

const TIMESTAMP_FORMATS = [
  { regex: /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}) (AM|PM)$/i, fn: (m) => {
    let h = parseInt(m[4]);
    if (m[6].toUpperCase() === "PM" && h !== 12) h += 12;
    if (m[6].toUpperCase() === "AM" && h === 12) h = 0;
    return new Date(parseInt(m[3]), parseInt(m[1])-1, parseInt(m[2]), h, parseInt(m[5])).toISOString();
  }},
  { regex: /^(\d{4})-(\d{2})-(\d{2})/, fn: (m) => new Date(m[0]).toISOString() },
];
function parseTs(value) {
  const v = (value ?? "").trim();
  if (!v || v === "--") return null;
  for (const { regex, fn } of TIMESTAMP_FORMATS) {
    const m = v.match(regex);
    if (m) { try { return fn(m); } catch {} }
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

const CLOSED_STATUSES = new Set(["Closed", "Funded", "Purchased"]);

async function main() {
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // Get all closed loans that need closed_at set
  const { data: loans, error } = await sb
    .from("loans")
    .select("id, shape_record_id, status_raw, closed_at")
    .in("status_raw", ["Closed", "Funded", "Purchased"]);

  if (error) { console.error("loans fetch:", error.message); process.exit(1); }
  console.log(`Found ${loans.length} Closed/Funded/Purchased loans`);

  const needsFill = loans.filter(l => !l.closed_at);
  console.log(`${needsFill.length} are missing closed_at`);

  if (needsFill.length === 0) { console.log("Nothing to backfill."); return; }

  // Fetch raw rows for these loans
  const ids = needsFill.map(l => l.shape_record_id).filter(Boolean);
  const { data: raws, error: rawErr } = await sb
    .from("raw_shape_kpi_leads")
    .select("record_id, row")
    .in("record_id", ids);

  if (rawErr) { console.error("raw fetch:", rawErr.message); process.exit(1); }

  const rawMap = new Map((raws || []).map(r => [r.record_id, r.row]));

  let updated = 0, skipped = 0;
  const updates = [];

  for (const loan of needsFill) {
    const raw = rawMap.get(loan.shape_record_id);
    if (!raw) { skipped++; continue; }

    // Use "Date Loan Last Updated" as the closed_at proxy
    const closedAt = parseTs(raw["Date Loan Last Updated"]) ?? parseTs(raw["Created Date"]);
    if (!closedAt) { skipped++; continue; }

    updates.push({ id: loan.id, closed_at: closedAt });
    updated++;
  }

  console.log(`\nBackfilling ${updates.length} loans...`);

  // Batch update in chunks of 500
  for (let i = 0; i < updates.length; i += 500) {
    const chunk = updates.slice(i, i + 500);
    for (const u of chunk) {
      const { error: upErr } = await sb.from("loans").update({ closed_at: u.closed_at }).eq("id", u.id);
      if (upErr) console.error(`  update ${u.id}:`, upErr.message);
    }
    process.stdout.write(`  ${Math.min(i + 500, updates.length)} / ${updates.length}\r`);
  }

  console.log(`\nDone. Updated: ${updated}, Skipped (no date): ${skipped}`);

  // Verify
  const { count } = await sb.from("loans").select("*", { count: "exact", head: true }).not("closed_at", "is", null);
  console.log(`Loans with closed_at in DB: ${count}`);
}

main().catch(e => { console.error(e); process.exit(1); });
