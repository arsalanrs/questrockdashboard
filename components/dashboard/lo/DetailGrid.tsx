import { cn } from "@/lib/cn";

function valueClass(label: string, value: string | number | null | undefined) {
  if (label === "Source") return "is-source";
  if (typeof value === "number") return "is-number";
  if (label.toLowerCase().includes("amount") || label.toLowerCase().includes("attempts")) return "is-number";
  return undefined;
}

export function DetailGrid({ items }: { items: Array<[string, string | number | null | undefined]> }) {
  return (
    <dl className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="lo-detail-cell rounded-lg px-3 py-3">
          <dt className="lo-muted text-[11px] font-black uppercase tracking-wide">{label}</dt>
          <dd
            className={cn(
              "lo-detail-value mt-1 break-words text-sm font-bold",
              valueClass(label, value),
            )}
          >
            {value ?? "—"}
          </dd>
        </div>
      ))}
    </dl>
  );
}
