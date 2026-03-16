const glassCard = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.07)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
} as React.CSSProperties;

export default function DashboardLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-6 w-48 rounded-lg bg-white/5" />
        <div className="h-4 w-32 rounded bg-white/5" />
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl p-4 space-y-3 min-h-[110px] flex flex-col justify-between" style={glassCard}>
            <div className="h-3 w-24 rounded bg-white/5" />
            <div className="h-8 w-16 rounded bg-white/5" />
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex-1 rounded-lg p-4 space-y-2" style={glassCard}>
            <div className="mx-auto h-3 w-14 rounded bg-white/5" />
            <div className="mx-auto h-6 w-8 rounded bg-white/5" />
          </div>
        ))}
      </div>

      <div className="rounded-xl overflow-hidden" style={glassCard}>
        <div className="h-10 border-b bg-white/[0.02]" style={{ borderColor: "rgba(255,255,255,0.05)" }} />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex gap-4 border-b px-4 py-3" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
            <div className="h-4 w-28 rounded bg-white/5" />
            <div className="h-4 w-16 rounded bg-white/5" />
            <div className="h-4 w-20 rounded bg-white/5" />
            <div className="flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}
