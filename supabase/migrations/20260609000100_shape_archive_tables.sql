-- Shape archive: historical leads (pre-2026) stored for AI search.
-- Leads in this table are NOT active pipeline — they are read-only historical records.

CREATE TABLE IF NOT EXISTS shape_archive_leads (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shape_lead_id         bigint      UNIQUE NOT NULL,
  first_name            text,
  last_name             text,
  phone                 text,
  email                 text,
  lead_source           text,
  status_raw            text,
  loan_officer_name     text,
  loan_amount_cents     bigint,
  property_state        text,
  created_date          date,
  last_activity_date    date,
  notes_sidebar         text,
  notes_sidebar_ai_note text,
  recent_notes          text,
  -- Full raw export row for flexible AI queries
  bulk_fields           jsonb,
  archived_at           timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shape_archive_leads_status_idx
  ON shape_archive_leads (status_raw);
CREATE INDEX IF NOT EXISTS shape_archive_leads_lo_idx
  ON shape_archive_leads (loan_officer_name);
CREATE INDEX IF NOT EXISTS shape_archive_leads_created_idx
  ON shape_archive_leads (created_date DESC);

-- Individual note rows parsed from sidebar / AI note / recent_notes.
-- Used for granular AI search and context building.
CREATE TABLE IF NOT EXISTS shape_archive_notes (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shape_lead_id bigint     NOT NULL REFERENCES shape_archive_leads(shape_lead_id) ON DELETE CASCADE,
  note_source  text        NOT NULL CHECK (note_source IN ('shape_sidebar', 'shape_ai_note', 'shape_recent')),
  content      text        NOT NULL,
  -- Stable dedup key: shape-sidebar:{leadId}:{index}
  external_id  text        UNIQUE NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shape_archive_notes_lead_idx
  ON shape_archive_notes (shape_lead_id);

-- Batch tracking so we know when each archive run happened.
CREATE TABLE IF NOT EXISTS shape_archive_batches (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  date_from   date        NOT NULL,
  date_to     date        NOT NULL,
  leads_count int         NOT NULL DEFAULT 0,
  notes_count int         NOT NULL DEFAULT 0,
  status      text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'complete', 'error')),
  error_msg   text,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
