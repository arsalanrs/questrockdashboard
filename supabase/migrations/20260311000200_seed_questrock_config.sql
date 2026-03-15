-- Migration 3 of 3: Seed data — Questrock SLA thresholds, stage mapping
-- updates, and loan-type document checklists.
-- Runs AFTER migration 2 has committed (max_hours column exists).

-- 1. SLA thresholds for new Questrock stages ----------------------------

insert into public.sla_thresholds (stage, max_days, max_hours, owner_role, sub_steps) values
  ('lead', 0, 0, 'lo', null),
  ('application', 0, 0, 'lo', null),
  ('verification', 2, 48, 'verification_team', null),
  ('esign_out', 1, 24, 'loan_services',
    '[{"role":"loan_services","max_hours":3,"label":"In-house eSign"},{"role":"broker","max_hours":24,"label":"Brokered eSign"}]'::jsonb),
  ('approval_conditions', 3, 72, 'lo',
    '[{"role":"lo","max_hours":48,"label":"LO submits conditions"},{"role":"processor","max_hours":24,"label":"Processor sends conditions"}]'::jsonb)
on conflict (stage) do update
set max_days = excluded.max_days,
    max_hours = excluded.max_hours,
    owner_role = excluded.owner_role,
    sub_steps = excluded.sub_steps;

-- Update existing stages with Questrock hours
update public.sla_thresholds set max_hours = 72, owner_role = 'lo',
  sub_steps = '[{"role":"lo","max_hours":48,"label":"Submit to Processing"},{"role":"processor","max_hours":24,"label":"Process and move to UW"}]'::jsonb
where stage = 'processing';

update public.sla_thresholds set max_hours = 72, owner_role = 'lo',
  sub_steps = '[{"role":"lo","max_hours":48,"label":"Submit to Processing"},{"role":"processor","max_hours":24,"label":"Review before submission"}]'::jsonb
where stage = 'submission';

update public.sla_thresholds set max_hours = 72, owner_role = 'underwriter', sub_steps = null
where stage = 'underwriting';

update public.sla_thresholds set max_hours = 72, owner_role = 'lo',
  sub_steps = '[{"role":"lo","max_hours":48,"label":"Get conditions to processor"},{"role":"processor","max_hours":24,"label":"Send conditions in"}]'::jsonb
where stage = 'conditions';

update public.sla_thresholds set max_hours = 5, owner_role = 'loan_services',
  sub_steps = '[{"role":"loan_services","max_hours":4,"label":"Send pre-CD"},{"role":"lo","max_hours":1,"label":"LO approves pre-CD"}]'::jsonb
where stage = 'clear_to_close';

update public.sla_thresholds set max_hours = 24, owner_role = 'lo',
  sub_steps = '[{"role":"lo","max_hours":0,"label":"Schedule closing"},{"role":"loan_services","max_hours":24,"label":"Balancing and closing docs"}]'::jsonb
where stage = 'closing';

update public.sla_thresholds set max_hours = 0, owner_role = null, sub_steps = null
where stage = 'funded';

update public.sla_thresholds set max_hours = 48, owner_role = 'lo', sub_steps = null
where stage = 'registered';

-- 2. Stage mapping updates for Questrock flow ---------------------------

-- Map pre-loan statuses to the new pipeline stages
update public.stage_mapping set normalized_stage = 'application', is_active_loan = true
where source_status in ('Application Sent', 'Application Started', 'Application Completed');

update public.stage_mapping set normalized_stage = 'lead', is_active_loan = false
where source_status = 'Pitched & Waiting';

update public.stage_mapping set normalized_stage = 'verification'
where source_status = 'Registered';

update public.stage_mapping set normalized_stage = 'approval_conditions'
where source_status in ('Approved', 'Conditions');

insert into public.stage_mapping (source_status, normalized_stage, is_active_loan) values
  ('Verification', 'verification', true),
  ('eSign Out', 'esign_out', true),
  ('E-Sign Out', 'esign_out', true),
  ('Approval Conditions', 'approval_conditions', true),
  ('Restructure Hold', 'processing', true)
on conflict (source_status) do update
set normalized_stage = excluded.normalized_stage,
    is_active_loan = excluded.is_active_loan;

