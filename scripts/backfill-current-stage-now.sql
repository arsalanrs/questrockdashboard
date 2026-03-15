-- Run in Supabase SQL Editor to set current_stage on all loans from status_raw.
-- Use this after a sync if the dashboard shows fewer active loans than loans upserted
-- (e.g. sync ran before stage_mapping had Application Sent / Application Completed, etc.).

update public.loans l
set current_stage = m.normalized_stage
from public.stage_mapping m
where l.status_raw is not null
  and l.status_raw = m.source_status
  and m.normalized_stage is not null
  and (l.current_stage is null or l.current_stage is distinct from m.normalized_stage);
