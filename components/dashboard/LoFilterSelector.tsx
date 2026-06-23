"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

type LoUser = { id: string; full_name: string | null };

export function LoFilterSelector({
  users,
  selectedLoId,
}: {
  users: LoUser[];
  selectedLoId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    const params = new URLSearchParams(searchParams.toString());
    if (val) {
      params.set("lo", val);
    } else {
      params.delete("lo");
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="lo-filter" className="text-xs font-medium text-muted-foreground whitespace-nowrap">
        LO filter:
      </label>
      <select
        id="lo-filter"
        value={selectedLoId ?? ""}
        onChange={handleChange}
        className="rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none"
      >
        <option value="">All team</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.full_name ?? "Unknown"}
          </option>
        ))}
      </select>
    </div>
  );
}
