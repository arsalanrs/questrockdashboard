-- Singleton watermark for incremental Shape sync (updatedDateRange "to" date, UTC calendar day).
create table public.shape_sync_watermark (
  id smallint primary key default 1 constraint shape_sync_watermark_singleton check (id = 1),
  last_updated_sync_to date not null,
  updated_at timestamptz not null default now()
);

comment on table public.shape_sync_watermark is
  'Tracks last successful incremental Shape sync end date; service role only.';

alter table public.shape_sync_watermark enable row level security;

revoke all on public.shape_sync_watermark from anon, authenticated;
grant select, insert, update, delete on public.shape_sync_watermark to service_role;
