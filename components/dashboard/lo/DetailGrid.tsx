export function DetailGrid({ items }: { items: Array<[string, string | number | null | undefined]> }) {
  return (
    <dl className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
      {items.map(([label, value]) => (
        <div
          key={label}
          className="rounded-lg border px-3 py-3"
          style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}
        >
          <dt className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">{label}</dt>
          <dd className="mt-1 break-words text-sm font-bold text-foreground">{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
