/**
 * Reset Hub / Intelligence Hub auth for QuestRock executives.
 * Uses QR Dashboard Supabase (= Central Hub login = inbound mailer desk login).
 *
 * Run: node scripts/provision-executive-admins.js "YourPassword"
 */

const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach((line) => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^["']|["']$/g, '');
      process.env[key] = value;
    }
  });
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.argv[2] || process.env.SSO_BOOTSTRAP_PASSWORD;

const EXECUTIVES = [
  { email: 'arashid@questrock.com', full_name: 'Arsalan Rashid' },
  { email: 'nikksmith@questrock.com', full_name: 'Nikk Smith' },
  { email: 'bmedley@questrock.com', full_name: 'Bill Medley' },
  { email: 'rayconway@questrock.com', full_name: 'Ray Conway' },
];

if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

if (!password) {
  console.error('Pass password as argv[2] or set SSO_BOOTSTRAP_PASSWORD');
  process.exit(1);
}

const { createClient } = require('@supabase/supabase-js');
const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function ensureAuthUser({ email, full_name }) {
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 500 });
  if (listErr) throw listErr;

  const existing = list.users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: { full_name },
    });
    if (error) throw error;
    return { email, action: 'password_updated', id: existing.id };
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });
  if (createErr) throw createErr;
  return { email, action: 'created', id: created.user.id };
}

async function ensurePublicUser({ email, full_name }) {
  const { data: rows, error: fetchErr } = await admin
    .from('users')
    .select('id,email,full_name,role,is_active')
    .eq('email', email)
    .limit(1);
  if (fetchErr) throw fetchErr;

  if (rows?.[0]) {
    const { error } = await admin
      .from('users')
      .update({ full_name, role: 'executive', is_active: true })
      .eq('email', email);
    if (error) throw error;
    return { email, action: 'profile_updated' };
  }

  const { error } = await admin.from('users').insert({
    email,
    full_name,
    role: 'executive',
    is_active: true,
  });
  if (error) throw error;
  return { email, action: 'profile_created' };
}

async function main() {
  for (const user of EXECUTIVES) {
    const auth = await ensureAuthUser(user);
    const profile = await ensurePublicUser(user);
    console.log(`${user.email}: auth ${auth.action}, ${profile.action}`);
  }
  console.log('Done. Executive admins provisioned.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
