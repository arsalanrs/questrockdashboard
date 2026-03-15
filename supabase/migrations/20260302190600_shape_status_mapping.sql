-- Additional Shape API statuses from live export (data/shape-export-sample.json)
-- Maps status strings to normalized pipeline stage for current_stage and dashboard.

insert into public.stage_mapping (source_status, normalized_stage, is_active_loan) values
  ('Initial Submission (UW)', 'submission', true),
  ('VISIT', null, false)
on conflict (source_status) do update
set normalized_stage = excluded.normalized_stage,
    is_active_loan = excluded.is_active_loan;
