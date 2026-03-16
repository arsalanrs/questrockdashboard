/**
 * One-time script to set password for a user (e.g. when locked out).
 * Loads .env.local and uses SUPABASE_SERVICE_ROLE_KEY.
 *
 * Run: node scripts/reset-password.js <email> <newPassword>
 * Example: node scripts/reset-password.js arsalanr839@gmail.com "questrock123!"
 */

const path = require("path");
const fs = require("fs");

// Load .env.local
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
const email = process.argv[2];
const newPassword = process.argv[3];

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
if (!email || !newPassword) {
  console.error("Usage: node scripts/reset-password.js <email> <newPassword>");
  console.error('Example: node scripts/reset-password.js arsalanr839@gmail.com "questrock123!"');
  process.exit(1);
}

const { createClient } = require("@supabase/supabase-js");
const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 500 });
  if (listErr) {
    console.error("List users error:", listErr.message);
    process.exit(1);
  }
  let user = list.users.find((u) => (u.email || "").toLowerCase() === email.toLowerCase());
  if (!user) {
    console.log("User not found, creating...");
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: newPassword,
      email_confirm: true,
    });
    if (createErr) {
      console.error("Create user error:", createErr.message);
      process.exit(1);
    }
    user = created.user;
    console.log("User created and password set for", email);
    console.log("Add them to public.users in Supabase SQL Editor (see scripts/add-admin-arsalan.sql)");
    return;
  }
  const { error } = await admin.auth.admin.updateUserById(user.id, { password: newPassword });
  if (error) {
    console.error("Update password error:", error.message);
    process.exit(1);
  }
  console.log("Password updated for", email);
}

main();
