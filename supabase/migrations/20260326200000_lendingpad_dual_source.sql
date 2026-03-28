-- LendingPad LOS status separate from Shape CRM status_raw; per-LO API credentials (service role only).

alter table public.loans
  add column if not exists lendingpad_status_raw text null,
  add column if not exists lendingpad_status_at timestamptz null;

comment on column public.loans.lendingpad_status_raw is 'LendingPad loanStatus.name from list/export APIs.';
comment on column public.loans.lendingpad_status_at is 'LendingPad loanStatusDate when available.';

-- One row per app user; used only by server (service role). No RLS policies for authenticated.
create table if not exists public.lendingpad_user_credentials (
  user_id uuid primary key references public.users (id) on delete cascade,
  api_username text not null,
  api_password text not null,
  list_user_id text not null,
  updated_at timestamptz not null default now()
);

comment on table public.lendingpad_user_credentials is
  'Per-LO LendingPad Web API Basic auth + list/loans user UUID. Populate via SQL or admin tooling; never expose to client.';

alter table public.lendingpad_user_credentials enable row level security;

revoke all on public.lendingpad_user_credentials from anon, authenticated;
grant select, insert, update, delete on public.lendingpad_user_credentials to service_role;
