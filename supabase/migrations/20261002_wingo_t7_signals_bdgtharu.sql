-- ============================================================
-- Migration: extend wingo_t7_signals for the bdgtharu.com source
--
-- Test 7's prediction source was replaced:
--   OLD: https://server.wingoaibot.com/signals/current?room=30sec&type=standard
--   NEW: https://bdgtharu.com/api.php?_=<cache-buster>
--
-- The EXISTING table is reused (requirement: do not create a second
-- Test 7 table).  The 249 existing WingoAI rows are left untouched so
-- historical records and past accuracy keep working.
--
-- All new columns are NULLable and added with IF NOT EXISTS, so this
-- is safe to re-run.  Rows written by the old WingoAI collector simply
-- have NULL in these columns and are read exactly as before.
-- ============================================================

ALTER TABLE public.wingo_t7_signals
  -- prediction.color: 'RED' | 'GREEN' | 'VIOLET' (NULL for legacy WingoAI rows)
  ADD COLUMN IF NOT EXISTS color              TEXT,
  -- prediction.status: 'pending' | 'win' | 'loss'
  ADD COLUMN IF NOT EXISTS status             TEXT,
  -- prediction.source, e.g. 'server' / 'bdgtharu'
  ADD COLUMN IF NOT EXISTS source             TEXT,
  -- prediction.algorithmVersion
  ADD COLUMN IF NOT EXISTS algorithm_version  INTEGER,
  -- prediction.guardApplied (absent on pending predictions -> NULL)
  ADD COLUMN IF NOT EXISTS guard_applied      BOOLEAN,
  -- Settled result for this issue, as reported by the upstream server.
  -- NOTE: these are the ACTUAL outcome, never the prediction.
  ADD COLUMN IF NOT EXISTS actual_number      SMALLINT,
  ADD COLUMN IF NOT EXISTS actual_color       TEXT,
  -- Settlement flags: did the prediction hit?
  ADD COLUMN IF NOT EXISTS size_hit           BOOLEAN,
  ADD COLUMN IF NOT EXISTS color_hit          BOOLEAN,
  -- prediction.settledAt (epoch ms upstream) / server settlement time
  ADD COLUMN IF NOT EXISTS settled_at         TIMESTAMPTZ,
  -- prediction.createdAt (epoch ms upstream) = when the server created
  -- the prediction.  Deliberately NOT written into the table's own
  -- `created_at` column, which stays the database's insert audit trail.
  ADD COLUMN IF NOT EXISTS prediction_created_at TIMESTAMPTZ;

-- Partial index for "which issues are still pending" — the settlement
-- pass runs every poll and only needs unresolved rows.
CREATE INDEX IF NOT EXISTS idx_wingo_t7_signals_pending
  ON public.wingo_t7_signals (period_id DESC)
  WHERE status = 'pending';

-- No CHECK constraint on `status` is added on purpose: the collector must
-- keep working if upstream introduces a new status value (requirement 12).
