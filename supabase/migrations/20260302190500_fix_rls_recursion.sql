-- Fix infinite recursion: policies on users (and others) must not query public.users
-- via RLS. Use a SECURITY DEFINER function that bypasses RLS to get current user's role.

create or replace function public.current_user_role()
returns public.app_role
language sql
security definer
set search_path = public
stable
as $$
  select role from public.users where id = auth.uid() limit 1;
$$;

-- Teams/members: avoid mutual recursion (teams <-> team_members). Use SECURITY DEFINER helpers.
create or replace function public.current_user_team_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select team_id from public.team_members where user_id = auth.uid();
$$;

create or replace function public.current_user_managed_team_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select id from public.teams where manager_user_id = auth.uid();
$$;

create or replace function public.current_user_managed_team_member_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select tm.user_id from public.team_members tm
  where tm.team_id in (select id from public.teams where manager_user_id = auth.uid());
$$;

-- Drop and recreate users policy (no query to users/teams/team_members via RLS)
drop policy if exists users_select_self_or_admin on public.users;
create policy users_select_self_or_admin
on public.users
for select
using (
  id = auth.uid()
  or public.current_user_role() in ('executive', 'admin')
  or (
    public.current_user_role() = 'manager'
    and public.users.id in (select public.current_user_managed_team_member_ids())
  )
);

-- teams: no query to team_members via RLS
drop policy if exists teams_select_scoped on public.teams;
create policy teams_select_scoped
on public.teams
for select
using (
  public.current_user_role() in ('executive', 'admin')
  or manager_user_id = auth.uid()
  or public.teams.id in (select public.current_user_team_ids())
);

-- team_members: no query to teams via RLS
drop policy if exists team_members_select_scoped on public.team_members;
create policy team_members_select_scoped
on public.team_members
for select
using (
  public.current_user_role() in ('executive', 'admin')
  or public.team_members.team_id in (select public.current_user_managed_team_ids())
  or user_id = auth.uid()
);

-- import tables: use helper
drop policy if exists import_batches_select_admin on public.import_batches;
create policy import_batches_select_admin
on public.import_batches
for select
using (public.current_user_role() in ('executive', 'admin'));

drop policy if exists raw_shape_kpi_leads_select_admin on public.raw_shape_kpi_leads;
create policy raw_shape_kpi_leads_select_admin
on public.raw_shape_kpi_leads
for select
using (public.current_user_role() in ('executive', 'admin'));

-- loans: use helpers only (no query to users/teams/team_members via RLS)
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
