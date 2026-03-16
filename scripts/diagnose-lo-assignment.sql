-- Run in Supabase SQL Editor to see why LOs might see no loans.
-- 1) Assignment counts on loans
select
  assigned_loan_officer_name,
  assigned_loan_officer_user_id is not null as has_user_id,
  count(*) as cnt
from public.loans
group by 1, 2
order by cnt desc;

-- 2) Users that should match (for backfill / CSV)
select id, full_name, role from public.users order by full_name;

-- 3) Loans with no assignment (invisible to LOs under RLS)
select count(*) as unassigned_count from public.loans where assigned_loan_officer_user_id is null;
