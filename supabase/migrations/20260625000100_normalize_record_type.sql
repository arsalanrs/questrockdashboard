-- Normalize Shape record_type singulars (Loan → Loans) for view matching.

update public.loans
set record_type = 'Loans'
where record_type = 'Loan';

update public.loans
set record_type = 'Applications'
where record_type = 'Application';

update public.loans
set record_type = 'Leads'
where record_type = 'Lead';
