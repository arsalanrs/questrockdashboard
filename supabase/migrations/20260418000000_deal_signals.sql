-- Deal Detection signals persisted so they can be read by UI without re-running
-- the engine on every page load. Exec-only by RLS — LOs / managers / processors
-- / closers cannot see this table.

create table if not exists public.deal_signals (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id) on delete cascade,
  signal_type text not null,
  category text not null,
  priority smallint not null check (priority between 1 and 5),
  reason text not null,
  lo_user_id uuid null references public.users (id) on delete set null,
  lo_name text null,
  meta jsonb not null default '{}'::jsonb,
  playbook_json jsonb null,
  computed_at timestamptz not null default now(),
  dismissed_at timestamptz null,
  dismissed_by uuid null references public.users (id) on delete set null,
  dedupe_key text not null,
  updated_at timestamptz not null default now()
);

create unique index if not exists deal_signals_dedupe_uidx
  on public.deal_signals (dedupe_key);

create index if not exists deal_signals_loan_idx on public.deal_signals (loan_id);
create index if not exists deal_signals_lo_idx on public.deal_signals (lo_user_id);
create index if not exists deal_signals_type_idx on public.deal_signals (signal_type, priority desc);
create index if not exists deal_signals_active_idx
  on public.deal_signals (priority desc, computed_at desc)
  where dismissed_at is null;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'deal_signals_set_updated_at') then
    create trigger deal_signals_set_updated_at before update on public.deal_signals
    for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.deal_signals enable row level security;

drop policy if exists deal_signals_select_exec on public.deal_signals;
create policy deal_signals_select_exec
on public.deal_signals
for select
using (public.current_user_role() in ('executive', 'admin'));

drop policy if exists deal_signals_update_exec on public.deal_signals;
create policy deal_signals_update_exec
on public.deal_signals
for update
using (public.current_user_role() in ('executive', 'admin'));

comment on table public.deal_signals is
  'Deal-detection signals computed by lib/signals/*. Exec/admin only. Dedupe by (dedupe_key).';

-- Helpful summary view for the exec panel's "Per-LO deal scoring" card.
create or replace view public.loan_signal_counts_by_lo as
select
  lo_user_id,
  lo_name,
  count(*) filter (where dismissed_at is null) as active_count,
  count(*) filter (where dismissed_at is null and priority >= 4) as hot_count,
  count(*) filter (where dismissed_at is null and signal_type = 'piped_never_closed') as piped_never_closed,
  count(*) filter (where dismissed_at is null and signal_type = 'ctc_stall') as ctc_stall,
  count(*) filter (where dismissed_at is null and signal_type = 'approved_never_funded') as approved_never_funded,
  count(*) filter (where dismissed_at is null and signal_type = 'app_no_movement') as app_no_movement
from public.deal_signals
group by lo_user_id, lo_name;

comment on view public.loan_signal_counts_by_lo is
  'Per-LO rollup of active deal signals for the Executive Opportunities panel.';

-- Observability: track when the signal engine last ran.
create table if not exists public.signal_engine_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  loans_scanned int not null default 0,
  signals_written int not null default 0,
  signals_dismissed int not null default 0,
  notes text null
);

alter table public.signal_engine_runs enable row level security;
drop policy if exists signal_engine_runs_select_exec on public.signal_engine_runs;
create policy signal_engine_runs_select_exec
on public.signal_engine_runs
for select
using (public.current_user_role() in ('executive', 'admin'));
