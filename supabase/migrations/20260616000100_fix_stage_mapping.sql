-- =============================================================================
-- Fix stage_mapping gaps: ~20 active QuestRock statuses that currently map to NULL.
-- These cause current_stage=NULL on leads, which excludes them from v_lead_sla_status,
-- SLA counts, and manager sub-lists.
-- =============================================================================

insert into public.stage_mapping (source_status, normalized_stage, is_active_loan) values
  -- Lead stage — initial outreach / not yet started
  ('New Lead',                        'lead',        true),
  ('Not Contacted',                   'lead',        true),
  ('Attempting Contact',              'lead',        true),
  ('Contacted',                       'lead',        true),
  ('First Call Scheduled',            'lead',        true),
  ('Pitch Appointment Scheduled',     'lead',        true),
  ('Missed Appt - Rescheduling',      'lead',        true),
  ('No Response - Ghosted',           'lead',        false),

  -- Application stage — pitched / waiting for decision
  ('Pitched & Waiting',               'application', true),
  ('Pitched and Waiting',             'application', true),
  ('Pitched - Follow Up',             'application', true),
  ('Pitched - Prep Package Out',      'esign_out',   true),

  -- eSign out / package stage
  ('Package Out',                     'esign_out',   true),
  ('Package Back',                    'esign_out',   true),
  ('Contract Received',               'esign_out',   true),
  ('Pre-Qualified',                   'application', true),

  -- Processing stage — appraisal ordered/received
  ('Appraisal Ordered',               'processing',  true),
  ('Appraisal Received',              'processing',  true),

  -- Terminal / inactive
  ('New Lead - Reapplied',            'lead',        false),
  ('Bad Lead',                        null,          false),
  ('Long Term Nurture',               null,          false),
  ('Not Interested',                  null,          false),
  ('Denied - Credit Repair',          null,          false),
  ('Denied - No Benefit',             null,          false),
  ('Denied - No Equity',              null,          false),
  ('Denied - Income',                 null,          false),
  ('Denied - Other',                  null,          false),
  ('Closed',                          'funded',      true),
  ('Purchased',                       'funded',      true)
on conflict (source_status) do update
  set normalized_stage = excluded.normalized_stage,
      is_active_loan   = excluded.is_active_loan;
