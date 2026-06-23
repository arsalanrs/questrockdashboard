-- Stage mapping for Nikk Shape view statuses not yet mapped.

insert into public.stage_mapping (source_status, normalized_stage, is_active_loan) values
  ('Advanced',                        'application', true),
  ('Pitched - Advance to eSign',      'esign_out',   true),
  ('Pre-Piped',                       'registered',  true),
  ('Verification',                    'verification', true),
  ('Portal Registration Complete',    'application', true),
  ('Launch File Help Requested',      'processing',  true),
  ('Help Requested',                  'processing',  true),
  ('Waiting on Appraisal',            'processing',  true),
  ('Rate Lock',                       'processing',  true),
  ('Rate Locked',                     'processing',  true),
  ('Did Not Advance',                 null,          false),
  ('DNA',                             null,          false),
  ('Second Voice',                    'lead',        true),
  ('Pitch Help',                      'application', true),
  ('Inbound Shape Call',              'lead',        false),
  ('Test Lead',                       null,          false)
on conflict (source_status) do update
  set normalized_stage = excluded.normalized_stage,
      is_active_loan   = excluded.is_active_loan;
