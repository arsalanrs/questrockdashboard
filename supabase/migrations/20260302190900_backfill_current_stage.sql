-- Backfill current_stage on existing loans from status_raw using stage_mapping.
-- Run after 20260302190800_shape_application_stages.sql so new status mappings exist.
-- Then dashboard active/pipeline counts will reflect synced data without re-sync.

update public.loans l
set current_stage = m.normalized_stage
from public.stage_mapping m
where l.status_raw is not null
  and l.status_raw = m.source_status
  and m.normalized_stage is not null
  and (l.current_stage is null or l.current_stage is distinct from m.normalized_stage);
