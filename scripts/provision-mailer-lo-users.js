/**
 * Create or reset Supabase Auth users for mailer LO desk logins.
 * Uses SUPABASE_SERVICE_ROLE_KEY from QRdashboard .env.local.
 *
 * Run: node scripts/provision-mailer-lo-users.js
 * Optional: node scripts/provision-mailer-lo-users.js "CustomPassword!"
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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.argv[2] || "WelcomeToQuestRock1!";

const USERS = [
  { email: "arashid@questrock.com", full_name: "Arsalan Rashid", role: "executive" },
  { email: "bmedley@questrock.com", full_name: "Bill Medley", role: "executive" },
  { email: "nikksmith@questrock.com", full_name: "Nikk Smith", role: "executive" },
  { email: "rayconway@questrock.com", full_name: "Ray Conway", role: "executive" },
  { email: "bastianjohnston@questrock.com", full_name: "Bastian Johnston", role: "manager" },
  { email: "jfriday@questrock.com", full_name: "Jason Friday", role: "manager" },
  { email: "tchisholm@questrock.com", full_name: "Tashawna Chisholm", role: "manager" },
  { email: "tjohnson@questrock.com", full_name: "Tyler Johnson", role: "loan_officer" },
  { email: "scurry@questrock.com", full_name: "Stephen Curry", role: "loan_officer" },
  { email: "jsherard@questrock.com", full_name: "Jessica Sherard", role: "loan_officer" },
  { email: "gbethea@questrock.com", full_name: "Gregory Bethea Jr", role: "loan_officer" },
  { email: "zdavis@questrock.com", full_name: "Zachary Davis", role: "loan_officer" },
];

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const { createClient } = require("@supabase/supabase-js");
const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function ensureAuthUser(email) {
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 500 });
  if (listErr) throw listErr;

  const existing = list.users.find((u) => (u.email || "").toLowerCase() === email.toLowerCase());
  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: { full_name: USERS.find((u) => u.email === email).full_name },
    });
    if (error) throw error;
    return { email, action: "updated", id: existing.id };
  }

  const meta = USERS.find((u) => u.email === email);
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: meta.full_name },
  });
  if (createErr) throw createErr;
  return { email, action: "created", id: created.user.id };
}

async function ensurePublicUser({ email, full_name, role }) {
  const { data: rows, error: fetchErr } = await admin
    .from("users")
    .select("id,email,full_name,role,is_active")
    .eq("email", email)
    .limit(1);
  if (fetchErr) throw fetchErr;

  if (rows?.[0]) {
    const { error } = await admin
      .from("users")
      .update({ full_name, role, is_active: true })
      .eq("email", email);
    if (error) throw error;
    return { email, action: "profile_updated" };
  }

  const { error } = await admin.from("users").insert({
    email,
    full_name,
    role,
    is_active: true,
  });
  if (error) throw error;
  return { email, action: "profile_created" };
}

async function main() {
  for (const user of USERS) {
    const auth = await ensureAuthUser(user.email);
    const profile = await ensurePublicUser(user);
    console.log(`${user.email}: auth ${auth.action}, ${profile.action}`);
  }
  console.log("Done. Password:", password);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
