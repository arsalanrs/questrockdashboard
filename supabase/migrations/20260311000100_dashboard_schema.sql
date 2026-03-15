-- Migration 2 of 3: Schema changes — tables, columns, RLS, indexes.
-- Runs AFTER enum values from migration 1 have been committed.

-- 1. leads table ---------------------------------------------------------

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid null references public.import_batches (id) on delete set null,
  shape_record_id bigint unique,
  shape_lead_id bigint null,
  record_type text null,
  first_name text null,
  last_name text null,
  email text null,
  phone text null,
  source text null,
  channel text null,
  utm_campaign text null,
  status_raw text null,
  lead_stage public.lead_stage null,
  assigned_lo_user_id uuid null references public.users (id) on delete set null,
  assigned_lo_name text null,
  loan_id uuid null references public.loans (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leads_assigned_lo_idx on public.leads (assigned_lo_user_id);
create index if not exists leads_record_type_idx on public.leads (record_type);
create index if not exists leads_source_idx on public.leads (source);
create index if not exists leads_created_at_idx on public.leads (created_at desc);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'leads_set_updated_at') then
    create trigger leads_set_updated_at before update on public.leads
    for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.leads enable row level security;

drop policy if exists leads_select_scoped on public.leads;
create policy leads_select_scoped
on public.leads
for select
using (
  public.current_user_role() in ('executive', 'admin')
  or (
    public.current_user_role() = 'loan_officer'
    and (assigned_lo_user_id = auth.uid() or assigned_lo_user_id is null)
  )
  or (
    public.current_user_role() = 'manager'
    and (
      assigned_lo_user_id in (select public.current_user_managed_team_member_ids())
      or assigned_lo_user_id is null
    )
  )
  or public.current_user_role() in ('processor', 'closer')
);

-- 2. Expand loans table --------------------------------------------------

alter table public.loans add column if not exists loan_type text null;
alter table public.loans add column if not exists loan_purpose text null;
alter table public.loans add column if not exists documentation_type text null;
alter table public.loans add column if not exists income_type text null;
alter table public.loans add column if not exists track text null;
alter table public.loans add column if not exists is_brokered boolean not null default false;
alter table public.loans add column if not exists is_restructure_hold boolean not null default false;

alter table public.loans add column if not exists verification_started_at timestamptz null;
alter table public.loans add column if not exists verification_completed_at timestamptz null;
alter table public.loans add column if not exists esign_requested_at timestamptz null;
alter table public.loans add column if not exists esign_returned_at timestamptz null;
alter table public.loans add column if not exists submitted_to_processing_at timestamptz null;
alter table public.loans add column if not exists processing_completed_at timestamptz null;
alter table public.loans add column if not exists submitted_to_uw_at timestamptz null;
alter table public.loans add column if not exists uw_decision_at timestamptz null;
alter table public.loans add column if not exists conditions_received_at timestamptz null;
alter table public.loans add column if not exists conditions_submitted_at timestamptz null;
alter table public.loans add column if not exists pre_cd_sent_at timestamptz null;
alter table public.loans add column if not exists pre_cd_approved_at timestamptz null;
alter table public.loans add column if not exists ctc_at timestamptz null;
alter table public.loans add column if not exists appraisal_ordered_at timestamptz null;
alter table public.loans add column if not exists appraisal_received_at timestamptz null;
alter table public.loans add column if not exists title_ordered_at timestamptz null;
alter table public.loans add column if not exists insurance_ordered_at timestamptz null;
alter table public.loans add column if not exists lock_expiration_date date null;
alter table public.loans add column if not exists finance_contingency_date date null;
alter table public.loans add column if not exists appraisal_contingency_date date null;
alter table public.loans add column if not exists closing_scheduled_at timestamptz null;

alter table public.loans add column if not exists assigned_processor_user_id uuid null references public.users (id) on delete set null;
alter table public.loans add column if not exists current_owner_role text null;
alter table public.loans add column if not exists lead_id uuid null references public.leads (id) on delete set null;
alter table public.loans add column if not exists game_plan_notes text null;

create index if not exists loans_processor_idx on public.loans (assigned_processor_user_id);
create index if not exists loans_restructure_hold_idx on public.loans (is_restructure_hold) where is_restructure_hold = true;

