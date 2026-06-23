-- Shape pipeline view columns: portal/POS status, conversion date, last status change.

alter table public.loans
  add column if not exists portal_status_raw text,
  add column if not exists conversion_date timestamptz,
  add column if not exists last_status_change_at timestamptz;

comment on column public.loans.portal_status_raw is
  'Shape POS / portal status (may differ from status_raw on Applications).';
comment on column public.loans.conversion_date is
  'Shape conversion / app-completed milestone when distinct from application_completed_at.';
comment on column public.loans.last_status_change_at is
  'Last Shape status change; falls back to shape_last_updated_at in view queries.';

create index if not exists loans_portal_status_raw_idx on public.loans (portal_status_raw)
  where portal_status_raw is not null;
create index if not exists loans_last_status_change_at_idx on public.loans (last_status_change_at desc nulls last);
create index if not exists loans_conversion_date_idx on public.loans (conversion_date desc nulls last);
