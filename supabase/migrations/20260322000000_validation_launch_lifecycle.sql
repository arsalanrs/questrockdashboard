-- QuestRock PDF: Validation Launch requires signed package + appraisal payment collected.
-- Signed package: use existing loans.esign_returned_at (e-sign returned).
-- Appraisal payment: loans.appraisal_payment_collected_at (from Shape/custom field when available).

alter table public.loans
  add column if not exists appraisal_payment_collected_at timestamptz null;

comment on column public.loans.appraisal_payment_collected_at is 'When borrower appraisal fee payment was collected; with esign_returned_at completes Validation Launch gate.';
comment on column public.loans.esign_returned_at is 'Proxy for signed application/package returned (QuestRock Verification milestone).';

-- Both gates satisfied => validation launch instant = later of the two timestamps.
alter table public.loans
  drop column if exists validation_launched_at;

alter table public.loans
  add column validation_launched_at timestamptz generated always as (
    case
      when esign_returned_at is not null and appraisal_payment_collected_at is not null
      then greatest(esign_returned_at, appraisal_payment_collected_at)
      else null
    end
  ) stored;

comment on column public.loans.validation_launched_at is 'Generated: set when both esign_returned_at and appraisal_payment_collected_at are non-null (Validation Launch).';

create index if not exists loans_validation_launched_at_idx
  on public.loans (validation_launched_at)
  where validation_launched_at is not null;
