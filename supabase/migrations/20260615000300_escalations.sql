-- =============================================================================
-- Escalations table
-- =============================================================================
-- Managers and Executives can flag a lead with an internal note without
-- opening Shape CRM. LOs see escalations on their own loans via their
-- LO dashboard. Managers/Executives see all open escalations on Monitor.
-- =============================================================================

create table if not exists public.escalations (
  id               uuid        primary key default gen_random_uuid(),
  loan_id          uuid        not null,
  escalated_by     uuid        not null,
  note             text        not null,
  shape_record_id  bigint      null,
  lo_name          text        null,
  borrower_name    text        null,
  resolved_at      timestamptz null,
  resolved_by      uuid        null,
  created_at       timestamptz not null default now()
);

-- Add FK constraints only if the referenced tables already exist
-- (safe to re-run — drops before re-adding)
do $$
begin
  -- loan_id → loans
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'loans'
  ) then
    alter table public.escalations
      drop constraint if exists escalations_loan_id_fkey;
    alter table public.escalations
      add constraint escalations_loan_id_fkey
      foreign key (loan_id) references public.loans(id) on delete cascade;
  end if;

  -- escalated_by → users
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'users'
  ) then
    alter table public.escalations
      drop constraint if exists escalations_escalated_by_fkey;
    alter table public.escalations
      add constraint escalations_escalated_by_fkey
      foreign key (escalated_by) references public.users(id);

    alter table public.escalations
      drop constraint if exists escalations_resolved_by_fkey;
    alter table public.escalations
      add constraint escalations_resolved_by_fkey
      foreign key (resolved_by) references public.users(id);
  end if;
end $$;

create index if not exists escalations_loan_id_idx
  on public.escalations (loan_id, created_at desc);

create index if not exists escalations_unresolved_idx
  on public.escalations (resolved_at, created_at desc)
  where resolved_at is null;

alter table public.escalations enable row level security;

-- Managers, executives, admins can view all escalations
drop policy if exists escalations_manager_exec_select on public.escalations;
create policy escalations_manager_exec_select
  on public.escalations for select
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('manager', 'executive', 'admin')
    )
  );

-- LOs can see escalations on their own loans
drop policy if exists escalations_lo_select on public.escalations;
create policy escalations_lo_select
  on public.escalations for select
  using (
    exists (
      select 1 from public.loans l
      where l.id = escalations.loan_id
        and l.assigned_loan_officer_user_id = auth.uid()
    )
  );

-- Only managers, executives, admins can insert
drop policy if exists escalations_insert on public.escalations;
create policy escalations_insert
  on public.escalations for insert
  with check (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('manager', 'executive', 'admin')
    )
  );

-- Only managers, executives, admins can update (resolve)
drop policy if exists escalations_update on public.escalations;
create policy escalations_update
  on public.escalations for update
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('manager', 'executive', 'admin')
    )
  );

comment on table public.escalations is
  'Internal escalation notes logged by managers/executives for leads that need immediate LO attention.';
