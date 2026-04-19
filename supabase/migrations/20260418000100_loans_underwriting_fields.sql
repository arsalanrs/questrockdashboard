-- Phase 2: schema expansion for refi / ARM / FICO / veteran / HMDA signals.
-- All columns nullable + additive so existing code stays compatible.

alter table public.loans add column if not exists note_rate_bps int null;
alter table public.loans add column if not exists original_rate_bps int null;
alter table public.loans add column if not exists property_value_cents bigint null;
alter table public.loans add column if not exists current_loan_balance_cents bigint null;
alter table public.loans add column if not exists ltv_bps int null;
alter table public.loans add column if not exists cltv_bps int null;
alter table public.loans add column if not exists credit_score_mid int null;
alter table public.loans add column if not exists dti_bps int null;
alter table public.loans add column if not exists is_veteran boolean null;
alter table public.loans add column if not exists arm_first_reset_date date null;
alter table public.loans add column if not exists arm_index text null;
alter table public.loans add column if not exists arm_margin_bps int null;
alter table public.loans add column if not exists hmda_denial_reason text null;
alter table public.loans add column if not exists do_not_contact boolean not null default false;
alter table public.loans add column if not exists last_contacted_at timestamptz null;
alter table public.loans add column if not exists reason_code text null;
alter table public.loans add column if not exists insellerate_ref_id text null;
alter table public.loans add column if not exists borrower_email text null;
alter table public.loans add column if not exists borrower_phone text null;
alter table public.loans add column if not exists loan_age_months int null;
alter table public.loans add column if not exists funded_at timestamptz null;

comment on column public.loans.note_rate_bps is 'Note rate in basis points (e.g. 6.875% = 6875 / 100 = 687.5 → store as 688).';
comment on column public.loans.original_rate_bps is 'Original rate at origination (for historical refi candidates).';
comment on column public.loans.property_value_cents is 'Current property value; used for equity/LTV signals.';
comment on column public.loans.ltv_bps is 'Loan-to-value in basis points (7500 = 75.00%).';
comment on column public.loans.credit_score_mid is 'Mid (of 3 bureaus) FICO at last pull.';
comment on column public.loans.dti_bps is 'Debt-to-income in basis points (4250 = 42.50%).';
comment on column public.loans.arm_first_reset_date is 'First ARM adjustment date; key input to refi radar.';
comment on column public.loans.do_not_contact is 'Compliance flag; refi signals must skip these borrowers.';
comment on column public.loans.insellerate_ref_id is 'Historical Insellerate reference id for dedupe across systems.';

create index if not exists loans_note_rate_bps_idx on public.loans (loan_type, note_rate_bps) where note_rate_bps is not null;
create index if not exists loans_arm_reset_idx on public.loans (arm_first_reset_date) where arm_first_reset_date is not null;
create index if not exists loans_credit_score_idx on public.loans (credit_score_mid) where credit_score_mid is not null;
create index if not exists loans_closed_at_idx on public.loans (closed_at) where closed_at is not null;
create index if not exists loans_funded_at_idx on public.loans (funded_at) where funded_at is not null;
create unique index if not exists loans_insellerate_ref_uidx on public.loans (insellerate_ref_id) where insellerate_ref_id is not null;
create index if not exists loans_borrower_email_idx on public.loans (borrower_email) where borrower_email is not null;
