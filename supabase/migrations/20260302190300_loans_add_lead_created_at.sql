alter table public.loans
  add column if not exists lead_created_at timestamptz null;

create index if not exists loans_lead_created_at_idx on public.loans (lead_created_at desc);