-- Lead stage mapping
update public.stage_mapping set lead_stage = 'new_lead' where source_status = 'New Lead - Uncontacted';
update public.stage_mapping set lead_stage = 'attempting_contact' where source_status = 'Attempting Contact';
update public.stage_mapping set lead_stage = 'contacted' where source_status in ('Contacted - Follow Up Needed', 'Appointment Scheduled', 'Missed Appointment');
update public.stage_mapping set lead_stage = 'pitched' where source_status in ('Pitched & Waiting', 'Pitched - House Hunting');
update public.stage_mapping set lead_stage = 'pre_qualified' where source_status = 'Pre-Qualified';
update public.stage_mapping set lead_stage = 'pre_approved' where source_status = 'Pre-Approved';
update public.stage_mapping set lead_stage = 'application_sent' where source_status = 'Application Sent';
update public.stage_mapping set lead_stage = 'application_started' where source_status = 'Application Started';
update public.stage_mapping set lead_stage = 'application_completed' where source_status = 'Application Completed';
update public.stage_mapping set lead_stage = 'nurture' where source_status = 'Long Term Nurture';
update public.stage_mapping set lead_stage = 'dead' where source_status in ('Not Interested', 'Bad Lead', 'Do Not Call', 'No Response - Ghosted');
update public.stage_mapping set lead_stage = 'dead' where source_status like 'Denied%';
update public.stage_mapping set lead_stage = 'converted' where source_status in (
  'Registered', 'Verification', 'eSign Out', 'E-Sign Out',
  'Processing', 'Submission', 'Underwriting', 'Approved', 'Conditions',
  'Approval Conditions', 'Clear To Close', 'Closing Scheduled',
  'Closed', 'Funded', 'Purchased'
);

-- 3. Loan-type checklists -----------------------------------------------

-- Conventional Full Doc
insert into public.loan_type_checklists (id, loan_type, loan_purpose, documentation_type, name) values
  ('a0000000-0000-0000-0000-000000000001', 'Conventional', null, 'Full Doc', 'Conventional Full Doc Checklist')
on conflict (id) do nothing;

insert into public.checklist_items (checklist_id, title, sort_order, is_required) values
  ('a0000000-0000-0000-0000-000000000001', 'Completed 1003 / Uniform Residential Loan Application', 1, true),
  ('a0000000-0000-0000-0000-000000000001', 'Government-issued photo ID (all borrowers)', 2, true),
  ('a0000000-0000-0000-0000-000000000001', 'Social Security card or ITIN documentation', 3, true),
  ('a0000000-0000-0000-0000-000000000001', 'W-2s (last 2 years)', 4, true),
  ('a0000000-0000-0000-0000-000000000001', 'Federal tax returns (last 2 years, all pages + schedules)', 5, true),
  ('a0000000-0000-0000-0000-000000000001', 'Pay stubs (most recent 30 days)', 6, true),
  ('a0000000-0000-0000-0000-000000000001', 'Bank statements (last 2 months, all pages)', 7, true),
  ('a0000000-0000-0000-0000-000000000001', 'Asset/retirement account statements (last 2 months)', 8, false),
  ('a0000000-0000-0000-0000-000000000001', 'Purchase contract (if purchase)', 9, true),
  ('a0000000-0000-0000-0000-000000000001', 'Homeowners insurance declaration page', 10, true),
  ('a0000000-0000-0000-0000-000000000001', 'Credit report authorization', 11, true),
  ('a0000000-0000-0000-0000-000000000001', 'Gift letter + donor bank statements (if applicable)', 12, false),
  ('a0000000-0000-0000-0000-000000000001', 'Divorce decree / child support documentation (if applicable)', 13, false),
  ('a0000000-0000-0000-0000-000000000001', 'VOE or employment verification letter', 14, true)
on conflict do nothing;

-- FHA
insert into public.loan_type_checklists (id, loan_type, loan_purpose, documentation_type, name) values
  ('a0000000-0000-0000-0000-000000000002', 'FHA', null, 'Full Doc', 'FHA Checklist')
on conflict (id) do nothing;

insert into public.checklist_items (checklist_id, title, sort_order, is_required) values
  ('a0000000-0000-0000-0000-000000000002', 'Completed 1003 / Uniform Residential Loan Application', 1, true),
  ('a0000000-0000-0000-0000-000000000002', 'Government-issued photo ID (all borrowers)', 2, true),
  ('a0000000-0000-0000-0000-000000000002', 'Social Security card', 3, true),
  ('a0000000-0000-0000-0000-000000000002', 'W-2s (last 2 years)', 4, true),
  ('a0000000-0000-0000-0000-000000000002', 'Federal tax returns (last 2 years)', 5, true),
  ('a0000000-0000-0000-0000-000000000002', 'Pay stubs (most recent 30 days)', 6, true),
  ('a0000000-0000-0000-0000-000000000002', 'Bank statements (last 2 months, all pages)', 7, true),
  ('a0000000-0000-0000-0000-000000000002', 'Purchase contract', 8, true),
  ('a0000000-0000-0000-0000-000000000002', 'Homeowners insurance declaration page', 9, true),
  ('a0000000-0000-0000-0000-000000000002', 'FHA case number assignment', 10, true),
  ('a0000000-0000-0000-0000-000000000002', 'CAIVRS check', 11, true),
  ('a0000000-0000-0000-0000-000000000002', 'Gift letter + donor statements (if applicable)', 12, false),
  ('a0000000-0000-0000-0000-000000000002', 'Explanation letters (LOX) for derogatory credit', 13, false),
  ('a0000000-0000-0000-0000-000000000002', 'Residency/citizenship documentation', 14, true)
