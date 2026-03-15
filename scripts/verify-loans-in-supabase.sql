-- Run this in Supabase SQL Editor to verify synced data and why dashboard might show limited numbers.
-- Copy-paste into Dashboard → SQL Editor → New query → Run.

-- 0) Re-apply stage backfill (run this if dashboard shows fewer active loans than upserted)
--    Updates current_stage from status_raw for all rows using stage_mapping.
-- update public.loans l set current_stage = m.normalized_stage
-- from public.stage_mapping m
-- where l.status_raw is not null and l.status_raw = m.source_status and m.normalized_stage is not null
--   and (l.current_stage is null or l.current_stage is distinct from m.normalized_stage);

-- 1) Total loans and how many have a pipeline stage
select
  count(*) as total_loans,
  count(current_stage) as with_current_stage,
  count(*) - count(current_stage) as without_stage
from public.loans;

-- 2) Count by normalized stage (these show in pipeline / active loans)
select current_stage, count(*) as cnt
from public.loans
where current_stage is not null
group by current_stage
order by cnt desc;

-- 3) Count by raw status (from Shape) – unmapped statuses won't have current_stage
select status_raw, count(*) as cnt
from public.loans
group by status_raw
order by cnt desc;

-- 4) Production scoreboard needs closed_at and loan_amount_cents
select
  count(closed_at) as with_closed_at,
  count(loan_amount_cents) as with_loan_amount
from public.loans;

-- 5) Sample of recent loans (stage and key fields)
select id, shape_record_id, borrower_first_name, borrower_last_name, status_raw, current_stage, closed_at, loan_amount_cents
from public.loans
order by lead_created_at desc nulls last
limit 20;
