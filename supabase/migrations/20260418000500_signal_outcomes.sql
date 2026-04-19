-- Phase 5 groundwork: capture the outcome of every detected signal so we can
-- eventually train a ranking model ("which signals actually convert?").
--
-- The outcome kinds are intentionally coarse so labeling is unambiguous:
--   closed_within_window  — signal fired AND loan reached 'funded' within window
--   dismissed_by_exec     — an exec hit dismiss on the signal in the UI
--   stale_no_movement     — signal still open after the observation window ended
--   loan_withdrawn_denied — the underlying loan went to withdrawn/denied
--   resolved_other        — signal no longer fires (self-healed), but no conversion
--
-- Populated by a cron job scanning deal_signals + loan state. Read-only for
-- execs; future ML pipeline pulls from here.

create table if not exists public.signal_outcomes (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid not null references public.deal_signals (id) on delete cascade,
  loan_id uuid not null references public.loans (id) on delete cascade,
  signal_type text not null,
  priority smallint not null,
  outcome_kind text not null,
  outcome_at timestamptz not null default now(),
  days_from_signal int null,
  loan_stage_at_outcome text null,
  meta jsonb not null default '{}'::jsonb
);

create unique index if not exists signal_outcomes_signal_uidx on public.signal_outcomes (signal_id);
create index if not exists signal_outcomes_type_idx on public.signal_outcomes (signal_type, outcome_kind);
create index if not exists signal_outcomes_loan_idx on public.signal_outcomes (loan_id);
create index if not exists signal_outcomes_outcome_at_idx on public.signal_outcomes (outcome_at desc);

alter table public.signal_outcomes enable row level security;

drop policy if exists signal_outcomes_select_exec on public.signal_outcomes;
create policy signal_outcomes_select_exec
on public.signal_outcomes
for select
using (public.current_user_role() in ('executive', 'admin'));

comment on table public.signal_outcomes is
  'Outcome labels for detected deal_signals. Training data for the future Phase 5 ML ranking model.';

-- Summary view — conversion rate by signal_type.
create or replace view public.signal_conversion_by_type as
select
  signal_type,
  count(*) as total_outcomes,
  count(*) filter (where outcome_kind = 'closed_within_window') as closed_count,
  count(*) filter (where outcome_kind = 'dismissed_by_exec') as dismissed_count,
  count(*) filter (where outcome_kind = 'stale_no_movement') as stale_count,
  round(
    100.0 * count(*) filter (where outcome_kind = 'closed_within_window') / nullif(count(*), 0),
    1
  ) as close_rate_pct
from public.signal_outcomes
group by signal_type
order by total_outcomes desc;

comment on view public.signal_conversion_by_type is
  'Close-rate-by-signal-type rollup for Phase 5 ML weighting.';
