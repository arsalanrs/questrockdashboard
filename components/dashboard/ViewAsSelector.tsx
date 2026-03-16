"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

type LoUser = {
  id: string;
  full_name: string | null;
  role: string;
};

export function ViewAsSelector({ users, currentViewAs }: { users: LoUser[]; currentViewAs: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    const params = new URLSearchParams(searchParams.toString());
    if (val) {
      params.set("viewAs", val);
    } else {
      params.delete("viewAs");
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  const selectedUser = users.find((u) => u.id === currentViewAs);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-4 py-2.5">
      <span className="text-xs font-medium text-mutedForeground whitespace-nowrap">Viewing as:</span>
      <select
        value={currentViewAs ?? ""}
        onChange={handleChange}
        className="flex-1 bg-transparent text-sm font-semibold outline-none cursor-pointer"
      >
        <option value="">— Select a loan officer —</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.full_name ?? "Unknown"} ({u.role.replace("_", " ")})
          </option>
        ))}
      </select>
      {selectedUser && (
        <button
          onClick={() => {
            const params = new URLSearchParams(searchParams.toString());
            params.delete("viewAs");
            router.push(`${pathname}?${params.toString()}`);
          }}
          className="text-xs text-mutedForeground hover:text-foreground transition-colors whitespace-nowrap"
        >
          ✕ Clear
        </button>
      )}
    </div>
  );
}
