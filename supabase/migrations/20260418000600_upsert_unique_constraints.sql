-- Fix: supabase-js .upsert({ onConflict: "<col>" }) requires a real UNIQUE
-- constraint (not a partial unique index). We previously shipped partial
-- indexes with `WHERE <col> IS NOT NULL`, which Postgres refuses to match as
-- an ON CONFLICT target ("42P10 — there is no unique or exclusion constraint
-- matching the ON CONFLICT specification").
--
-- NULL is distinct from NULL in Postgres unique constraints by default, so a
-- full unique constraint on a nullable column still allows multiple NULL rows.
-- Converting is safe for both tables.

do $$
begin
  -- historical_leads.external_ref_id
  if exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'historical_leads_external_ref_uidx'
  ) then
    drop index public.historical_leads_external_ref_uidx;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'historical_leads_external_ref_key'
  ) then
    alter table public.historical_leads
      add constraint historical_leads_external_ref_key unique (external_ref_id);
  end if;

  -- loans.insellerate_ref_id
  if exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'loans_insellerate_ref_uidx'
  ) then
    drop index public.loans_insellerate_ref_uidx;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'loans_insellerate_ref_key'
  ) then
    alter table public.loans
      add constraint loans_insellerate_ref_key unique (insellerate_ref_id);
  end if;
end $$;