on conflict do nothing;

-- VA
insert into public.loan_type_checklists (id, loan_type, loan_purpose, documentation_type, name) values
  ('a0000000-0000-0000-0000-000000000003', 'VA', null, 'Full Doc', 'VA Checklist')
on conflict (id) do nothing;

insert into public.checklist_items (checklist_id, title, sort_order, is_required) values
  ('a0000000-0000-0000-0000-000000000003', 'Completed 1003', 1, true),
  ('a0000000-0000-0000-0000-000000000003', 'Government-issued photo ID', 2, true),
  ('a0000000-0000-0000-0000-000000000003', 'Certificate of Eligibility (COE)', 3, true),
  ('a0000000-0000-0000-0000-000000000003', 'DD-214 or Statement of Service', 4, true),
  ('a0000000-0000-0000-0000-000000000003', 'W-2s (last 2 years)', 5, true),
  ('a0000000-0000-0000-0000-000000000003', 'Federal tax returns (last 2 years)', 6, true),
  ('a0000000-0000-0000-0000-000000000003', 'Pay stubs (most recent 30 days)', 7, true),
  ('a0000000-0000-0000-0000-000000000003', 'Bank statements (last 2 months)', 8, true),
  ('a0000000-0000-0000-0000-000000000003', 'Purchase contract', 9, true),
  ('a0000000-0000-0000-0000-000000000003', 'Homeowners insurance', 10, true),
  ('a0000000-0000-0000-0000-000000000003', 'VA funding fee exemption letter (if applicable)', 11, false),
  ('a0000000-0000-0000-0000-000000000003', 'Termite inspection (as required by region)', 12, false)
on conflict do nothing;

-- DSCR
insert into public.loan_type_checklists (id, loan_type, loan_purpose, documentation_type, name) values
  ('a0000000-0000-0000-0000-000000000004', 'DSCR', null, 'DSCR', 'DSCR Non-QM Checklist')
on conflict (id) do nothing;

insert into public.checklist_items (checklist_id, title, sort_order, is_required) values
  ('a0000000-0000-0000-0000-000000000004', 'Completed 1003', 1, true),
  ('a0000000-0000-0000-0000-000000000004', 'Government-issued photo ID', 2, true),
  ('a0000000-0000-0000-0000-000000000004', 'Entity documents - Articles of Organization/Incorporation', 3, true),
  ('a0000000-0000-0000-0000-000000000004', 'Entity documents - Operating Agreement', 4, true),
  ('a0000000-0000-0000-0000-000000000004', 'Entity documents - EIN letter', 5, true),
  ('a0000000-0000-0000-0000-000000000004', 'Entity documents - Certificate of Good Standing', 6, true),
  ('a0000000-0000-0000-0000-000000000004', 'Current lease agreement / rent roll', 7, true),
  ('a0000000-0000-0000-0000-000000000004', 'Property insurance (HOI / landlord policy)', 8, true),
  ('a0000000-0000-0000-0000-000000000004', 'Appraisal with rental survey (1007/1025)', 9, true),
  ('a0000000-0000-0000-0000-000000000004', 'Bank statements (2 months for reserves)', 10, true),
  ('a0000000-0000-0000-0000-000000000004', 'Purchase contract', 11, true),
  ('a0000000-0000-0000-0000-000000000004', 'Title commitment', 12, true),
  ('a0000000-0000-0000-0000-000000000004', 'Flood certification', 13, true)
on conflict do nothing;

-- Non-QM Bank Statement
insert into public.loan_type_checklists (id, loan_type, loan_purpose, documentation_type, name) values
  ('a0000000-0000-0000-0000-000000000005', 'Non-QM', null, 'Bank Statement', 'Non-QM Bank Statement Checklist')
on conflict (id) do nothing;