-- Update loans RLS to include Questrock stages for processor/closer
drop policy if exists loans_select_scoped on public.loans;
create policy loans_select_scoped
on public.loans
for select
using (
  public.current_user_role() in ('executive', 'admin')
  or (
    public.current_user_role() = 'loan_officer'
    and (assigned_loan_officer_user_id = auth.uid() or assigned_loan_officer_user_id is null)
  )
  or (
    public.current_user_role() = 'manager'
    and (
      assigned_loan_officer_user_id in (select public.current_user_managed_team_member_ids())
      or assigned_loan_officer_user_id is null
    )
  )
  or (
    public.current_user_role() = 'processor'
    and current_stage::text in (
      'verification','esign_out','processing','submission',
      'underwriting','conditions','approval_conditions'
    )
  )
  or (
    public.current_user_role() = 'closer'
    and current_stage::text in ('clear_to_close', 'closing')
  )
);

-- 3. Modify sla_thresholds: add hours + owner + sub_steps ----------------

alter table public.sla_thresholds add column if not exists max_hours int null;
alter table public.sla_thresholds add column if not exists owner_role text null;
alter table public.sla_thresholds add column if not exists sub_steps jsonb null;

-- Backfill max_hours from existing max_days
update public.sla_thresholds set max_hours = max_days * 24 where max_hours is null;

-- Add lead_stage column to stage_mapping for leads table
alter table public.stage_mapping add column if not exists lead_stage public.lead_stage null;

-- 4. Add users.lo_preference_type ----------------------------------------

alter table public.users add column if not exists lo_preference_type text not null default 'b';

-- 5. Checklist tables ----------------------------------------------------

create table if not exists public.loan_type_checklists (
  id uuid primary key default gen_random_uuid(),
  loan_type text not null,
  loan_purpose text null,
  documentation_type text null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.loan_type_checklists (id) on delete cascade,
  title text not null,
  description text null,
  sort_order int not null default 0,
  is_required boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists checklist_items_checklist_idx on public.checklist_items (checklist_id, sort_order);

create table if not exists public.loan_checklist_entries (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id) on delete cascade,
  checklist_item_id uuid not null references public.checklist_items (id) on delete cascade,
  status public.checklist_entry_status not null default 'pending',
  received_at timestamptz null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (loan_id, checklist_item_id)
);

create index if not exists loan_checklist_entries_loan_idx on public.loan_checklist_entries (loan_id);

alter table public.loan_type_checklists enable row level security;
alter table public.checklist_items enable row level security;
alter table public.loan_checklist_entries enable row level security;

drop policy if exists checklists_select_auth on public.loan_type_checklists;
create policy checklists_select_auth on public.loan_type_checklists for select using (auth.uid() is not null);
drop policy if exists checklist_items_select_auth on public.checklist_items;
create policy checklist_items_select_auth on public.checklist_items for select using (auth.uid() is not null);
drop policy if exists loan_checklist_entries_select_scoped on public.loan_checklist_entries;
create policy loan_checklist_entries_select_scoped on public.loan_checklist_entries
for select using (
  exists (select 1 from public.loans l where l.id = public.loan_checklist_entries.loan_id)
);

-- 6. Notifications table -------------------------------------------------

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  loan_id uuid null references public.loans (id) on delete set null,
  type public.notification_type not null,
  title text not null,
  body text null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_unread_idx on public.notifications (user_id, is_read, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
for select using (user_id = auth.uid());

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
for update using (user_id = auth.uid());

-- 7. Ownership log -------------------------------------------------------

create table if not exists public.ownership_log (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id) on delete cascade,
  from_role text null,
  to_role text not null,
  from_user_id uuid null references public.users (id) on delete set null,
  to_user_id uuid null references public.users (id) on delete set null,
  transferred_at timestamptz not null default now(),
  notes text null
);

create index if not exists ownership_log_loan_idx on public.ownership_log (loan_id, transferred_at desc);

alter table public.ownership_log enable row level security;

drop policy if exists ownership_log_select_scoped on public.ownership_log;
create policy ownership_log_select_scoped on public.ownership_log
for select using (
  exists (select 1 from public.loans l where l.id = public.ownership_log.loan_id)
);

-- Updated-at triggers for new tables
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'loan_type_checklists_set_updated_at') then
    create trigger loan_type_checklists_set_updated_at before update on public.loan_type_checklists
    for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'loan_checklist_entries_set_updated_at') then
    create trigger loan_checklist_entries_set_updated_at before update on public.loan_checklist_entries
    for each row execute function public.set_updated_at();
  end if;
end $$;
