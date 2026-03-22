/**
 * Vercel Cron: when CRON_SECRET is set in the project, Vercel sends
 * Authorization: Bearer <CRON_SECRET> on cron invocations.
 * Manual / external schedulers can use header x-cron-secret: <CRON_SECRET> instead.
 */
export function isCronRequestAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return false;

  if (request.headers.get("x-cron-secret") === cronSecret) return true;

  const auth = request.headers.get("authorization")?.trim();
  if (!auth) return false;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return Boolean(m && m[1] === cronSecret);
}
