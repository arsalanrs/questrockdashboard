/**
 * Verify that LO assignment was set correctly after sync.
 * Run: node scripts/verify-lo-assignment.js
 */
const path = require("path");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) { console.error("Missing .env.local"); process.exit(1); }
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("="); if (eq === -1) continue;
    const k = t.slice(0, eq).trim(); const v = t.slice(eq + 1).trim();
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}

async function main() {
  loadEnvLocal();
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data, error } = await supabase
    .from("loans")
    .select("assigned_loan_officer_name, assigned_loan_officer_user_id");
  if (error) { console.error(error.message); process.exit(1); }

  const byName = {};
  for (const row of data) {
    const name = row.assigned_loan_officer_name || "(Unassigned)";
    if (!byName[name]) byName[name] = { withId: 0, noId: 0 };
    if (row.assigned_loan_officer_user_id) byName[name].withId++;
    else byName[name].noId++;
  }

  console.log("=== LO Assignment Verification ===\n");
  console.log(`Total loans: ${data.length}`);
  const unassigned = data.filter(r => !r.assigned_loan_officer_user_id).length;
  console.log(`Unassigned (no user_id): ${unassigned}`);
  console.log(`Assigned: ${data.length - unassigned}\n`);

  const sorted = Object.entries(byName).sort(([a], [b]) => {
    if (a === "(Unassigned)") return 1;
    if (b === "(Unassigned)") return -1;
    return a.localeCompare(b);
  });

  for (const [name, counts] of sorted) {
    const total = counts.withId + counts.noId;
    const status = counts.withId === total ? "OK" : counts.withId > 0 ? "PARTIAL" : "NO USER_ID";
    console.log(`  ${name}: ${total} loans — user_id set: ${counts.withId}/${total} [${status}]`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
