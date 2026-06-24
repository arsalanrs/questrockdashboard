-- Shape sync reported unmapped status after rebuild (Jun 2026).

insert into public.stage_mapping (source_status, normalized_stage, is_active_loan) values
  ('Submitted to Underwriting', 'underwriting', true)
on conflict (source_status) do update
  set normalized_stage = excluded.normalized_stage,
      is_active_loan   = excluded.is_active_loan;

update public.loans
set current_stage = 'underwriting'
where status_raw = 'Submitted to Underwriting'
  and (current_stage is null or current_stage <> 'underwriting');

-- Loan amounts were mis-mapped to assigned_loan_officer_name (field-map loa/loanAmount bug).
update public.loans
set assigned_loan_officer_name = null
where assigned_loan_officer_name ~ '^\d{4,}$';
