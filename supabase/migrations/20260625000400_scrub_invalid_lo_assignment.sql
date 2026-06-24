-- Remove junk LO assignment from Shape field-map bug (loanAmount/loanType matched as LO name).

update public.loans
set
  assigned_loan_officer_name = null,
  assigned_loan_officer_user_id = null
where lendingpad_loan_uuid is null
  and assigned_loan_officer_name is not null
  and (
    assigned_loan_officer_name ~ '^\d+$'
    or assigned_loan_officer_name ~ '^\d'
    or assigned_loan_officer_name ~* '[km]\s*[-–—]'
    or assigned_loan_officer_name ~* '^\d+\.?\d*[km]$'
    or lower(trim(assigned_loan_officer_name)) in (
      'purchase', 'refinance', 'conventional', 'fha', 'va', 'usda', 'other',
      'fixed', 'arm', 'primary', 'secondary', 'investment', 'construction', 'rehab'
    )
    or assigned_loan_officer_name ~ '^\([\d\s\-–—]+\)'
  );

-- Fix LP-linked rows: restore display name from users table.
update public.loans l
set assigned_loan_officer_name = u.full_name
from public.users u
where l.lendingpad_loan_uuid is not null
  and l.assigned_loan_officer_user_id = u.id
  and (
    l.assigned_loan_officer_name is null
    or l.assigned_loan_officer_name ~ '^\d'
    or l.assigned_loan_officer_name ~* '[km]'
    or lower(trim(l.assigned_loan_officer_name)) in (
      'purchase', 'refinance', 'conventional', 'other'
    )
  );
