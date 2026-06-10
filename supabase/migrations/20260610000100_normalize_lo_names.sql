-- Fix LO names stored as "Last, First" from Shape CSV exports.
-- Pattern: any assigned_loan_officer_name containing exactly one comma where
-- both sides are non-empty — flip to "First Last".

UPDATE public.loans
SET assigned_loan_officer_name = TRIM(
  SPLIT_PART(assigned_loan_officer_name, ',', 2)
  || ' '
  || SPLIT_PART(assigned_loan_officer_name, ',', 1)
)
WHERE assigned_loan_officer_name LIKE '%,%'
  -- exactly one comma
  AND LENGTH(assigned_loan_officer_name) - LENGTH(REPLACE(assigned_loan_officer_name, ',', '')) = 1
  -- both sides non-empty
  AND TRIM(SPLIT_PART(assigned_loan_officer_name, ',', 1)) <> ''
  AND TRIM(SPLIT_PART(assigned_loan_officer_name, ',', 2)) <> '';

-- Verify: should be 0 rows after migration
-- SELECT assigned_loan_officer_name FROM public.loans
-- WHERE assigned_loan_officer_name LIKE '%,%';
