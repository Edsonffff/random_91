-- ============================================================
-- Migration: Create wingo_t7_signals table
--
-- Run this once in your Supabase SQL Editor (or via psql).
-- This table stores WingoAI signals fetched by the backend
-- collector.  The auth token is NEVER stored here — only the
-- publicly-usable signal value, confidence, and fetch time.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.wingo_t7_signals (
  -- The WinGo 30S period identifier (matches issue_number in real_wingo_30s_history)
  period_id        TEXT        NOT NULL,
  -- The WingoAI signal: always 'BIG' or 'SMALL'
  signal           TEXT        NOT NULL CHECK (signal IN ('BIG', 'SMALL')),
  -- Provider-reported confidence (0–100).  NULL if not returned by the API.
  confidence       SMALLINT,
  -- ISO timestamp when this signal was fetched by the backend collector
  fetched_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT wingo_t7_signals_pkey PRIMARY KEY (period_id)
);

-- Index for fast descending period lookups (used by /api/real/t7-signals)
CREATE INDEX IF NOT EXISTS idx_wingo_t7_signals_period_id
  ON public.wingo_t7_signals (period_id DESC);

-- Row-Level Security: allow the service-role key (used by backend collector) full access.
-- Enable RLS so anon/authenticated keys cannot read signals directly from the browser.
ALTER TABLE public.wingo_t7_signals ENABLE ROW LEVEL SECURITY;

-- Service-role bypasses RLS by default, so no policy needed for the collector.
-- If you want the Vite frontend anon key to be able to read signals directly (NOT RECOMMENDED),
-- add a policy here.  The recommended architecture is to only expose signals via the
-- Express /api/real/t7-signals endpoint which uses the service-role key on the server.
