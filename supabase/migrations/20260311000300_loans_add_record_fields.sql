-- Add record_type, borrower_email, borrower_phone to loans table
-- so all synced records (not just Applications/Loans) carry full context.

alter table public.loans add column if not exists record_type text null;
alter table public.loans add column if not exists borrower_email text null;
alter table public.loans add column if not exists borrower_phone text null;

create index if not exists loans_record_type_idx on public.loans (record_type);
