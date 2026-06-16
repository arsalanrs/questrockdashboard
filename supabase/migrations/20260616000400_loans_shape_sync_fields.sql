-- =============================================================================
-- Add new columns to public.loans for Shape sync enrichment and LP freshness.
-- =============================================================================

-- shape_last_updated_at: set from Shape's lastActivityDate field (already in export,
--   previously discarded). Powers the "Last synced X min ago" freshness indicator.
alter table public.loans
  add column if not exists shape_last_updated_at timestamptz;

-- lp_last_synced_at: set to now() each time LP sync touches a row.
--   Powers "LP data current as of…" freshness indicator.
alter table public.loans
  add column if not exists lp_last_synced_at timestamptz;

-- down_payment_cents: from Shape's "Down Payment Amount" field (already exported,
--   mapped via field-map but not stored). Useful for purchase loan analysis.
alter table public.loans
  add column if not exists down_payment_cents bigint;

-- estimated_appraisal_value_cents: from Shape's "Estimated Appraisal Value" field.
--   Used for LTV signals and pipeline completeness checks.
alter table public.loans
  add column if not exists estimated_appraisal_value_cents bigint;

-- Index shape_last_updated_at for "recently updated" queries
create index if not exists loans_shape_last_updated_idx
  on public.loans (shape_last_updated_at desc nulls last);
