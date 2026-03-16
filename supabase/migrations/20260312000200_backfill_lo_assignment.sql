-- Backfill assigned_loan_officer_user_id from assigned_loan_officer_name
-- so loans synced from Shape show up for the right LO (Jessica, Bastian, etc.)
-- when names in Shape match public.users.full_name (case-insensitive, trimmed).

update public.loans l
set assigned_loan_officer_user_id = u.id
from public.users u
where lower(trim(l.assigned_loan_officer_name)) = lower(trim(u.full_name))
  and (l.assigned_loan_officer_user_id is null or l.assigned_loan_officer_user_id != u.id);
