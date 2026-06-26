export function DetailGrid({ items }: { items: Array<[string, string | number | null | undefined]> }) {
  return (
    <dl className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-[var(--lo-border)] bg-white px-3 py-3">
          <dt className="lo-muted text-[11px] font-black uppercase tracking-wide">{label}</dt>
          <dd className="lo-heading mt-1 break-words text-sm font-bold">{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
