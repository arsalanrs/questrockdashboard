-- Historical Insellerate export store: 4,738 rows from the old CRM prior to
-- Shape migration. Separate table (not public.leads) because the column shape,
-- data quality, and retention rules differ.
--
-- Exec/admin-only RLS — this feeds the AI chat + historical analytics.

create table if not exists public.historical_leads (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'insellerate',
  import_batch_id uuid null references public.import_batches (id) on delete set null,
  external_ref_id text null,
  insellerate_ref_id text null,

  first_name text null,
  last_name text null,
  email text null,
  phone text null,

  status_raw text null,
  campaign text null,
  loan_officer_name text null,

  loan_amount_cents bigint null,
  loan_type text null,
  loan_purpose text null,
  property_state text null,
  mailing_state text null,

  note_rate_bps int null,
  original_rate_bps int null,
  property_value_cents bigint null,
  current_loan_balance_cents bigint null,
  ltv_bps int null,
  credit_score_mid int null,
  dti_bps int null,
  is_veteran boolean null,

  created_at_source timestamptz null,
  last_activity_at_source timestamptz null,
  funded_at_source timestamptz null,

  notes text null,
  row jsonb not null default '{}'::jsonb,

  merged_into_loan_id uuid null references public.loans (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists historical_leads_email_idx
  on public.historical_leads (lower(email)) where email is not null;
create index if not exists historical_leads_status_idx on public.historical_leads (status_raw);
create index if not exists historical_leads_lo_idx on public.historical_leads (loan_officer_name);
create unique index if not exists historical_leads_external_ref_uidx
  on public.historical_leads (external_ref_id) where external_ref_id is not null;
create index if not exists historical_leads_merged_loan_idx
  on public.historical_leads (merged_into_loan_id) where merged_into_loan_id is not null;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'historical_leads_set_updated_at') then
    create trigger historical_leads_set_updated_at before update on public.historical_leads
    for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.historical_leads enable row level security;

drop policy if exists historical_leads_select_exec on public.historical_leads;
create policy historical_leads_select_exec
on public.historical_leads
for select
using (public.current_user_role() in ('executive', 'admin'));

comment on table public.historical_leads is
  'Insellerate historical export (pre-Shape CRM). Exec/admin only. Active rows merge into public.loans.';
