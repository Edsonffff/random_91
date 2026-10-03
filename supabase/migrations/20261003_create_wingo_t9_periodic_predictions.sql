-- Experimental Test 9: CPL-1 probability -> frozen CPL-3 final prediction
-- Predictions and settlements are intentionally stored separately from
-- public.wingo_t7_signals and every existing test table.

CREATE TABLE IF NOT EXISTS public.wingo_t9_periodic_predictions (
  game_code              TEXT        NOT NULL DEFAULT 'WinGo_30S',
  period_id              TEXT        NOT NULL,
  algorithm_version      TEXT        NOT NULL DEFAULT 'CPL-3',
  prediction             TEXT        CHECK (prediction IN ('BIG', 'SMALL')),
  probability_big        NUMERIC(12, 10),
  cpl1_prediction        TEXT        CHECK (cpl1_prediction IN ('BIG', 'SMALL')),
  cpl1_probability_big   NUMERIC(12, 10),
  cpl1_probability_small NUMERIC(12, 10),
  cpl3_config             TEXT        NOT NULL DEFAULT 'context-8-cap-3',
  previous_loss_streak    INTEGER     NOT NULL DEFAULT 0,
  cpl3_prediction         TEXT        CHECK (cpl3_prediction IN ('BIG', 'SMALL')),
  feature_names          JSONB       NOT NULL,
  feature_values         JSONB       NOT NULL,
  training_count         INTEGER     NOT NULL,
  trained_through_period TEXT,
  actual_number          SMALLINT,
  actual_size            TEXT        CHECK (actual_size IN ('BIG', 'SMALL')),
  outcome                TEXT        CHECK (outcome IN ('WIN', 'LOSS', 'NO_SIGNAL')),
  predicted_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT wingo_t9_periodic_predictions_pkey PRIMARY KEY (game_code, period_id)
);

-- Safe upgrade path if an earlier CPL-1-only version of this table already exists.
ALTER TABLE public.wingo_t9_periodic_predictions
  ALTER COLUMN algorithm_version SET DEFAULT 'CPL-3',
  ADD COLUMN IF NOT EXISTS cpl1_prediction        TEXT CHECK (cpl1_prediction IN ('BIG', 'SMALL')),
  ADD COLUMN IF NOT EXISTS cpl1_probability_big   NUMERIC(12, 10),
  ADD COLUMN IF NOT EXISTS cpl1_probability_small NUMERIC(12, 10),
  ADD COLUMN IF NOT EXISTS cpl3_config             TEXT DEFAULT 'context-8-cap-3',
  ADD COLUMN IF NOT EXISTS previous_loss_streak    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cpl3_prediction         TEXT CHECK (cpl3_prediction IN ('BIG', 'SMALL'));

CREATE INDEX IF NOT EXISTS idx_wingo_t9_periodic_predictions_period
  ON public.wingo_t9_periodic_predictions (period_id DESC);

ALTER TABLE public.wingo_t9_periodic_predictions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.wingo_t9_periodic_predictions IS
  'Experimental Test 9 frozen CPL-3 predictions over CPL-1 probabilities, exact features, and settlements.';