insert into public.checklist_items (checklist_id, title, sort_order, is_required) values
  ('a0000000-0000-0000-0000-000000000005', 'Completed 1003', 1, true),
  ('a0000000-0000-0000-0000-000000000005', 'Government-issued photo ID', 2, true),
  ('a0000000-0000-0000-0000-000000000005', 'Personal bank statements (12 or 24 months)', 3, true),
  ('a0000000-0000-0000-0000-000000000005', 'Business bank statements (12 or 24 months, if self-employed)', 4, true),
  ('a0000000-0000-0000-0000-000000000005', 'CPA letter or P&L statement (if required by program)', 5, false),
  ('a0000000-0000-0000-0000-000000000005', 'Business license or proof of business existence (2+ years)', 6, true),
  ('a0000000-0000-0000-0000-000000000005', 'Purchase contract', 7, true),
  ('a0000000-0000-0000-0000-000000000005', 'Homeowners insurance', 8, true),
  ('a0000000-0000-0000-0000-000000000005', 'Asset statements for reserves', 9, true),
  ('a0000000-0000-0000-0000-000000000005', 'Title commitment', 10, true)
on conflict do nothing;

-- Construction
insert into public.loan_type_checklists (id, loan_type, loan_purpose, documentation_type, name) values
  ('a0000000-0000-0000-0000-000000000006', 'Construction', null, 'Full Doc', 'Construction Loan Checklist')
on conflict (id) do nothing;

insert into public.checklist_items (checklist_id, title, sort_order, is_required) values
  ('a0000000-0000-0000-0000-000000000006', 'Completed 1003', 1, true),
  ('a0000000-0000-0000-0000-000000000006', 'Government-issued photo ID', 2, true),
  ('a0000000-0000-0000-0000-000000000006', 'W-2s / tax returns (last 2 years)', 3, true),
  ('a0000000-0000-0000-0000-000000000006', 'Pay stubs (most recent 30 days)', 4, true),
  ('a0000000-0000-0000-0000-000000000006', 'Bank/asset statements (last 2 months)', 5, true),
  ('a0000000-0000-0000-0000-000000000006', 'Construction contract with licensed builder', 6, true),
  ('a0000000-0000-0000-0000-000000000006', 'Builder license and insurance certificates', 7, true),
  ('a0000000-0000-0000-0000-000000000006', 'Plans and specifications', 8, true),
  ('a0000000-0000-0000-0000-000000000006', 'Cost breakdown / line-item budget', 9, true),
  ('a0000000-0000-0000-0000-000000000006', 'Building permits (or evidence of pending)', 10, true),
  ('a0000000-0000-0000-0000-000000000006', 'Lot purchase documentation (deed, settlement)', 11, true),
  ('a0000000-0000-0000-0000-000000000006', 'Survey / plot plan', 12, true),
  ('a0000000-0000-0000-0000-000000000006', 'Builders risk / course of construction insurance', 13, true),
  ('a0000000-0000-0000-0000-000000000006', 'Environmental reports (if required)', 14, false)
on conflict do nothing;

-- Fix & Flip
insert into public.loan_type_checklists (id, loan_type, loan_purpose, documentation_type, name) values
  ('a0000000-0000-0000-0000-000000000007', 'Fix & Flip', null, 'DSCR', 'Fix & Flip Checklist')
on conflict (id) do nothing;

insert into public.checklist_items (checklist_id, title, sort_order, is_required) values
  ('a0000000-0000-0000-0000-000000000007', 'Completed 1003', 1, true),
  ('a0000000-0000-0000-0000-000000000007', 'Government-issued photo ID', 2, true),
  ('a0000000-0000-0000-0000-000000000007', 'Entity documents (Articles, Operating Agreement, EIN, Good Standing)', 3, true),
  ('a0000000-0000-0000-0000-000000000007', 'Rehab budget / scope of work', 4, true),
  ('a0000000-0000-0000-0000-000000000007', 'Contractor bid(s) and license', 5, true),
  ('a0000000-0000-0000-0000-000000000007', 'Purchase contract', 6, true),
  ('a0000000-0000-0000-0000-000000000007', 'As-is appraisal and ARV appraisal', 7, true),
  ('a0000000-0000-0000-0000-000000000007', 'Bank statements (2 months for reserves/down payment)', 8, true),
  ('a0000000-0000-0000-0000-000000000007', 'Experience resume (prior flips)', 9, true),
  ('a0000000-0000-0000-0000-000000000007', 'Property insurance (builders risk)', 10, true),
  ('a0000000-0000-0000-0000-000000000007', 'Title commitment', 11, true),
  ('a0000000-0000-0000-0000-000000000007', 'Draw schedule', 12, true)
on conflict do nothing;
