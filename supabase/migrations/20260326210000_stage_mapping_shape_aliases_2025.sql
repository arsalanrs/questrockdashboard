-- New Shape CRM status labels (2025) and Unicode dash variants — align with existing pipeline semantics.

insert into public.stage_mapping (source_status, normalized_stage, is_active_loan) values
  ('Not Contacted', null, false),
  ('Missed Appt – Rescheduling', null, false),
  ('No Response – Ghosted', null, false),
  ('Contacted', null, false),
  ('App Sent', 'application', false),
  ('App Started', 'application', false),
  ('App Completed', 'application', false),
  ('Pitched & Waiting', null, false),
  ('Pitched - Advance', 'esign_out', true),
  ('Package Signed Not Piped', 'esign_out', true),
  ('Piped', 'processing', true),
  ('Did Not Advance', null, false),
  ('Turndown', null, false),
  ('VISIT-Bounced', null, false),
  ('Bad Contact Info', null, false),
  ('Denied after Piped', null, false),
  ('New Lead – Reapplied', null, false)
on conflict (source_status) do update
set normalized_stage = excluded.normalized_stage,
    is_active_loan = excluded.is_active_loan;
