/** LOs hidden from the LO dashboard officer filter (inactive / not on this workspace). */
export const EXCLUDED_LO_DASHBOARD_NAMES = new Set([
  "Jessica Sherard",
  "Stephen Curry",
]);

export function isExcludedLoDashboardUser(fullName: string | null | undefined): boolean {
  if (!fullName) return false;
  const trimmed = fullName.trim();
  if (EXCLUDED_LO_DASHBOARD_NAMES.has(trimmed)) return true;
  for (const excluded of EXCLUDED_LO_DASHBOARD_NAMES) {
    if (trimmed.toLowerCase().includes(excluded.toLowerCase())) return true;
  }
  return false;
}

export function filterLoDashboardUsers<T extends { full_name: string | null }>(users: T[]): T[] {
  return users.filter((u) => !isExcludedLoDashboardUser(u.full_name));
}

export type LoSelectOption = { id: string; full_name: string | null };

/** DB users + any assigned LO names seen on loans (helps when user_id backfill is missing). */
export function buildLoSelectOptions(
  dbUsers: LoSelectOption[],
  loans: Array<{ assigned_loan_officer_user_id?: string | null; assigned_loan_officer_name?: string | null }>,
): LoSelectOption[] {
  const out = filterLoDashboardUsers(dbUsers).map((u) => ({ id: u.id, full_name: u.full_name }));
  const seenNames = new Set(out.map((u) => u.full_name?.trim().toLowerCase()).filter(Boolean));
  const seenIds = new Set(out.map((u) => u.id));

  for (const loan of loans) {
    const name = loan.assigned_loan_officer_name?.trim();
    if (!name || isExcludedLoDashboardUser(name)) continue;
    const key = name.toLowerCase();
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    const id = loan.assigned_loan_officer_user_id && seenIds.has(loan.assigned_loan_officer_user_id)
      ? loan.assigned_loan_officer_user_id
      : `name:${name}`;
    if (!seenIds.has(id)) {
      out.push({ id, full_name: name });
      seenIds.add(id);
    }
  }

  return out.sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""));
}

export function loanMatchesLoFilter(
  loan: { assigned_loan_officer_user_id?: string | null; assigned_loan_officer_name?: string | null },
  ownerFilter: string,
  options: LoSelectOption[],
): boolean {
  if (ownerFilter === "all") return true;
  if (ownerFilter.startsWith("name:")) {
    return loan.assigned_loan_officer_name?.trim() === ownerFilter.slice(5);
  }
  if (loan.assigned_loan_officer_user_id === ownerFilter) return true;
  const selected = options.find((o) => o.id === ownerFilter);
  if (selected?.full_name && loan.assigned_loan_officer_name?.trim() === selected.full_name.trim()) return true;
  return false;
}
