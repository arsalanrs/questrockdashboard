"use client";

import { useState } from "react";
import { format } from "date-fns";

/* ---- Types ---------------------------------------------------------------- */

export type StuckLoan = {
  id: string;
  borrowerName: string;
  stage: string | null;
  stageLabel: string;
  loName: string | null;
  daysInStage: number | null;
  slaMax: number | null;
  daysOver: number;
  openConditions: number;
  shapeUrl: string | null;
};

export type BasicLoan = {
  id: string;
  borrowerName: string;
  phone?: string | null;
  source?: string | null;
  stage: string | null;
  statusRaw: string | null;
  loName: string | null;
  createdAt: string | null;
  shapeUrl: string | null;
  daysStuck?: number | null;
};

export type NotMovingTabsProps = {
  stuckLoans: StuckLoan[];
  untouchedLeads: BasicLoan[];
  notContactedStuck: BasicLoan[];
  pitchedWaiting: BasicLoan[];
  prePipeStalled: BasicLoan[];
  signedNoAppraisal: BasicLoan[];
};

/* ---- Helpers -------------------------------------------------------------- */

function ShapeLink({ url, id }: { url: string | null; id: number | null }) {
  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded px-2 py-0.5 text-[11px] font-medium transition-opacity hover:opacity-80"
        style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}
      >
        Open ↗
      </a>
    );
  }
  return <span className="font-mono text-[11px]" style={{ color: "hsl(215 14% 45%)" }}>{id ?? "—"}</span>;
}

function Pill({
  children,
  color,
}: {
  children: React.ReactNode;
  color: "red" | "amber" | "green" | "muted";
}) {
  const styles = {
    red:   { background: "rgba(255,75,75,0.12)",   color: "#FF4B4B" },
    amber: { background: "rgba(245,158,11,0.12)",  color: "#F59E0B" },
    green: { background: "rgba(34,197,94,0.10)",   color: "#22C55E" },
    muted: { background: "rgba(255,255,255,0.06)", color: "hsl(215 14% 52%)" },
  };
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap"
      style={styles[color]}
    >
      {children}
    </span>
  );
}

function AlertRow({
  dotColor,
  title,
  sub,
  right,
  href,
}: {
  dotColor: string;
  title: React.ReactNode;
  sub?: React.ReactNode;
  right?: React.ReactNode;
  href?: string | null;
}) {
  return (
    <div
      className="flex items-start gap-3 px-4 py-3 transition-colors"
      style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.02)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "")}
    >
      <div className="mt-[5px] h-2 w-2 shrink-0 rounded-full" style={{ background: dotColor }} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium" style={{ color: "hsl(210 20% 96%)" }}>
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {title}
            </a>
          ) : title}
        </div>
        {sub && (
          <div className="mt-0.5 truncate text-[11px]" style={{ color: "hsl(215 14% 52%)" }}>
            {sub}
          </div>
        )}
      </div>
      {right && <div className="shrink-0 flex flex-col items-end gap-1">{right}</div>}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-content gap-2 py-10 px-4 text-[12px]" style={{ color: "hsl(215 14% 40%)" }}>
      <svg width="20" height="20" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" opacity={0.4}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {message}
    </div>
  );
}

/* ---- Component ------------------------------------------------------------ */

