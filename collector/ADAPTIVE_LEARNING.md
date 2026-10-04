# Phone-side Adaptive Learning

The collector exposes `GET /api/adaptive-learning/current`. A dedicated Node worker
thread performs the calculations so CPL-1 fitting and startup recovery do not block
the collector's HTTP server, BDGTharu polling, or result ingestion.

## Setup on Termux

1. Apply `collector/adaptive-learning-schema.sql` once in the Supabase SQL editor.
2. Use the collector's existing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
3. Run the existing `npm start` from `collector/`. Run one adaptive worker per database.

The generated algorithm file ships with the collector. TypeScript, React, and the
frontend source tree are **not** required on the phone. Node 18+ is supported.
The schema creates only `wingo_adaptive_checkpoints`; it does not alter the existing
history or T7 tables. Checkpoints are service-role-only.

## Exact algorithm provenance

`build-adaptive-algorithms.mjs` uses TypeScript's parser to extract:

- T3: the chart, conflicting-pair set, and complete `test3` memo calculation in
  `src/components/history/AlgorithmAnalyzer.tsx`.
- T7: `computeTest7` and its pure helpers in
  `src/components/history/AdditionalSignalsPanel.tsx`.
- T9: `periodicLogisticAlgorithm.ts` and the original CPL-3 helpers/loop in
  `cpl3LossStreakBreaker.ts`, using `context-8-cap-3`.
- Adaptive: the vote helpers and verbatim chronological prediction/update loop
  in `src/hooks/useAdaptiveLearning.ts`.

The generator also includes the original full browser replay and input-joining
calculations as the independent full-replay reference for parity tests. It changes
the lifetime of CPL-3 state, not its loop's decision/settlement statements. The
adaptive update loop runs once for each new settled row. T3 uses the previous two
completed results. CPL-1 fits the original model for each new target (120 iterations,
same features, regularization and eligible training rows); it does not recompute
predictions for old targets during normal polling.

Missing-chart T3 pairs, absent stored T7 signals, and CPL-1's minimum-history gate
retain the browser's real no-signal outcomes. The browser's adaptive tie/no-vote
decision and initial equal weights are also preserved by the extracted source.
Only T3, T7, and T9 vote.

Historical CPL-1 uses ascending training order; active CPL-1 uses descending order,
matching `AlgorithmAnalyzer`. Supabase history is normalized exactly like the
existing API: `completed_at || created_at` becomes both T9 availability fields.
The API's `source_time` is **not** substituted for those fields.

## Recovery and durability

Startup loads Supabase history and stored T7 signals, reconstructs once, and verifies
the persisted checkpoint's source fingerprint, input digest, weights, counts, and
current streaks at its exact period. It preserves all-time streak maxima and the
hook's first-prediction-per-period audit records (bounded to 500).

After startup the worker fetches only history after its cursor and changed T7 rows
by `stored_at`. It deduplicates unchanged signal values. An unchanged poll does not
repeat prediction or learning. Stats and rolling windows are maintained without
full replay. All adaptive rows remain in server memory for recovery verification
and diagnostics; raw rows are already durable in the existing Supabase tables.

The checkpoint holds the minimum replay-independent state and audit records rather
than another copy of the full historical dataset. Supabase atomically upserts this
single JSON checkpoint after changed results/predictions. A success response is
published only after persistence succeeds. A failed write is retried before any
further inputs are admitted. A restart reconstructs the same deterministic state
from durable source rows and verifies it against the checkpoint.

Existing history/T7 storage remains authoritative. A changed/backfilled T7 signal
for an already-evaluated period, coverage-changing history reset/backfill, or a
checkpoint mismatch stops the adaptive worker with an explicit error. Those events
would cause the browser to retrospectively replay different inputs; silently keeping
the previous incremental result would violate parity. Inspect/reconcile the source
data and checkpoint before restarting. The existing collector continues running.
In-place edits to old history rows are checked during startup recovery; the normal
incremental reader assumes those settled source records remain immutable.

## Endpoint

The response is an in-memory snapshot, never a replay or database query:

- `activePrediction`: period, decision, probabilities, available-signal count, weights
- `signals`: T3/T7/T9 predictions, T3/T9 no-signal reasons, CPL-1 probability/training count
- `latestEvaluation`, `latestEvaluatedPeriod`, `finalDecision`
- `weights`, `dominantSignalIndex`, prediction/hit/miss counts and integer accuracy
- current and longest hit/miss streaks, `last20/50/100/250`, signal agreement
- `predictedAt`, `evaluatedAt`, `checkpointAt`, source `version`, `status`

It contains no full history, raw training rows, credentials, or checkpoint audit map.
Before recovery and on errors it returns HTTP 503 with `success: false`; ready state
returns HTTP 200. The independent official schedule request identifies the active
issue. A schedule error is reported rather than inventing an active issue.

The frontend is not connected yet. Its decision-history table and reset action will
need an explicit contract when the frontend integration is designed.

## Validation (repository root)

```sh
node collector/build-adaptive-algorithms.mjs --check
node --test collector/adaptive-learning.test.js
node collector/validate-adaptive-learning.mjs --limit=300
```

The final command reads existing Supabase data only. Set `--limit` to the desired
number of latest historical rows (a number larger than the dataset selects all).
The engine and original browser calculations receive the **same** selected dataset
and T7 map. Every row checks T3/T7/T9, CPL-1 probabilities, CPL-3 state-dependent
output, adaptive decision, probabilities, exact pre/post-update weights, hit/miss
and aggregate streak/rolling statistics. Active-period samples are also compared.
No floating-point tolerance is used. Any mismatch throws and stops validation.

The unit fixture exercises missing signals, availability-time gates, date changes,
sequence gaps, restart/checkpoint recovery, duplicate settlement, and real T9 votes.

To regenerate after deliberately reviewing a browser algorithm change:

```sh
node collector/build-adaptive-algorithms.mjs
```

The source fingerprint prevents silently mixing checkpoints from different browser
implementations. Regeneration requires the repository's existing TypeScript dev
dependency; deployment does not.
