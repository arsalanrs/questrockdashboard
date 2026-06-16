-- =============================================================================
-- Backfill assigned_loan_officer_user_id for rows where it is currently NULL
-- but we can match the LO by email (loan_officer_email field from Shape).
-- Runs as a one-time migration; subsequent syncs use the patched payload builder.
-- =============================================================================

-- 1. Name-based backfill (normalised lower-case match)
update public.loans l
set assigned_loan_officer_user_id = u.id
from public.users u
where l.assigned_loan_officer_user_id is null
  and l.assigned_loan_officer_name is not null
  and lower(trim(l.assigned_loan_officer_name)) = lower(trim(u.full_name));

-- 2. Email-based backfill for rows still NULL after the name pass
update public.loans l
set assigned_loan_officer_user_id = u.id
from public.users u
where l.assigned_loan_officer_user_id is null
  and l.loan_officer_email is not null
  and lower(trim(l.loan_officer_email)) = lower(trim(u.email));
