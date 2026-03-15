alter table public.loans
  add column if not exists assigned_loan_officer_name text null;

create index if not exists loans_assigned_lo_name_idx on public.loans (assigned_loan_officer_name);

