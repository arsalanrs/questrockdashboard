-- Allow LP webhook to upsert conditions without duplicates.

alter table public.conditions add column if not exists source text null default 'manual';
alter table public.conditions add column if not exists external_id text null;
alter table public.conditions add column if not exists category text null;
alter table public.conditions add column if not exists description text null;
alter table public.conditions add column if not exists due_date date null;
alter table public.conditions add column if not exists updated_at timestamptz not null default now();

-- Unique constraint so LP conditions can be upserted (loan_id + external source id)
create unique index if not exists conditions_loan_external_uidx
  on public.conditions (loan_id, external_id)
  where external_id is not null;
