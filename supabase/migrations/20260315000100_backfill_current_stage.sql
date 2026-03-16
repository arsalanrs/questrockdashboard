-- Backfill current_stage on all existing loans based on updated stage_mapping.
-- Run this after applying 20260315000000_stage_mapping_missing_statuses.sql

update public.loans l
set current_stage = sm.normalized_stage
from public.stage_mapping sm
where l.status_raw = sm.source_status
  and l.current_stage is distinct from sm.normalized_stage;

-- Also null out current_stage for any loan whose status_raw has no mapping
update public.loans l
set current_stage = null
where l.status_raw is not null
  and not exists (
    select 1 from public.stage_mapping sm where sm.source_status = l.status_raw
  )
  and l.current_stage is not null;
