-- =============================================================================
-- Fix v_lead_sla_status:
--   1. Rule 5 now accepts BOTH 'Pitched & Waiting' and 'Pitched and Waiting'
--   2. Extend Rule 1/4 to also match current_stage = 'esign_out' which maps the
--      "Package Out / Package Back / Contract Received" statuses so those leads
--      appear in the SLA view.
-- =============================================================================

drop view if exists public.v_lead_sla_status;

create view public.v_lead_sla_status as
select
  l.id                          as loan_id,
  l.shape_record_id,
  l.borrower_first_name,
  l.borrower_last_name,
  concat_ws(' ', l.borrower_first_name, l.borrower_last_name) as borrower_name,
  l.borrower_phone,
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
    when l.current_stage in ('lead', 'application', 'esign_out')
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
    when l.current_stage in ('lead', 'application', 'esign_out')
         and l.lead_created_at < now() - interval '8 hours'
         and l.lead_created_at >= now() - interval '24 hours'
         and not exists (
           select 1 from public.lead_touch_log ltl
           where ltl.loan_id = l.id
             and ltl.touch_date = current_date
         ) then 'yellow'

    -- RULE 5 (yellow): Pitched and/or Waiting > 24h without activity (both spellings)
    when l.status_raw in ('Pitched and Waiting', 'Pitched & Waiting')
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
    when l.current_stage in ('lead', 'application', 'esign_out')
         and l.lead_created_at < now() - interval '24 hours'
         and not exists (
           select 1 from public.lead_touch_log ltl
           where ltl.loan_id = l.id
             and ltl.touch_date >= (current_date - 1)
         ) then 'untouched_24h'

    when l.status_raw in ('Signed', 'Package Out', 'Signed Not Piped')
         and l.appraisal_payment_collected_at is null then 'appraisal_missing'

    when l.status_raw in ('Pitched and Waiting', 'Pitched & Waiting')
         and not exists (
           select 1 from public.shape_activity_log sal
           where sal.loan_id = l.id
             and sal.synced_at > now() - interval '24 hours'
         ) then 'pitched_waiting_stalled'

    when l.current_stage in ('lead', 'application', 'esign_out')
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
  -- exclude terminal pipeline stages (NULL current_stage = new/unmapped leads, keep them)
  (l.current_stage is null or l.current_stage not in ('funded', 'closing'))
  -- exclude terminal statuses by raw string (no enum cast needed)
  and (l.status_raw is null or l.status_raw not in (
    'Funded', 'Duplicate', 'Bad Lead', 'Do Not Contact',
    'Long Term Nurture', 'Pre-Qualified 4-9 Month', 'Pre-Qualified 9+ Month'
  ))
  ;

comment on view public.v_lead_sla_status is
  'Per-loan SLA color (green/yellow/red) and breach type. Includes borrower_phone. Uses both Pitched & Waiting spellings. Includes esign_out stage in early-lead rules.';

-- Re-grant after view recreation
grant select on public.v_lead_sla_status to service_role;
