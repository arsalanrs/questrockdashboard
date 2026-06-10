-- Add Shape notes columns to loans table for daily sync storage.
ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS notes_sidebar         text,
  ADD COLUMN IF NOT EXISTS notes_sidebar_ai_note text,
  ADD COLUMN IF NOT EXISTS recent_notes          text;
