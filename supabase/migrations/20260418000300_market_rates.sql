-- Daily benchmark market rates used by refi detectors (rate_above_market,
-- cash_out_candidate). One row per (quote_date, loan_type, loan_purpose,
-- term_years). Exec/admin-only RLS.
--
-- Populated by an external feed / manual admin update; the signal engine
-- reads the latest row per (loan_type, loan_purpose, term_years).

create table if not exists public.market_rates (
  id uuid primary key default gen_random_uuid(),
  quote_date date not null,
  loan_type text not null,
  loan_purpose text null,
  term_years int not null default 30,
  rate_bps int not null,
  source text null,
  created_at timestamptz not null default now()
);

create unique index if not exists market_rates_unique_uidx
  on public.market_rates (quote_date, loan_type, coalesce(loan_purpose, ''), term_years);
create index if not exists market_rates_latest_idx
  on public.market_rates (loan_type, term_years, quote_date desc);

alter table public.market_rates enable row level security;

drop policy if exists market_rates_select_exec on public.market_rates;
create policy market_rates_select_exec
on public.market_rates
for select
using (public.current_user_role() in ('executive', 'admin'));

-- Convenience view: latest quote per (loan_type, term_years).
create or replace view public.market_rates_latest as
select distinct on (loan_type, term_years)
  loan_type,
  term_years,
  quote_date,
  rate_bps,
  loan_purpose,
  source
from public.market_rates
order by loan_type, term_years, quote_date desc;

comment on table public.market_rates is
  'Benchmark market rates (bps) used by Deal Detection refi detectors.';
