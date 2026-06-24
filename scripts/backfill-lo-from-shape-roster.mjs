#!/usr/bin/env node
/**
 * Backfill assigned_loan_officer_user_id from Shape depursLo ids in raw_shape_kpi_leads.
 *
 * Usage: node scripts/backfill-lo-from-shape-roster.mjs
 *
 * Requires .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SHAPE_LO_ROSTER = [
  { name: "Tashawna Chisholm", depursLo: 49 },
  { name: "Tyler Johnson", depursLo: 34 },
  { name: "Bastian Johnston", depursLo: 13 },
  { name: "Nikk Smith", depursLo: 3 },
  { name: "Stephen Curry", depursLo: 40 },
  { name: "Jessica Sherard", depursLo: 37 },
  { name: "Ray Conway", depursLo: 16 },
  { name: "Gregory Bethea Jr", depursLo: 58 },
  { name: "Zachary Davis", depursLo: 55 },
  { name: "Jason Friday", depursLo: 52 },
  { name: "Concierge", depursLo: 31 },
];

const NAME_ALIASES = {
  "harrison johnson": "tyler johnson",
  "gregory bethea": "gregory bethea jr",
  "nikk smith": "nikkolas smith",
  "nikkolas smith": "nikk smith",
};

const DEPURS_BY_ID = new Map(SHAPE_LO_ROSTER.map((e) => [e.depursLo, e.name]));

function loadEnvLocal() {
  const envPath = join(__dirname, "..", ".env.local");
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}

function normName(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+(jr|sr|ii|iii|iv)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalName(s) {
  const n = normName(s);
  return NAME_ALIASES[n] ?? n;
}

function parseDepursId(raw) {
  const s = String(raw ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function resolveLoName(row) {
  const loField = String(row["Loan Officer User Name"] ?? "").trim();
  const depurs =
    parseDepursId(row["Shape Depurs LO Id"]) ?? (parseDepursId(loField) ? parseDepursId(loField) : null);
  if (depurs != null) {
    const fromRoster = DEPURS_BY_ID.get(depurs);
    if (fromRoster) return fromRoster;
  }
  if (loField && !/^\d+$/.test(loField)) {
    if (loField.includes(",")) {
      const [a, b] = loField.split(",").map((p) => p.trim());
      if (a && b) return `${b} ${a}`;
    }
    return loField;
  }
  return null;
}

function buildUserLookup(users) {
  const nameToUserId = new Map();
  for (const u of users) {
    const raw = String(u.full_name ?? "").trim();
    if (!raw) continue;
    nameToUserId.set(raw.toLowerCase(), u.id);
    nameToUserId.set(normName(raw), u.id);
    nameToUserId.set(canonicalName(raw), u.id);
    const parts = normName(raw).split(" ").filter(Boolean);
    if (parts.length >= 2) nameToUserId.set(`${parts[0]} ${parts[parts.length - 1]}`, u.id);
  }
  return nameToUserId;
}

function resolveUserId(loName, nameToUserId, users) {
  if (!loName) return null;
  const n = loName.trim().toLowerCase();
  if (nameToUserId.get(n)) return nameToUserId.get(n);
  if (nameToUserId.get(normName(loName))) return nameToUserId.get(normName(loName));
  if (nameToUserId.get(canonicalName(loName))) return nameToUserId.get(canonicalName(loName));
  const parts = normName(loName).split(" ").filter(Boolean);
  if (parts.length < 2) return null;
  const first = parts[0];
  const last = parts[parts.length - 1];
  for (const u of users) {
    const up = canonicalName(u.full_name).split(" ").filter(Boolean);
    if (up.length < 2) continue;
    const lastEq = last === up[up.length - 1];
    const firstClose =
      first === up[0] ||
      first.startsWith(up[0]) ||
      up[0].startsWith(first) ||
      (first.length >= 4 && up[0].length >= 4 && first.slice(0, 4) === up[0].slice(0, 4));
    if (lastEq && firstClose) return u.id;
  }
  return null;
}

function isConcierge(name) {
  const n = normName(name);
  return n === "concierge" || n.startsWith("concierge ");
}

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const admin = createClient(url, key);
  const { data: users } = await admin.from("users").select("id,full_name,email");
  const nameToUserId = buildUserLookup(users ?? []);

  console.log("Pass 1: loans with LO name but no user id...");
  let pass1 = 0;
  let pass1Rounds = 0;
  while (pass1Rounds < 20) {
    pass1Rounds += 1;
    let batch = 0;
    const { data: rows } = await admin
      .from("loans")
      .select("id,assigned_loan_officer_name")
      .is("assigned_loan_officer_user_id", null)
      .not("assigned_loan_officer_name", "is", null)
      .limit(500);
    if (!rows?.length) break;
    for (const row of rows) {
      const loName = resolveLoName({ "Loan Officer User Name": row.assigned_loan_officer_name });
      if (!loName || isConcierge(loName)) continue;
      const uid = resolveUserId(loName, nameToUserId, users ?? []);
      if (!uid) continue;
      const { error } = await admin
        .from("loans")
        .update({
          assigned_loan_officer_user_id: uid,
          assigned_loan_officer_name: loName,
        })
        .eq("id", row.id);
      if (!error) {
        pass1++;
        batch++;
      }
    }
    if (batch === 0) break;
  }
  console.log(`  updated ${pass1}`);

  console.log("Pass 2: raw_shape_kpi_leads for unassigned loans...");
  const rawByRecordId = new Map();
  let offset = 0;
  while (true) {
    const { data: raws } = await admin
      .from("raw_shape_kpi_leads")
      .select("record_id,row,import_batch_id")
      .order("import_batch_id", { ascending: false })
      .range(offset, offset + 999);
    if (!raws?.length) break;
    for (const r of raws) {
      if (!rawByRecordId.has(r.record_id)) rawByRecordId.set(r.record_id, r.row);
    }
    if (raws.length < 1000) break;
    offset += 1000;
  }
  console.log(`  ${rawByRecordId.size} latest raw rows`);

  let pass2 = 0;
  offset = 0;
  while (true) {
    const { data: loans } = await admin
      .from("loans")
      .select("id,shape_record_id")
      .is("assigned_loan_officer_user_id", null)
      .not("shape_record_id", "is", null)
      .range(offset, offset + 499);
    if (!loans?.length) break;
    for (const loan of loans) {
      const row = rawByRecordId.get(loan.shape_record_id);
      if (!row || typeof row !== "object") continue;
      const loName = resolveLoName(row);
      if (!loName || isConcierge(loName)) continue;
      const uid = resolveUserId(loName, nameToUserId, users ?? []);
      if (!uid) continue;
      const { error } = await admin
        .from("loans")
        .update({
          assigned_loan_officer_user_id: uid,
          assigned_loan_officer_name: loName,
        })
        .eq("id", loan.id);
      if (!error) pass2++;
    }
    if (loans.length < 500) break;
    offset += 500;
  }
  console.log(`  updated ${pass2}`);

  const { count } = await admin
    .from("loans")
    .select("*", { count: "exact", head: true })
    .not("assigned_loan_officer_user_id", "is", null);
  console.log(`Total loans with LO user id: ${count ?? 0}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
