-- Allow loan officers to see unassigned loans (assigned_loan_officer_user_id is null)
-- so that synced Shape data without assignment is visible until assignment is populated.

drop policy if exists loans_select_scoped on public.loans;
create policy loans_select_scoped
on public.loans
for select
using (
  public.current_user_role() in ('executive', 'admin')
  or (
    public.current_user_role() = 'loan_officer'
    and (assigned_loan_officer_user_id = auth.uid() or assigned_loan_officer_user_id is null)
  )
  or (
    public.current_user_role() = 'manager'
    and public.loans.assigned_loan_officer_user_id in (select public.current_user_managed_team_member_ids())
  )
  or (
    public.current_user_role() = 'processor'
    and current_stage in ('processing', 'submission', 'underwriting', 'conditions')
  )
  or (
    public.current_user_role() = 'closer'
    and current_stage in ('clear_to_close', 'closing')
  )
);
