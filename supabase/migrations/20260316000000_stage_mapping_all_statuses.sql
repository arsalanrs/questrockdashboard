-- Add all Shape statuses referenced in client feedback that aren't already mapped.

insert into public.stage_mapping (source_status, normalized_stage, is_active_loan) values
  ('Attempting Contact',        null, false),
  ('Missed Appt - Rescheduling', null, false),
  ('No Response - Ghosted',     null, false),
  ('Contract Received',         null, true),
  ('Package Out',               null, true),
  ('Package Back',              null, true),
  ('Pre-Qualified',             null, true),
  ('Bad Lead',                  null, false),
  ('Long Term Nurture',         null, false),
  ('Not Interested',            null, false),
  ('Denied - Credit Repair',    null, false),
  ('Denied - No Benefit',       null, false),
  ('Denied - No Equity',        null, false),
  ('Denied - Income',           null, false),
  ('Denied - Other',            null, false),
  ('Appraisal Ordered',         null, true),
  ('Appraisal Received',        null, true),
  ('Closed',                    null, true),
  ('Purchased',                 null, true),
  ('New Lead - Reapplied',      null, false)
on conflict (source_status) do nothing;
