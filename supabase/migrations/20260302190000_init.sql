-- LO Command Center schema (read-only reporting store)
-- Apply in Supabase SQL editor or via Supabase CLI migrations.

create extension if not exists "pgcrypto";

-- Enums
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('executive', 'manager', 'loan_officer', 'processor', 'closer', 'admin');
  end if;

  if not exists (select 1 from pg_type where typname = 'loan_pipeline_stage') then
    create type public.loan_pipeline_stage as enum (
      'registered',
      'processing',
      'submission',
      'underwriting',
      'conditions',
      'clear_to_close',
      'closing',
      'funded'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'condition_status') then
    create type public.condition_status as enum ('open', 'cleared');
  end if;
end $$;

-- Core org tables
create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null,
  role public.app_role not null,
  primary_team_id uuid null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  manager_user_id uuid null references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.users
  add constraint users_primary_team_fk
  foreign key (primary_team_id) references public.teams (id) on delete set null;

create table if not exists public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

-- Import traceability
create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  source text not null, -- e.g. 'shape_kpi_csv'
  source_filename text null,
  imported_by uuid null references public.users (id) on delete set null,
  imported_at timestamptz not null default now()
);

create table if not exists public.raw_shape_kpi_leads (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references public.import_batches (id) on delete cascade,
  record_id bigint not null,
  row jsonb not null,
  imported_at timestamptz not null default now()
);

-- Mapping + SLA configuration
create table if not exists public.stage_mapping (
  source_status text primary key,
  normalized_stage public.loan_pipeline_stage null,
  is_active_loan boolean not null default false
);

create table if not exists public.sla_thresholds (
  stage public.loan_pipeline_stage primary key,
  max_days int not null check (max_days >= 0)
);

-- Loan tables (reporting)
create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid null references public.import_batches (id) on delete set null,

  shape_record_id bigint unique,
  shape_lead_id bigint null,

  borrower_first_name text null,
  borrower_last_name text null,

  mailing_state text null,
  property_state text null,

  loan_amount_raw text null,
  loan_amount_cents bigint null,

  status_raw text null,
  current_stage public.loan_pipeline_stage null,

  source text null,
  utm_campaign text null,
  channel text null,

  application_completed_at timestamptz null,
  credit_report_requested_at timestamptz null,
  appraisal_requested_at timestamptz null,
  closed_at timestamptz null,
  closing_date date null,

  assigned_loan_officer_user_id uuid null references public.users (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists loans_assigned_lo_idx on public.loans (assigned_loan_officer_user_id);
create index if not exists loans_stage_idx on public.loans (current_stage);
create index if not exists loans_closing_date_idx on public.loans (closing_date);

create table if not exists public.loan_stage_events (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id) on delete cascade,
  stage public.loan_pipeline_stage not null,
  entered_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists loan_stage_events_loan_idx on public.loan_stage_events (loan_id, entered_at desc);
create index if not exists loan_stage_events_stage_idx on public.loan_stage_events (stage, entered_at desc);

create table if not exists public.conditions (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id) on delete cascade,
  title text not null,
  status public.condition_status not null default 'open',
  created_at timestamptz not null default now(),
  cleared_at timestamptz null
);

create index if not exists conditions_loan_idx on public.conditions (loan_id, status);

-- Updated-at triggers
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'users_set_updated_at') then
    create trigger users_set_updated_at before update on public.users
    for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'teams_set_updated_at') then
    create trigger teams_set_updated_at before update on public.teams
    for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'loans_set_updated_at') then
    create trigger loans_set_updated_at before update on public.loans
    for each row execute function public.set_updated_at();
  end if;
end $$;

-- -----------------------------
-- Row Level Security (read-only)
-- -----------------------------
alter table public.users enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.import_batches enable row level security;
alter table public.raw_shape_kpi_leads enable row level security;
alter table public.stage_mapping enable row level security;
alter table public.sla_thresholds enable row level security;
alter table public.loans enable row level security;
alter table public.loan_stage_events enable row level security;
alter table public.conditions enable row level security;

-- Helper predicates inlined in policies (avoid security definer functions).

-- users: allow user to see self; executives/admins see all; managers see their team members.
create policy users_select_self_or_admin
on public.users
for select
using (
  id = auth.uid()
  or exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role in ('executive', 'admin')
  )
  or exists (
    select 1
    from public.teams t
    join public.team_members tm on tm.team_id = t.id
    where t.manager_user_id = auth.uid()
      and tm.user_id = public.users.id
  )
);

-- teams/team_members: readable to executives/admins, managers (their team), and members (their teams)
create policy teams_select_scoped
on public.teams
for select
using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('executive', 'admin'))
  or manager_user_id = auth.uid()
  or exists (select 1 from public.team_members tm where tm.team_id = public.teams.id and tm.user_id = auth.uid())
);

create policy team_members_select_scoped
on public.team_members
for select
using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('executive', 'admin'))
  or exists (select 1 from public.teams t where t.id = public.team_members.team_id and t.manager_user_id = auth.uid())
  or user_id = auth.uid()
);

-- stage_mapping + sla_thresholds: readable to any authenticated user (safe config)
create policy stage_mapping_select_auth
on public.stage_mapping
for select
using (auth.uid() is not null);

create policy sla_thresholds_select_auth
on public.sla_thresholds
for select
using (auth.uid() is not null);

-- import tables: executives/admins only
create policy import_batches_select_admin
on public.import_batches
for select
using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('executive', 'admin')));

create policy raw_shape_kpi_leads_select_admin
on public.raw_shape_kpi_leads
for select
using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('executive', 'admin')));

-- loans: role-based visibility
create policy loans_select_scoped
on public.loans
for select
using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('executive', 'admin'))
  or (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'loan_officer')
    and assigned_loan_officer_user_id = auth.uid()
  )
  or (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'manager')
    and exists (
      select 1
      from public.teams t
      join public.team_members tm on tm.team_id = t.id
      where t.manager_user_id = auth.uid()
        and tm.user_id = public.loans.assigned_loan_officer_user_id
    )
  )
  or (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'processor')
    and current_stage in ('processing', 'submission', 'underwriting', 'conditions')
  )
  or (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'closer')
    and current_stage in ('clear_to_close', 'closing')
  )
);

-- events/conditions: same as loan visibility
create policy loan_stage_events_select_scoped
on public.loan_stage_events
for select
using (
  exists (
    select 1
    from public.loans l
    where l.id = public.loan_stage_events.loan_id
  )
);

create policy conditions_select_scoped
on public.conditions
for select
using (
  exists (
    select 1
    from public.loans l
    where l.id = public.conditions.loan_id
  )
);

