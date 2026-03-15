-- Default pipeline configuration

insert into public.sla_thresholds (stage, max_days) values
  ('registered', 2),
  ('processing', 5),
  ('submission', 3),
  ('underwriting', 3),
  ('conditions', 5),
  ('clear_to_close', 2),
  ('closing', 5),
  ('funded', 0)
on conflict (stage) do update set max_days = excluded.max_days;

-- Shape/LendingPad/portal statuses seen in transcripts + CSV exports
-- (Anything not mapped will remain null and can be configured via admin UI later.)
insert into public.stage_mapping (source_status, normalized_stage, is_active_loan) values
  ('Registered', 'registered', true),
  ('Processing', 'processing', true),
  ('Submission', 'submission', true),
  ('Underwriting', 'underwriting', true),
  ('Approved', 'conditions', true),
  ('Conditions', 'conditions', true),
  ('Clear To Close', 'clear_to_close', true),
  ('Closing Scheduled', 'closing', true),
  ('Closed', 'funded', true),
  ('Funded', 'funded', true),
  ('Purchased', 'funded', true),

  ('Appraisal Received', 'processing', true),
  ('Appraisal Request Date', 'processing', true),
  ('Borrower Docs Received', 'processing', true),

  -- Pre-loan / lead lifecycle statuses (not part of active loan pipeline)
  ('New Lead - Uncontacted', null, false),
  ('Appointment Scheduled', null, false),
  ('Missed Appointment', null, false),
  ('Attempting Contact', null, false),
  ('Contacted - Follow Up Needed', null, false),
  ('Pitched & Waiting', null, false),
  ('Pitched - House Hunting', null, false),
  ('Pre-Qualified', null, false),
  ('Pre-Approved', null, false),
  ('No Response - Ghosted', null, false),
  ('Application Sent', null, false),
  ('Application Started', null, false),
  ('Application Completed', null, false),
  ('Long Term Nurture', null, false),
  ('Not Interested', null, false),
  ('Bad Lead', null, false),
  ('Denied - Income', null, false),
  ('Denied - Credit Repair', null, false),
  ('Denied - Other', null, false),
  ('Denied - No Equity', null, false),
  ('Denied - No Benefit', null, false),
  ('Do Not Call', null, false)
on conflict (source_status) do update
set normalized_stage = excluded.normalized_stage,
    is_active_loan = excluded.is_active_loan;

