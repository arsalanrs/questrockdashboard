/**
 * One-off: create technical user arsalan@questrock.com with admin role.
 * Run: node scripts/create-technical-user.js
 * (Loads .env.local from project root.)
 */

const fs = require("fs");
const path = require("path");

// Load .env.local
const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8")
    .split("\n")
    .forEach((line) => {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
    });
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const EMAIL = "arsalan@questrock.com";
const PASSWORD = "Questrock123!";
const FULL_NAME = "Arsalan";
const ROLE = "admin";

async function main() {
  const { data: user, error: createError } = await supabase.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: FULL_NAME },
  });

  if (createError) {
    if (String(createError.message).toLowerCase().includes("already")) {
      console.log("User already exists. Ensuring public.users row and role...");
      const { data: existing } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const found = existing?.users?.find((u) => (u.email || "").toLowerCase() === EMAIL.toLowerCase());
      if (!found) {
        console.error(createError.message);
        process.exit(1);
      }
      // Reset password to the desired value
      const { error: updateError } = await supabase.auth.admin.updateUserById(found.id, {
        password: PASSWORD,
      });
      if (updateError) {
        console.error("Failed to update password:", updateError.message);
        process.exit(1);
      }
      const { error: upsertError } = await supabase
        .from("users")
        .upsert({ id: found.id, email: EMAIL, full_name: FULL_NAME, role: ROLE, is_active: true }, { onConflict: "id" });
      if (upsertError) {
        console.error("Failed to update public.users:", upsertError.message);
        process.exit(1);
      }
      console.log("Updated existing user to admin and reset password. You can sign in at http://localhost:3000/login");
      return;
    }
    console.error("Create user failed:", createError.message);
    process.exit(1);
  }

  const { error: profileError } = await supabase
    .from("users")
    .upsert({ id: user.user.id, email: EMAIL, full_name: FULL_NAME, role: ROLE, is_active: true }, { onConflict: "id" });

  if (profileError) {
    console.error("Profile upsert failed:", profileError.message);
    process.exit(1);
  }

  console.log("Created technical user:", EMAIL, "role:", ROLE);
  console.log("Sign in at http://localhost:3000/login");
}

main();
