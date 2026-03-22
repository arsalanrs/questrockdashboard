-- LendingPad read integration: link loans to LP UUIDs; store synced conditions with stable external ids.

alter table public.loans
  add column if not exists lendingpad_loan_uuid text null;

create index if not exists loans_lendingpad_loan_uuid_idx
  on public.loans (lendingpad_loan_uuid)
  where lendingpad_loan_uuid is not null;

alter table public.conditions
  add column if not exists source text null,
  add column if not exists lendingpad_condition_id text null;

comment on column public.loans.lendingpad_loan_uuid is 'LendingPad loan UUID for GET integrations/loans/*; from Shape custom field or backfill.';
comment on column public.conditions.source is 'Origin e.g. lendingpad for rows synced from LendingPad API.';
comment on column public.conditions.lendingpad_condition_id is 'Stable id from LendingPad condition payload for idempotent sync.';

create unique index if not exists conditions_loan_lendingpad_cond_uidx
  on public.conditions (loan_id, lendingpad_condition_id)
  where lendingpad_condition_id is not null;
