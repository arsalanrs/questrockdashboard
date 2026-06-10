-- Lead tier (RED / ORANGE / GREEN), EPO / re-engagement flags, and auto-assignment queue.
-- Supabase-only intelligence; no external scraper tables.

alter table public.loans
  add column if not exists lead_tier text
    check (lead_tier is null or lead_tier in ('RED', 'ORANGE', 'GREEN'));

alter table public.loans
  add column if not exists lead_tier_updated_at timestamptz null;

alter table public.loans
  add column if not exists epo_date date null;

alter table public.loans
  add column if not exists last_tier_eval_at timestamptz null;

alter table public.loans
  add column if not exists auto_assign_eligible boolean not null default false;

alter table public.loans
  add column if not exists lead_provider text null;

alter table public.loans
  add column if not exists initial_contact_attempted boolean not null default false;

alter table public.loans
  add column if not exists reengagement_8month_completed_at timestamptz null;

alter table public.loans
  add column if not exists epo_window_activated boolean not null default false;

create index if not exists loans_lead_tier_idx on public.loans (lead_tier) where lead_tier is not null;
create index if not exists loans_epo_date_idx on public.loans (epo_date) where epo_date is not null;

comment on column public.loans.lead_tier is 'RED=early funnel; ORANGE=in-flight LOS pipeline; GREEN=funded/closed book.';
comment on column public.loans.last_tier_eval_at is 'Last time batch tier classification ran for this row.';

-- ---------------------------------------------------------------------------
-- auto_assignment_queue: audit trail for bulk / auto assignments (exec tooling)
-- ---------------------------------------------------------------------------

create table if not exists public.auto_assignment_queue (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id) on delete cascade,
  tier text null,
  priority_score int null,
  assignment_method text null,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'cancelled', 'failed')),
  assigned_to uuid null references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  assigned_at timestamptz null,
  error_message text null,
  payload jsonb not null default '{}'::jsonb
);

create index if not exists auto_assignment_queue_loan_idx on public.auto_assignment_queue (loan_id);
create index if not exists auto_assignment_queue_status_idx on public.auto_assignment_queue (status, created_at desc);

alter table public.auto_assignment_queue enable row level security;

drop policy if exists auto_assignment_queue_select_exec on public.auto_assignment_queue;
create policy auto_assignment_queue_select_exec
on public.auto_assignment_queue
for select
using (public.current_user_role() in ('executive', 'admin'));

drop policy if exists auto_assignment_queue_insert_service on public.auto_assignment_queue;
create policy auto_assignment_queue_insert_service
on public.auto_assignment_queue
for insert
with check (auth.role() = 'service_role');

drop policy if exists auto_assignment_queue_update_service on public.auto_assignment_queue;
create policy auto_assignment_queue_update_service
on public.auto_assignment_queue
for update
using (auth.role() = 'service_role');

grant select on public.auto_assignment_queue to authenticated;
