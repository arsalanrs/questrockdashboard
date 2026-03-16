-- Restrict loans so each LO sees only their assigned leads; managers see only their team's; admin sees all.
-- Remove visibility of unassigned loans to LOs and managers.

drop policy if exists loans_select_scoped on public.loans;
create policy loans_select_scoped
on public.loans
for select
using (
  public.current_user_role() in ('executive', 'admin')
  or (
    public.current_user_role() = 'loan_officer'
    and assigned_loan_officer_user_id = auth.uid()
  )
  or (
    public.current_user_role() = 'manager'
    and assigned_loan_officer_user_id in (select public.current_user_managed_team_member_ids())
  )
  or (
    public.current_user_role() = 'processor'
    and current_stage::text in (
      'verification','esign_out','processing','submission',
      'underwriting','conditions','approval_conditions'
    )
  )
  or (
    public.current_user_role() = 'closer'
    and current_stage::text in ('clear_to_close', 'closing')
  )
);
