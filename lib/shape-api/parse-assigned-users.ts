/**
 * Parse Shape Search API AssignedUsers entries.
 * Format: ["depursLi:3", "depursPo:22"]
 */
export type ShapeAssignedUsers = Partial<
  Record<"depursLo" | "depursLi" | "depursLp" | "depursPo" | "depursCl", string>
>;

export function parseAssignedUsers(raw: unknown): ShapeAssignedUsers {
  const out: ShapeAssignedUsers = {};
  if (!Array.isArray(raw)) return out;

  for (const entry of raw) {
    const s = String(entry ?? "").trim();
    const colon = s.indexOf(":");
    if (colon <= 0) continue;
    const dept = s.slice(0, colon).trim();
    const userId = s.slice(colon + 1).trim();
    if (!userId) continue;
    if (
      dept === "depursLo" ||
      dept === "depursLi" ||
      dept === "depursLp" ||
      dept === "depursPo" ||
      dept === "depursCl"
    ) {
      out[dept] = userId;
    }
  }
  return out;
}

/** Primary Shape user id for dashboard LO (same priority as bulk import). */
export function primaryAssignedUserId(assignments: ShapeAssignedUsers): string | null {
  return (
    assignments.depursLo ??
    assignments.depursLi ??
    assignments.depursLp ??
    assignments.depursPo ??
    assignments.depursCl ??
    null
  );
}
