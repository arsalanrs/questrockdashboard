-- Improve LO assignment backfill: match "Last, First" Shape name format.

update public.loans l
set assigned_loan_officer_user_id = u.id
from public.users u
where l.assigned_loan_officer_user_id is null
  and l.assigned_loan_officer_name is not null
  and position(',' in l.assigned_loan_officer_name) > 0
  and lower(trim(
    split_part(l.assigned_loan_officer_name, ',', 2) || ' ' ||
    split_part(l.assigned_loan_officer_name, ',', 1)
  )) = lower(trim(u.full_name));
