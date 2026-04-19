-- Executive-only notifications feed. Two event kinds today:
--   1. 'hot_signal'       — a new priority>=4 signal landed (realtime trigger)
--   2. 'morning_digest'   — cron-generated summary of today's pipeline priorities
--
-- Future kinds: 'market_rate_drop', 'lo_performance_anomaly', etc.
--
-- RLS: a notification row belongs to a single user_id (the executive it's
-- delivered to). Users see only their own rows.

create table if not exists public.executive_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  kind text not null,
  title text not null,
  body text null,
  signal_id uuid null references public.deal_signals (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz null
);

create index if not exists executive_notifications_user_created_idx
  on public.executive_notifications (user_id, created_at desc);
create index if not exists executive_notifications_unread_idx
  on public.executive_notifications (user_id) where read_at is null;
create index if not exists executive_notifications_signal_idx
  on public.executive_notifications (signal_id) where signal_id is not null;

alter table public.executive_notifications enable row level security;

drop policy if exists executive_notifications_select_own on public.executive_notifications;
create policy executive_notifications_select_own
on public.executive_notifications
for select
using (
  user_id = auth.uid()
  and public.current_user_role() in ('executive', 'admin')
);

drop policy if exists executive_notifications_update_own on public.executive_notifications;
create policy executive_notifications_update_own
on public.executive_notifications
for update
using (
  user_id = auth.uid()
  and public.current_user_role() in ('executive', 'admin')
);

comment on table public.executive_notifications is
  'Per-executive notification feed (hot signals + morning digest). User-scoped RLS.';

-- ----------------------------------------------------------------------
-- Trigger: fan out new priority-4+ signals to every executive/admin user.
-- ----------------------------------------------------------------------

create or replace function public.fanout_hot_signal_to_execs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  exec_id uuid;
  loan_label text;
begin
  if NEW.priority < 4 or NEW.dismissed_at is not null then
    return NEW;
  end if;

  -- Skip if we've already fanned out this dedupe_key today (avoid spam on re-runs).
  if exists (
    select 1 from public.executive_notifications
    where signal_id = NEW.id
  ) then
    return NEW;
  end if;

  -- Build a short label for the notification.
  select coalesce(nullif(trim(concat_ws(' ', borrower_first_name, borrower_last_name)), ''), 'borrower')
  into loan_label
  from public.loans
  where id = NEW.loan_id;

  for exec_id in
    select id from public.users where role in ('executive', 'admin')
  loop
    insert into public.executive_notifications (user_id, kind, title, body, signal_id, payload)
    values (
      exec_id,
      'hot_signal',
      format('Hot %s on %s', NEW.signal_type, coalesce(NEW.lo_name, 'unassigned')),
      format('%s — %s', coalesce(loan_label, 'borrower'), NEW.reason),
      NEW.id,
      jsonb_build_object(
        'signal_type', NEW.signal_type,
        'priority', NEW.priority,
        'lo_name', NEW.lo_name,
        'lo_user_id', NEW.lo_user_id,
        'loan_id', NEW.loan_id
      )
    );
  end loop;

  return NEW;
end;
$$;

drop trigger if exists deal_signals_fanout_hot on public.deal_signals;
create trigger deal_signals_fanout_hot
after insert on public.deal_signals
for each row
execute function public.fanout_hot_signal_to_execs();

comment on function public.fanout_hot_signal_to_execs() is
  'Fan out new priority>=4 deal_signals rows to every executive/admin user as hot_signal notifications.';
