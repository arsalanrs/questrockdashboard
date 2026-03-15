-- Migration 1 of 3: Enum additions ONLY.
-- PostgreSQL requires ALTER TYPE ADD VALUE to be committed before the new
-- values can be referenced in DDL/DML, so this must be a separate migration.

-- New enums
do $$
begin
  if not exists (select 1 from pg_type where typname = 'lead_stage') then
    create type public.lead_stage as enum (
      'new_lead','attempting_contact','contacted','pitched',
      'pre_qualified','pre_approved',
      'application_sent','application_started','application_completed',
      'nurture','dead','converted'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'notification_type') then
    create type public.notification_type as enum (
      'verification_complete','esign_requested','esign_returned',
      'processing_deadline','restructure_hold','processing_complete',
      'uw_decision','mini_meeting_needed','conditions_submitted',
      'pre_cd_ready','ctc','lock_warning','contingency_warning','sla_warning'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'checklist_entry_status') then
    create type public.checklist_entry_status as enum ('pending','received','waived','na');
  end if;
end $$;

-- Extend loan_pipeline_stage with Questrock stages.
-- Each ADD VALUE must be outside a transaction block in some clients, but
-- Supabase migrations run each file as its own transaction, and ADD VALUE
-- inside a transaction is allowed in PG 12+. The key constraint is that you
-- cannot *use* the new values until AFTER the transaction that added them commits.
alter type public.loan_pipeline_stage add value if not exists 'lead' before 'registered';
alter type public.loan_pipeline_stage add value if not exists 'application' after 'lead';
alter type public.loan_pipeline_stage add value if not exists 'verification' after 'application';
alter type public.loan_pipeline_stage add value if not exists 'esign_out' after 'verification';
alter type public.loan_pipeline_stage add value if not exists 'approval_conditions' after 'conditions';
