-- LP list API milestone snapshot + detail dates on rich_loan_data (confirmed via probe scripts).

alter table public.rich_loan_data
  add column if not exists milestone_history jsonb null,
  add column if not exists first_payment_date date null,
  add column if not exists note_date date null;

create index if not exists rich_loan_data_milestone_history_gin_idx
  on public.rich_loan_data using gin (milestone_history)
  where milestone_history is not null;
