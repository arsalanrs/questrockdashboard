import { z } from "zod";

const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

const serverEnvSchema = clientEnvSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
});

export function getClientEnv() {
  const parsed = clientEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Missing/invalid client env: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function getServerEnv() {
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Missing/invalid server env: ${parsed.error.message}`);
  }
  return parsed.data;
}

