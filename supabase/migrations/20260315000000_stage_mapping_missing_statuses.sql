-- Add all Shape statuses that were returned as "unmapped" during sync.
-- Source: sync unmapped list + Loan System Integration Meeting transcript.
-- Active pipeline statuses get a normalized_stage; pre-loan / disposition statuses stay null.

insert into public.stage_mapping (source_status, normalized_stage, is_active_loan) values

  -- ── Active pipeline ──────────────────────────────────────────────────────
  -- Submitted to UW = waiting on underwriter review
  ('Submitted to UW',           'submission',         true),

  -- Underwriter approved with conditions outstanding
  ('Approved with Conditions',  'approval_conditions', true),

  -- Conditions sent back to underwriter/investor
  ('Conditions Submitted',      'conditions',         true),

  -- "Clear to Close" (different casing from existing "Clear To Close")
  ('Clear to Close',            'clear_to_close',     true),

  -- Borrower docs received variants
  ('Verification Docs Received',  'processing',       true),
  ('Verification Docs Requested', 'processing',       true),

  -- Resubmission to UW after incomplete review
  ('Incomplete (ReSubmission)', 'submission',         true),

  -- ── Pre-loan / early lead lifecycle ──────────────────────────────────────
  ('New Lead',                          null, false),
  ('New Lead - Reapplied',              null, false),
  ('First Call Appointment Scheduled',  null, false),
  ('Pitch Appointment Scheduled',       null, false),
  ('Pitched - Follow Up',               null, false),
  ('Pitched - Prep Package Out',        null, false),
  ('House Hunting (Seller)',            null, false),
  ('Contacted - Gathering Application', null, false),

  -- Pre-application portal funnel (Shape portal flow)
  ('Pre-Application Sent',              null, false),
  ('Pre-Application Started',           null, false),
  ('Pre-Application Completed',         null, false),

  -- ── Disposition / dead statuses ──────────────────────────────────────────
  ('Withdrawn',               null, false),
  ('Do Not Use',              null, false),
  ('Do Not Call List',        null, false),
  ('Bad Contact Info',        null, false),
  ('Denied',                  null, false),
  ('Denied - Down Payment',   null, false),
  ('Denied - Mortgage History', null, false)

on conflict (source_status) do update
  set normalized_stage = excluded.normalized_stage,
      is_active_loan   = excluded.is_active_loan;
