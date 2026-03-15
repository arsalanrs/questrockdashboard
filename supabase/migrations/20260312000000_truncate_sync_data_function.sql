-- Function for admin to clear all synced data (raw, loans, leads, etc.)
-- Called from the app via service role only.
create or replace function public.truncate_sync_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  truncate
    public.raw_shape_kpi_leads,
    public.loan_checklist_entries,
    public.ownership_log,
    public.notifications,
    public.conditions,
    public.loan_stage_events,
    public.loans,
    public.leads,
    public.import_batches
  cascade;
end;
$$;

-- Only the service role can call this (admin client uses service role)
grant execute on function public.truncate_sync_data() to service_role;
