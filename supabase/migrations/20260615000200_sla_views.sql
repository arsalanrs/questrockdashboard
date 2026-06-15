-- =============================================================================
-- SLA Views + Helper Views for Dashboards
-- =============================================================================
-- v_lead_sla_status  : per-loan SLA color (green/yellow/red) + breach type.
-- v_daily_activity_summary : per-LO activity counts for today.
-- =============================================================================

-- ── 1. v_lead_sla_status ─────────────────────────────────────────────────────

create or replace view public.v_lead_sla_status as
select
  l.id                          as loan_id,
  l.shape_record_id,
  l.borrower_first_name,
  l.borrower_last_name,
  concat_ws(' ', l.borrower_first_name, l.borrower_last_name) as borrower_name,
  l.status_raw,
  l.current_stage,
  l.assigned_loan_officer_user_id,
  l.assigned_loan_officer_name  as lo_name,
  l.lead_created_at,
  l.source,
  l.appraisal_payment_collected_at,
  l.esign_returned_at,

  -- hours since lead was created (integer)
  round(extract(epoch from (now() - l.lead_created_at)) / 3600)::int
    as hours_since_created,

  -- hours since the most recent activity log entry (falls back to lead_created_at)
  round(extract(epoch from (now() - coalesce(
    (select max(sal.synced_at)
     from public.shape_activity_log sal
     where sal.loan_id = l.id),
    l.lead_created_at
  ))) / 3600)::int
    as hours_since_last_activity,

  -- was this loan touched (any activity) today?
  exists (
    select 1 from public.lead_touch_log ltl
    where ltl.loan_id = l.id
      and ltl.touch_date = current_date
  ) as touched_today,

  -- ── SLA color (5 rules, most severe wins) ──────────────────────────────
  case
    -- RULE 1 (red): new lead untouched > 24h
    when l.current_stage in ('lead', 'application')
         and l.lead_created_at < now() - interval '24 hours'
         and not exists (
           select 1 from public.lead_touch_log ltl
           where ltl.loan_id = l.id
             and ltl.touch_date >= (current_date - 1)
         ) then 'red'

    -- RULE 2 (red): Signed/Package Out with no appraisal payment
    when l.status_raw in ('Signed', 'Package Out', 'Signed Not Piped')
         and l.appraisal_payment_collected_at is null then 'red'

    -- RULE 3 (red): active pipeline, no activity in 48h
    when l.current_stage in ('verification', 'esign_out', 'registered', 'processing',
                              'submission', 'underwriting', 'conditions', 'approval_conditions')
         and not exists (
           select 1 from public.shape_activity_log sal
           where sal.loan_id = l.id
             and sal.synced_at > now() - interval '48 hours'
         ) then 'red'

    -- RULE 4 (yellow): new lead 8–24h without a touch today
    when l.current_stage in ('lead', 'application')
         and l.lead_created_at < now() - interval '8 hours'
         and l.lead_created_at >= now() - interval '24 hours'
         and not exists (
           select 1 from public.lead_touch_log ltl
           where ltl.loan_id = l.id
             and ltl.touch_date = current_date
         ) then 'yellow'

    -- RULE 5 (yellow): Pitched and Waiting > 24h without activity
    when l.status_raw = 'Pitched and Waiting'
         and not exists (
           select 1 from public.shape_activity_log sal
           where sal.loan_id = l.id
             and sal.synced_at > now() - interval '24 hours'
         ) then 'yellow'

    -- RULE 5b (yellow): mid-pipeline, no activity 24–48h
    when l.current_stage in ('verification', 'esign_out', 'registered', 'processing')
         and not exists (
           select 1 from public.shape_activity_log sal
           where sal.loan_id = l.id
             and sal.synced_at > now() - interval '24 hours'
         ) then 'yellow'

    else 'green'
  end as sla_color,

  -- ── Breach type label for UI ─────────────────────────────────────────────
  case
    when l.current_stage in ('lead', 'application')
         and l.lead_created_at < now() - interval '24 hours'
         and not exists (
           select 1 from public.lead_touch_log ltl
           where ltl.loan_id = l.id
             and ltl.touch_date >= (current_date - 1)
         ) then 'untouched_24h'

    when l.status_raw in ('Signed', 'Package Out', 'Signed Not Piped')
         and l.appraisal_payment_collected_at is null then 'appraisal_missing'

    when l.status_raw = 'Pitched and Waiting'
         and not exists (
           select 1 from public.shape_activity_log sal
           where sal.loan_id = l.id
             and sal.synced_at > now() - interval '24 hours'
         ) then 'pitched_waiting_stalled'

    when l.current_stage in ('lead', 'application')
         and l.lead_created_at < now() - interval '8 hours'
         and not exists (
           select 1 from public.lead_touch_log ltl
           where ltl.loan_id = l.id and ltl.touch_date = current_date
         ) then 'not_touched_today'

    when l.current_stage in ('verification', 'esign_out', 'registered', 'processing',
                              'submission', 'underwriting', 'conditions', 'approval_conditions')
         and not exists (
           select 1 from public.shape_activity_log sal
           where sal.loan_id = l.id
             and sal.synced_at > now() - interval '48 hours'
         ) then 'pipeline_stalled_48h'

    else null
  end as sla_breach_type

from public.loans l
where
  -- only active loans (exclude terminal stages and statuses)
  l.current_stage not in ('funded', 'closing')
  and coalesce(l.status_raw, '') not in (
    'Funded', 'Duplicate', 'Bad Lead', 'Do Not Contact',
    'Long Term Nurture', 'Pre-Qualified 4-9 Month', 'Pre-Qualified 9+ Month'
  )
  and l.current_stage is not null;

comment on view public.v_lead_sla_status is
  'Per-loan SLA color (green/yellow/red) and breach type. Used by LO, Manager, and Executive pages.';

-- ── 2. v_daily_activity_summary ──────────────────────────────────────────────

create or replace view public.v_daily_activity_summary as
select
  sal.lo_name,
  count(distinct sal.loan_id)                                         as loans_touched_today,
  count(*) filter (where sal.change_type = 'status_changed')          as status_changes_today,
  count(*) filter (where sal.change_type = 'note_added')              as notes_today,
  count(*) filter (where sal.change_type = 'owner_changed')           as assignments_today,
  count(*) filter (where sal.change_type = 'loan_created')            as new_leads_today,
  min(sal.synced_at)                                                   as first_activity_at,
  max(sal.synced_at)                                                   as last_activity_at
from public.shape_activity_log sal
where sal.synced_at >= current_date
group by sal.lo_name;

comment on view public.v_daily_activity_summary is
  'Per-LO activity counts for today. Used by executive event stream and manager dashboards.';

-- ── 3. Grants ─────────────────────────────────────────────────────────────────
grant select on public.v_lead_sla_status to service_role;
grant select on public.v_daily_activity_summary to service_role;
