-- Map Shape Application/Loan statuses to pipeline stages so synced records show as active on dashboard.
-- Without this, "Application Sent", "Application Started", "Application Completed" were mapped to null
-- and those loans did not appear in active count or pipeline.

insert into public.stage_mapping (source_status, normalized_stage, is_active_loan) values
  ('Application Sent', 'registered', true),
  ('Application Started', 'processing', true),
  ('Application Completed', 'submission', true),
  ('Borrower Docs Received', 'processing', true),
  ('Withdrawn', null, false),
  ('Denied - Down Payment', null, false),
  ('Pitched & Waiting', 'registered', true)
on conflict (source_status) do update
set normalized_stage = excluded.normalized_stage,
    is_active_loan = excluded.is_active_loan;
