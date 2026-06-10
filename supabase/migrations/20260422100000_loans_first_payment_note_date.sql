-- First payment + note date for book cadence (LendingPad when available).

alter table public.loans
  add column if not exists first_payment_date date null;

alter table public.loans
  add column if not exists note_date date null;

comment on column public.loans.first_payment_date is 'First scheduled payment date (e.g. from LOS) — book cadence touchpoints.';
comment on column public.loans.note_date is 'Note date when useful for seasoning anchors.';
