-- Clear Shape incremental sync watermark when wiping synced data (next sync bootstraps again).
create or replace function public.truncate_sync_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  truncate public.shape_sync_watermark;
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
