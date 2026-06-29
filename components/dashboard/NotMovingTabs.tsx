"use client";

import { useState } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/cn";

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

/* ---- Atoms ---------------------------------------------------------------- */

function Pill({
  children,
  color,
}: {
  children: React.ReactNode;
  color: "red" | "amber" | "green" | "muted";
}) {
  const cls = {
    red: "pill-red",
    amber: "pill-amber",
    green: "pill-green",
    muted: "pill-muted",
  }[color];
  return (
    <span className={cn(cls, "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap")}>
      {children}
    </span>
  );
}

function ShapeLink({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="lo-link-chip shape"
    >
      Open ↗
    </a>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="lo-muted flex items-center justify-center gap-2 py-8 px-4 text-[12px]">
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" opacity={0.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {message}
    </div>
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
    <div className="alert-row">
      <div className="mt-[4px] h-2 w-2 shrink-0 rounded-full" style={{ background: dotColor }} />
      <div className="min-w-0 flex-1">
        <div className="alert-row-title">
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {title}
            </a>
          ) : title}
        </div>
        {sub && <div className="alert-row-sub">{sub}</div>}
      </div>
      {right && <div className="shrink-0 flex flex-col items-end gap-1">{right}</div>}
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
    { key: "stuck",       label: "Past SLA",         count: stuckLoans.length,        urgent: true  },
    { key: "untouched",   label: ">24h Untouched",    count: untouchedLeads.length,    urgent: true  },
    { key: "nocontact",   label: "Not Contacted",     count: notContactedStuck.length, urgent: false },
    { key: "pitched",     label: "Pitched Waiting",   count: pitchedWaiting.length,    urgent: false },
    { key: "prepipe",     label: "Pre-Pipe Stalled",  count: prePipeStalled.length,    urgent: false },
    { key: "noappraisal", label: "No Appraisal",      count: signedNoAppraisal.length, urgent: true  },
  ].filter((t) => t.count > 0);

  const [active, setActive] = useState(tabs[0]?.key ?? "stuck");

  if (tabs.length === 0) {
    return <EmptyState message="All clear — no stuck or untouched leads" />;
  }

  return (
    <div>
      {/* Tab bar */}
      <div className="flex overflow-x-auto" style={{ borderBottom: "1px solid var(--lo-border)" }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActive(t.key)}
            className="flex shrink-0 items-center gap-1.5 px-3 py-2 text-[11.5px] font-semibold transition-colors"
            style={{
              borderBottom: active === t.key ? "2px solid var(--lo-teal)" : "2px solid transparent",
              marginBottom: "-1px",
              color: active === t.key ? "var(--lo-text)" : "var(--lo-muted)",
              background: "none",
              cursor: "pointer",
            }}
          >
            {t.label}
            <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none", t.urgent ? "pill-red" : "pill-amber")}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* Scrollable content */}
      <div className="alert-list-scroll">
        {active === "stuck" && (
          stuckLoans.length === 0
            ? <EmptyState message="No loans past their SLA threshold" />
            : stuckLoans.map((l) => (
              <AlertRow
                key={l.id}
                dotColor={l.daysOver >= 5 ? "var(--color-red)" : "var(--color-amber)"}
                href={l.shapeUrl}
                title={
                  <>
                    {l.borrowerName}
                    <Pill color="muted">{l.stageLabel}</Pill>
                  </>
                }
                sub={`${l.loName ?? "Unassigned"} · ${l.daysInStage}d in stage (SLA ${l.slaMax}d)${l.openConditions > 0 ? ` · ${l.openConditions} open` : ""}`}
                right={
                  <>
                    <Pill color={l.daysOver >= 5 ? "red" : "amber"}>{l.daysInStage}d (+{l.daysOver})</Pill>
                    <ShapeLink url={l.shapeUrl} />
                  </>
                }
              />
            ))
        )}

        {active === "untouched" && (
          untouchedLeads.length === 0
            ? <EmptyState message="No untouched leads" />
            : untouchedLeads.map((l) => (
              <AlertRow
                key={l.id}
                dotColor="var(--color-red)"
                href={l.shapeUrl}
                title={l.borrowerName}
                sub={`${l.loName ?? "Unassigned"} · ${l.source ?? "—"} · Created ${l.createdAt ? format(new Date(l.createdAt), "MMM d, h:mm a") : "—"}`}
                right={
                  <>
                    <Pill color="red">{l.statusRaw ?? "—"}</Pill>
                    <ShapeLink url={l.shapeUrl} />
                  </>
                }
              />
            ))
        )}

        {active === "nocontact" && (
          notContactedStuck.length === 0
            ? <EmptyState message="No 'Not Contacted' leads" />
            : notContactedStuck.map((l) => (
              <AlertRow
                key={l.id}
                dotColor="var(--color-amber)"
                href={l.shapeUrl}
                title={l.borrowerName}
                sub={`${l.loName ?? "Unassigned"} · Created ${l.createdAt ? format(new Date(l.createdAt), "MMM d") : "—"}`}
                right={
                  <>
                    <Pill color="amber">{l.statusRaw ?? "—"}</Pill>
                    <ShapeLink url={l.shapeUrl} />
                  </>
                }
              />
            ))
        )}

        {active === "pitched" && (
          pitchedWaiting.length === 0
            ? <EmptyState message="No 'Pitched and Waiting' leads" />
            : pitchedWaiting.map((l) => (
              <AlertRow
                key={l.id}
                dotColor="var(--color-amber)"
                href={l.shapeUrl}
                title={l.borrowerName}
                sub={`${l.loName ?? "Unassigned"} · Created ${l.createdAt ? format(new Date(l.createdAt), "MMM d") : "—"}`}
                right={<ShapeLink url={l.shapeUrl} />}
              />
            ))
        )}

        {active === "prepipe" && (
          prePipeStalled.length === 0
            ? <EmptyState message="No stalled Pre-Pipe leads" />
            : prePipeStalled.map((l) => (
              <AlertRow
                key={l.id}
                dotColor="var(--color-amber)"
                href={l.shapeUrl}
                title={l.borrowerName}
                sub={`${l.loName ?? "Unassigned"} · ${l.statusRaw ?? "—"} · ${l.daysStuck ?? "?"}d`}
                right={
                  <>
                    <Pill color="amber">{l.daysStuck ?? "?"}d</Pill>
                    <ShapeLink url={l.shapeUrl} />
                  </>
                }
              />
            ))
        )}

        {active === "noappraisal" && (
          signedNoAppraisal.length === 0
            ? <EmptyState message="No signed loans missing appraisal payment" />
            : signedNoAppraisal.map((l) => (
              <AlertRow
                key={l.id}
                dotColor="var(--color-red)"
                href={l.shapeUrl}
                title={l.borrowerName}
                sub={`${l.loName ?? "Unassigned"} · ${l.statusRaw ?? "—"}`}
                right={<ShapeLink url={l.shapeUrl} />}
              />
            ))
        )}
      </div>
    </div>
  );
}
