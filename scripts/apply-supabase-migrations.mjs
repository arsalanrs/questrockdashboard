/**
 * Applies SQL files in supabase/migrations/ to the remote Supabase Postgres database.
 *
 * Preferred (avoids IPv6-only direct host issues on some networks):
 *   DATABASE_URL or SUPABASE_DATABASE_URL — full URI from Dashboard → Database → Connection string
 *   Use "Session mode" or "Direct connection" URI (pooler host like *.pooler.supabase.com works on IPv4).
 *
 * Alternative:
 *   NEXT_PUBLIC_SUPABASE_URL + SUPABASE_DB_PASSWORD — builds db.<ref>.supabase.co (often IPv6-only).
 *
 * Optional override: SUPABASE_DB_HOST, SUPABASE_DB_PORT, SUPABASE_DB_USER (if not using DATABASE_URL).
 *
 * Does not use LendingPad env vars; those are for the app only.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function loadDotEnvLocal() {
  const p = path.join(root, ".env.local");
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const env = { ...process.env, ...loadDotEnvLocal() };
const supabaseUrl =
  env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || "";
const match = supabaseUrl.match(/https?:\/\/([^.]+)\.supabase\.co/);
const projectRef = match?.[1];
const password = env.SUPABASE_DB_PASSWORD;

let connectionString = (
  env.DATABASE_URL ||
  env.SUPABASE_DATABASE_URL ||
  env.SUPABASE_DB_URL ||
  ""
).trim();

function ensureSslForSupabase(url) {
  if (!url || url.includes("sslmode=")) return url;
  const sep = url.includes("?") ? "&" : "?";
  // Quieter node-pg warning; matches libpq ssl semantics (see pg-connection-string v2 warning text).
  return `${url}${sep}uselibpqcompat=true&sslmode=require`;
}

function buildClientConfig() {
  if (connectionString) {
    return {
      connectionString: ensureSslForSupabase(connectionString),
      ssl: { rejectUnauthorized: false },
    };
  }

  const host =
    env.SUPABASE_DB_HOST ||
    (projectRef ? `db.${projectRef}.supabase.co` : null);
  const port = parseInt(env.SUPABASE_DB_PORT || "5432", 10);
  const user = env.SUPABASE_DB_USER || "postgres";

  if (!host || !password) {
    if (!connectionString) {
      console.error(
        "Set DATABASE_URL (or SUPABASE_DATABASE_URL) from Supabase → Database → Connection string,"
      );
      console.error(
        "or set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_DB_PASSWORD (and optional SUPABASE_DB_HOST)."
      );
    }
    if (!host && !connectionString) {
      console.error(
        "Missing host: add DATABASE_URL or NEXT_PUBLIC_SUPABASE_URL / SUPABASE_DB_HOST."
      );
    }
    if (!password && !connectionString) {
      console.error(
        "Missing SUPABASE_DB_PASSWORD (not needed if password is already in DATABASE_URL)."
      );
    }
    console.error(
      "Note: LendingPad env vars do not run migrations. If you see ENOTFOUND for db.*.supabase.co, use the Session pooler URI from the dashboard (IPv4-friendly)."
    );
    process.exit(1);
  }

  return {
    host,
    port,
    user,
    password,
    database: env.SUPABASE_DB_DATABASE || "postgres",
    ssl: { rejectUnauthorized: false },
  };
}

const migrationsDir = path.join(root, "supabase", "migrations");
const files = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const clientConfig = buildClientConfig();
const client = new pg.Client(clientConfig);

async function main() {
  try {
    await client.connect();
  } catch (e) {
    if (e.code === "ENOTFOUND" && !connectionString) {
      console.error(e.message);
      console.error(
        "\nDirect host db.<project>.supabase.co is often IPv6-only. Your network may not resolve it."
      );
      console.error(
        "Fix: In Supabase Dashboard → Project Settings → Database, copy the Connection string"
      );
      console.error(
        '(URI), preferably "Session pooler" or the host under Connection pooling, and set DATABASE_URL in .env.local.'
      );
    }
    throw e;
  }
  const hostLabel = connectionString
    ? "(connection string)"
    : clientConfig.host || "postgres";
  console.log("Connected to", hostLabel);
  for (const f of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, f), "utf8");
    if (!sql.trim()) continue;
    console.log("Applying", f, "...");
    await client.query(sql);
    console.log("  OK");
  }
  await client.end();
  console.log("All migrations applied.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
