-- Realtime publication for CRM tables + loan_notes dedup for cron upserts

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.rich_loan_data;
    alter publication supabase_realtime add table public.loan_notes;
  end if;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- Replace partial unique index with full index for upsert onConflict
drop index if exists public.loan_notes_loan_external_uidx;

create unique index if not exists loan_notes_loan_source_ext_uidx
  on public.loan_notes (loan_id, source, external_id);
