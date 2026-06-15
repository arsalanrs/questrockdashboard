-- =============================================================================
-- Shape Activity Log + Lead Touch Log
-- =============================================================================
-- shape_activity_log: one row per detected field/status/note/owner change
--   written during each Shape incremental sync run.
--
-- lead_touch_log: one row per (loan_id, calendar_date), upserted in-place to
--   track daily touch count and last-touch timestamp for SLA enforcement.
-- =============================================================================

-- ── 1. shape_activity_log ────────────────────────────────────────────────────

create table if not exists public.shape_activity_log (
  id              uuid primary key default gen_random_uuid(),
  loan_id         uuid not null references public.loans (id) on delete cascade,
  shape_record_id bigint not null,
  synced_at       timestamptz not null default now(),

  -- what kind of change was detected on this sync cycle
  -- values: status_changed | field_changed | note_added | owner_changed | loan_created
  change_type     text not null,

  field_name      text null,   -- e.g. 'status_raw', 'notes_sidebar', 'assigned_lo'
  old_value       text null,
  new_value       text null,

  -- denormalized for fast report queries (avoids joins)
  lo_name         text null,
  borrower_name   text null
);

create index if not exists shape_activity_log_loan_id_idx
  on public.shape_activity_log (loan_id, synced_at desc);

create index if not exists shape_activity_log_synced_at_idx
  on public.shape_activity_log (synced_at desc);

create index if not exists shape_activity_log_change_type_idx
  on public.shape_activity_log (change_type, synced_at desc);

create index if not exists shape_activity_log_shape_record_id_idx
  on public.shape_activity_log (shape_record_id, synced_at desc);

alter table public.shape_activity_log enable row level security;

-- executives + admins see all rows
drop policy if exists shape_activity_log_select on public.shape_activity_log;
create policy shape_activity_log_select
  on public.shape_activity_log for select
  using (
    public.current_user_role() in ('executive', 'admin')
    or exists (
      select 1 from public.loans l
      where l.id = shape_activity_log.loan_id
        and (
          l.assigned_loan_officer_user_id = auth.uid()
          or public.current_user_role() in ('manager', 'processor', 'closer')
        )
    )
  );

-- service role (cron) may insert
drop policy if exists shape_activity_log_insert_service on public.shape_activity_log;
create policy shape_activity_log_insert_service
  on public.shape_activity_log for insert
  with check (true);

comment on table public.shape_activity_log is
  'Timestamped record of every field/status/note/owner change detected during Shape incremental sync runs.';

-- ── 2. lead_touch_log ────────────────────────────────────────────────────────
-- One row per (loan_id, touch_date). Upserted in-place each sync cycle.
-- "touched" means at least one shape_activity_log entry for that loan that day.

create table if not exists public.lead_touch_log (
  id              uuid primary key default gen_random_uuid(),
  loan_id         uuid not null references public.loans (id) on delete cascade,
  touch_date      date not null default current_date,
  touch_count     int not null default 1,
  last_touch_type text null,        -- latest change_type from activity log
  last_touch_at   timestamptz null,

  -- denormalized for fast SLA queries
  lo_name         text null,

  unique (loan_id, touch_date)
);

create index if not exists lead_touch_log_loan_id_idx
  on public.lead_touch_log (loan_id, touch_date desc);

create index if not exists lead_touch_log_touch_date_idx
  on public.lead_touch_log (touch_date desc);

alter table public.lead_touch_log enable row level security;

drop policy if exists lead_touch_log_select on public.lead_touch_log;
create policy lead_touch_log_select
  on public.lead_touch_log for select
  using (
    public.current_user_role() in ('executive', 'admin', 'manager', 'processor', 'closer')
    or exists (
      select 1 from public.loans l
      where l.id = lead_touch_log.loan_id
        and l.assigned_loan_officer_user_id = auth.uid()
    )
  );

drop policy if exists lead_touch_log_insert_service on public.lead_touch_log;
create policy lead_touch_log_insert_service
  on public.lead_touch_log for insert
  with check (true);

drop policy if exists lead_touch_log_update_service on public.lead_touch_log;
create policy lead_touch_log_update_service
  on public.lead_touch_log for update
  using (true);

comment on table public.lead_touch_log is
  'Daily touch summary per loan — updated each 15-min sync. Drives SLA enforcement.';

-- ── 3. Extra index on loan_stage_events (created in earlier migrations) ──────
create index if not exists loan_stage_events_loan_id_stage_idx
  on public.loan_stage_events (loan_id, stage, entered_at desc);
