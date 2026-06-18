/** QuestRock executives — full QR Dashboard access (hub SSO + direct login). */
const DEFAULT_ALLOWED = [
  'arashid@questrock.com',
  'nikksmith@questrock.com',
  'bmedley@questrock.com',
  'rayconway@questrock.com',
];

export function getDashboardAllowedEmails(): Set<string> {
  const fromEnv = process.env.QR_DASHBOARD_ALLOWED_EMAILS?.trim();
  const list = fromEnv
    ? fromEnv.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
    : DEFAULT_ALLOWED;
  return new Set(list.map((e) => e.toLowerCase()));
}

export function canAccessDashboard(email: string | undefined | null): boolean {
  if (!email) return false;
  return getDashboardAllowedEmails().has(email.trim().toLowerCase());
}
