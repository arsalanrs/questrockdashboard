-- Human-readable LP loan number from integrations/list/loans (separate from UUID).
alter table public.loans
  add column if not exists lendingpad_loan_number text null;

comment on column public.loans.lendingpad_loan_number is 'LendingPad loan number from list API; for display and matching.';
