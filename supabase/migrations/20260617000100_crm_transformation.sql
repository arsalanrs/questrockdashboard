-- CRM transformation: rich LP data, unified notes, reminder dismissals, loan contact fields

alter table public.loans
  add column if not exists borrower_email text null,
  add column if not exists lock_expiration_at timestamptz null,
  add column if not exists estimated_closing_at timestamptz null;

create table if not exists public.rich_loan_data (
  loan_id uuid primary key references public.loans (id) on delete cascade,
  front_dti double precision null,
  back_dti double precision null,
  ltv_ratio_percent double precision null,
  combined_ltv_ratio_percent double precision null,
  note_rate double precision null,
  apr double precision null,
  rate_locked_at timestamptz null,
  lock_expiration_at timestamptz null,
  estimated_closing_at timestamptz null,
  appraisal_contingency_at timestamptz null,
  financing_contingency_at timestamptz null,
  borrower_mobile_phone text null,
  borrower_email text null,
  borrower_address_json jsonb null,
  coborrower_first_name text null,
  coborrower_last_name text null,
  coborrower_phone text null,
  total_liquid_assets_cents bigint null,
  lp_notes_json jsonb null,
  processing_checklist_json jsonb null,
  service_providers_json jsonb null,
  lp_raw_json jsonb null,
  synced_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rich_loan_data_lock_exp_idx
  on public.rich_loan_data (lock_expiration_at)
  where lock_expiration_at is not null;

create table if not exists public.loan_notes (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id) on delete cascade,
  source text not null check (source in ('lendingpad', 'shape', 'zoom', 'manual')),
  author text null,
  body text not null,
  noted_at timestamptz not null,
  external_id text null,
  created_at timestamptz not null default now()
);

create unique index if not exists loan_notes_loan_external_uidx
  on public.loan_notes (loan_id, source, external_id)
  where external_id is not null;

create index if not exists loan_notes_loan_noted_idx
  on public.loan_notes (loan_id, noted_at desc);

create table if not exists public.reminder_dismissals (
  user_id uuid not null references public.users (id) on delete cascade,
  loan_id uuid not null references public.loans (id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (user_id, loan_id)
);

alter table public.conditions
  add column if not exists category text null;

alter table public.rich_loan_data enable row level security;
alter table public.loan_notes enable row level security;
alter table public.reminder_dismissals enable row level security;

-- rich_loan_data: same visibility as loans
create policy rich_loan_data_select_scoped
on public.rich_loan_data
for select
using (
  exists (
    select 1 from public.loans l
  where l.id = rich_loan_data.loan_id
    and (
      exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('executive', 'admin'))
      or l.assigned_loan_officer_user_id = auth.uid()
      or (
        exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'manager')
        and exists (
          select 1 from public.teams t
          join public.team_members tm on tm.team_id = t.id
          where t.manager_user_id = auth.uid() and tm.user_id = l.assigned_loan_officer_user_id
        )
      )
    )
  )
);

create policy loan_notes_select_scoped
on public.loan_notes
for select
using (
  exists (
    select 1 from public.loans l
    where l.id = loan_notes.loan_id
      and (
        exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('executive', 'admin'))
        or l.assigned_loan_officer_user_id = auth.uid()
        or (
          exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'manager')
          and exists (
            select 1 from public.teams t
            join public.team_members tm on tm.team_id = t.id
            where t.manager_user_id = auth.uid() and tm.user_id = l.assigned_loan_officer_user_id
          )
        )
      )
  )
);

create policy reminder_dismissals_select_own
on public.reminder_dismissals
for select
using (user_id = auth.uid());

create policy reminder_dismissals_insert_own
on public.reminder_dismissals
for insert
with check (user_id = auth.uid());

create policy reminder_dismissals_delete_own
on public.reminder_dismissals
for delete
using (user_id = auth.uid());

grant select on public.rich_loan_data to authenticated;
grant select on public.loan_notes to authenticated;
grant select, insert, delete on public.reminder_dismissals to authenticated;
