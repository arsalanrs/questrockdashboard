/**
 * Backfill assigned_loan_officer_user_id for all loans using:
 *  1. The CSV file (most reliable, exact names)
 *  2. The LOA User Name in raw Shape data (reversed Last,First → First Last)
 *
 * Usage: node scripts/backfill-lo-from-csv.js
 */
const path = require("path"), fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

function loadEnv() {
  for (const line of fs.readFileSync(path.join(__dirname, "../.env.local"), "utf8").split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("="); if (eq === -1) continue;
    const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim();
    if (k && !process.env[k]) process.env[k] = v;
  }
}

// Parse a CSV line respecting quoted fields
function parseCSVLine(line) {
  const result = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { result.push(cur.trim()); cur = ""; }
    else { cur += c; }
  }
  result.push(cur.trim());
  return result;
}

// Normalise a name for comparison: lowercase, remove punctuation, collapse spaces
function normName(n) {
  return (n || "").toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

// Try to match a name against the user list; return user id or null
function matchUser(name, users) {
  const norm = normName(name);
  if (!norm) return null;

  // Exact match first
  for (const u of users) {
    if (normName(u.full_name) === norm) return u.id;
  }

  // Partial: first + last word match (handles "Bastian Johnston" vs "Bastian Johnston")
  const parts = norm.split(" ");
  for (const u of users) {
    const uparts = normName(u.full_name).split(" ");
    if (parts[0] && uparts[0] && parts[0] === uparts[0] && parts[parts.length-1] === uparts[uparts.length-1]) return u.id;
  }

  // Partial: last name match only (for "Nikkolas, Smith" reversed to "Smith Nikkolas")
  for (const u of users) {
    const uparts = normName(u.full_name).split(" ");
    if (parts.some(p => p.length > 3 && uparts.includes(p))) return u.id;
  }

  return null;
}

async function main() {
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // Load users
  const { data: users } = await sb.from("users").select("id,full_name,role");
  const loUsers = (users || []).filter(u => ["loan_officer","manager","executive","admin"].includes(u.role));
  console.log("Users available for matching:");
  for (const u of loUsers) console.log(" ", u.full_name, `(${u.role})`);

  // ── PASS 1: build recordId → loName map from CSV ──────────────────────
  const csvPath = path.join(__dirname, "../customreportcsv_172522-0.csv");
  const csvLoMap = new Map(); // recordId (number) → lo full name

  if (fs.existsSync(csvPath)) {
    const lines = fs.readFileSync(csvPath, "utf8").split("\n").filter(Boolean);
    const headers = parseCSVLine(lines[0]);
    const idIdx = headers.findIndex(h => /recordid|record.id|lead.id/i.test(h));
    const loIdx = headers.findIndex(h => /loan.officer.user.name/i.test(h));
    console.log(`\nCSV columns: recordId@${idIdx}, LO@${loIdx}`);
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      const id = Number(cols[idIdx]);
      const loName = (cols[loIdx] || "").replace(/"/g, "").trim();
      if (id && loName) csvLoMap.set(id, loName);
    }
    console.log(`CSV: ${csvLoMap.size} records with LO names`);
  } else {
    console.log("CSV file not found — skipping pass 1");
  }

  // ── PASS 2: build recordId → loName from raw_shape_kpi_leads ──────────
  const rawLoMap = new Map();
  let rawPage = 0;
  while (true) {
    const { data: raws } = await sb
      .from("raw_shape_kpi_leads")
      .select("record_id,row")
      .range(rawPage * 1000, rawPage * 1000 + 999);
    if (!raws || raws.length === 0) break;
    for (const r of raws) {
      const row = r.row || {};
      // Try all possible LO keys in the raw row
      const lo =
        row["Loan Officer User Name"] ||
        row["LOA User Name"] ||
        row["loanOfficerUserName"] ||
        row["depursLo"] || row["depurLo"] || "";
      if (lo && lo.trim()) rawLoMap.set(r.record_id, lo.trim());
    }
    if (raws.length < 1000) break;
    rawPage++;
  }
  console.log(`Raw data: ${rawLoMap.size} records with LO names`);

  // Show sample raw names to understand format
  const rawSamples = [...rawLoMap.entries()].slice(0, 5);
  if (rawSamples.length) {
    console.log("Sample raw LO names (might be 'Last, First' format):");
    rawSamples.forEach(([id, n]) => console.log(" ", id, "->", n));
  }

  // ── Merge: CSV wins over raw ────────────────────────────────────────
  const mergedMap = new Map([...rawLoMap]);
  for (const [id, name] of csvLoMap) mergedMap.set(id, name); // CSV overrides
  console.log(`\nTotal records with LO data: ${mergedMap.size}`);

  // ── Load all loans ──────────────────────────────────────────────────
  const { data: loans } = await sb.from("loans").select("id,shape_record_id,assigned_loan_officer_user_id");
  const toUpdate = [];
  const unmatchedNames = new Map();

  for (const loan of loans || []) {
    const rid = loan.shape_record_id;
    if (!rid) continue;

    let loName = mergedMap.get(rid);
    if (!loName) continue;

    // Handle "Last, First" format → reverse to "First Last"
    if (loName.includes(",")) {
      const [last, first] = loName.split(",").map(s => s.trim());
      loName = first ? `${first} ${last}` : last;
    }

    const userId = matchUser(loName, loUsers);
    if (!userId) {
      unmatchedNames.set(loName, (unmatchedNames.get(loName) || 0) + 1);
      continue;
    }

    // Only update if different from current
    if (loan.assigned_loan_officer_user_id !== userId) {
      toUpdate.push({ id: loan.id, assigned_loan_officer_user_id: userId, assigned_loan_officer_name: loName });
    }
  }

  console.log(`\nLoans to update: ${toUpdate.length}`);
  if (unmatchedNames.size) {
    console.log("Could not match these LO names to a user:");
    for (const [n, c] of unmatchedNames) console.log(" ", n, `(${c} loans)`);
  }

  if (toUpdate.length === 0) { console.log("Nothing to update."); return; }

  // ── Batch update ────────────────────────────────────────────────────
  let done = 0;
  for (const u of toUpdate) {
    const { error } = await sb.from("loans")
      .update({ assigned_loan_officer_user_id: u.assigned_loan_officer_user_id, assigned_loan_officer_name: u.assigned_loan_officer_name })
      .eq("id", u.id);
    if (error) console.error("  update error:", error.message);
    else done++;
    if (done % 50 === 0) process.stdout.write(`  ${done}/${toUpdate.length}\r`);
  }

  console.log(`\nDone. Updated ${done} loans.`);

  // ── Summary ──────────────────────────────────────────────────────────
  const { count: assigned } = await sb.from("loans").select("*", { count: "exact", head: true }).not("assigned_loan_officer_user_id", "is", null);
  const { count: total } = await sb.from("loans").select("*", { count: "exact", head: true });
  console.log(`\nAssigned: ${assigned}/${total} loans`);

  // Per-LO count
  const { data: perLo } = await sb.from("loans").select("assigned_loan_officer_user_id").not("assigned_loan_officer_user_id","is",null);
  const loCounts = new Map();
  for (const l of perLo || []) loCounts.set(l.assigned_loan_officer_user_id, (loCounts.get(l.assigned_loan_officer_user_id)||0)+1);
  const userMap = new Map((users||[]).map(u=>[u.id, u.full_name]));
  console.log("\nPer-LO loan counts:");
  for (const [uid, cnt] of [...loCounts.entries()].sort((a,b)=>b[1]-a[1])) {
    console.log(" ", (userMap.get(uid)||uid).padEnd(25), cnt, "loans");
  }
}

main().catch(e => { console.error(e); process.exit(1); });