export function NotMovingTabs({
  stuckLoans,
  untouchedLeads,
  notContactedStuck,
  pitchedWaiting,
  prePipeStalled,
  signedNoAppraisal,
}: NotMovingTabsProps) {
  const tabs = [
    { key: "stuck",      label: "Past SLA",        count: stuckLoans.length,       urgent: true  },
    { key: "untouched",  label: ">24h Untouched",  count: untouchedLeads.length,   urgent: true  },
    { key: "nocontact",  label: "Not Contacted",   count: notContactedStuck.length, urgent: false },
    { key: "pitched",    label: "Pitched Waiting", count: pitchedWaiting.length,   urgent: false },
    { key: "prepipe",    label: "Pre-Pipe Stalled",count: prePipeStalled.length,   urgent: false },
    { key: "noappraisal",label: "No Appraisal",    count: signedNoAppraisal.length, urgent: true  },
  ].filter((t) => t.count > 0);

  const [active, setActive] = useState(tabs[0]?.key ?? "stuck");

  const totalUrgent = stuckLoans.length + untouchedLeads.length + signedNoAppraisal.length;

  if (tabs.length === 0) {
    return (
      <EmptyState message="All clear — no stuck or untouched leads" />
    );
  }

  return (
    <div>
      {/* Tab bar */}
      <div className="flex overflow-x-auto" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActive(t.key)}
            className="flex shrink-0 items-center gap-2 px-4 py-2.5 text-[12.5px] font-medium transition-colors"
            style={{
              borderBottom: active === t.key ? "2px solid #E8FF00" : "2px solid transparent",
              marginBottom: "-1px",
              color: active === t.key ? "hsl(210 20% 96%)" : "hsl(215 14% 52%)",
              background: "none",
              cursor: "pointer",
            }}
          >
            {t.label}
            <span
              className="rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none"
              style={
                t.urgent
                  ? { background: "rgba(255,75,75,0.15)", color: "#FF4B4B" }
                  : { background: "rgba(245,158,11,0.12)", color: "#F59E0B" }
              }
            >
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {active === "stuck" && (
          stuckLoans.length === 0 ? <EmptyState message="No loans past their SLA threshold" /> :
          stuckLoans.map((l) => (
            <AlertRow
              key={l.id}
              dotColor={l.daysOver >= 5 ? "#FF4B4B" : "#F59E0B"}
              title={
                <>
                  {l.borrowerName}
                  <Pill color="muted">{l.stageLabel}</Pill>
                </>
              }
              sub={`${l.loName ?? "Unassigned"} · ${l.daysInStage}d in stage (SLA ${l.slaMax}d)${l.openConditions > 0 ? ` · ${l.openConditions} open conditions` : ""}`}
              right={
                <>
                  <Pill color={l.daysOver >= 5 ? "red" : "amber"}>{l.daysInStage}d (+{l.daysOver})</Pill>
                  {l.shapeUrl && <ShapeLink url={l.shapeUrl} id={null} />}
                </>
              }
            />
          ))
        )}

        {active === "untouched" && (
          untouchedLeads.length === 0 ? <EmptyState message="No untouched leads" /> :
          untouchedLeads.map((l) => (
            <AlertRow
              key={l.id}
              dotColor="#FF4B4B"
              title={l.borrowerName}
              sub={`${l.loName ?? "Unassigned"} · ${l.source ?? "—"} · Created ${l.createdAt ? format(new Date(l.createdAt), "MMM d, h:mm a") : "—"}`}
              right={
                <>
                  <Pill color="red">{l.statusRaw ?? "—"}</Pill>
                  <ShapeLink url={l.shapeUrl} id={null} />
                </>
              }
            />
          ))
        )}

        {active === "nocontact" && (
          notContactedStuck.length === 0 ? <EmptyState message="No 'Not Contacted' leads" /> :
          notContactedStuck.map((l) => (
            <AlertRow
              key={l.id}
              dotColor="#F59E0B"
              title={l.borrowerName}
              sub={`${l.loName ?? "Unassigned"} · Created ${l.createdAt ? format(new Date(l.createdAt), "MMM d") : "—"}`}
              right={
                <>
                  <Pill color="amber">{l.statusRaw ?? "—"}</Pill>
                  <ShapeLink url={l.shapeUrl} id={null} />
                </>
              }
            />
          ))
        )}

        {active === "pitched" && (
          pitchedWaiting.length === 0 ? <EmptyState message="No 'Pitched and Waiting' leads" /> :
          pitchedWaiting.map((l) => (
            <AlertRow
              key={l.id}
              dotColor="#F59E0B"
              title={l.borrowerName}
              sub={`${l.loName ?? "Unassigned"} · Created ${l.createdAt ? format(new Date(l.createdAt), "MMM d") : "—"}`}
              right={<ShapeLink url={l.shapeUrl} id={null} />}
            />
          ))
        )}

        {active === "prepipe" && (
          prePipeStalled.length === 0 ? <EmptyState message="No stalled Pre-Pipe leads" /> :
          prePipeStalled.map((l) => (
            <AlertRow
              key={l.id}
              dotColor="#F59E0B"
              title={l.borrowerName}
              sub={`${l.loName ?? "Unassigned"} · ${l.statusRaw ?? "—"} · ${l.daysStuck ?? "?"}d`}
              right={
                <>
                  <Pill color="amber">{l.daysStuck ?? "?"}d</Pill>
                  <ShapeLink url={l.shapeUrl} id={null} />
                </>
              }
            />
          ))
        )}

        {active === "noappraisal" && (
          signedNoAppraisal.length === 0 ? <EmptyState message="No signed loans missing appraisal payment" /> :
          signedNoAppraisal.map((l) => (
            <AlertRow
              key={l.id}
              dotColor="#FF4B4B"
              title={l.borrowerName}
              sub={`${l.loName ?? "Unassigned"} · ${l.statusRaw ?? "—"}`}
              right={<ShapeLink url={l.shapeUrl} id={null} />}
            />
          ))
        )}
      </div>
    </div>
  );
}
