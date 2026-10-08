# Phone-side Adaptive Learning

`server.js` owns one coordinated Node service, listening on port **8080** by default.
It collects official WinGo results and BDGTharu signals, persists them to Supabase,
and exposes `GET /health` and `GET /api/adaptive-learning/current`. A dedicated
worker **thread in this same process** performs CPL-1 fitting and recovery. It has
no independent poller: every Adaptive request comes through the server's queue.

```text
official history ─┐
BDGTharu API ─────┴─> server.js
                       ├─ shared ingestion/evaluation queue
                       ├─ Supabase history + T7 persistence
                       ├─ T3+T9 Adaptive readiness; T7 stored independently
                       ├─ Adaptive worker thread + atomic checkpoints
                       └─ HTTP :8080

adaptive.random9111.sbs -> separate Android cloudflared -> 127.0.0.1:8080
```

## Setup on Termux

1. Apply `collector/adaptive-learning-schema.sql` once in the Supabase SQL editor.
2. Use the collector's existing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
3. Run `PORT=8080 npm start` from `collector/`. Run one coordinated service per database.

The generated algorithm file ships with the collector. TypeScript, React, and the
frontend source tree are **not** required on the phone. Node 18+ is supported.
The schema creates only `wingo_adaptive_checkpoints`; it does not alter the existing
history or T7 tables. Checkpoints are service-role-only. The retired checkpoint stays
under `game_code = WinGo_30S`; the active clean baseline is stored separately under
`game_code = WinGo_30S:baseline` in the same table, so the old recovery remains
available as audit evidence.

## Exact algorithm provenance

`build-adaptive-algorithms.mjs` uses TypeScript's parser to extract:

- T3: `TEST3_SEQUENCE`, `test3Prediction`, and `computeTest3` in
  `src/experimental/test3Sequence.ts`, also used by `AlgorithmAnalyzer`.
- T7: `computeTest7` and its pure helpers in
  `src/components/history/AdditionalSignalsPanel.tsx`.
- T9: `periodicLogisticAlgorithm.ts` and the original CPL-3 helpers/loop in
  `cpl3LossStreakBreaker.ts`, using `context-8-cap-3`.
- Adaptive: the vote helpers and verbatim chronological prediction/update loop
  in `src/hooks/useAdaptiveLearning.ts`.

The generator also includes the full browser replay and pure input joins from
`src/experimental/adaptiveSignalInputs.ts` as the full-replay reference for parity
tests. These joins no longer depend on retired analyzer memos. It changes
the lifetime of CPL-3 state, not its loop's decision/settlement statements. The
adaptive update loop runs once for each new settled row. T3 uses the exact sequence
`S B S B S S B S B B S B S S`, indexed by `predictionIndex % 14`. Every settled
round, including the first, advances it once. Active predictions and duplicate
settlements never advance it; dates and issue-number gaps never reset it.
CPL-1 fits the original model for each new target (120 iterations,
same features, regularization and eligible training rows); it does not recompute
predictions for old targets during normal polling.

T3 always has a prediction, starting at Small with zero settled rounds. Absent
stored T7 signals and CPL-1's minimum-history gate retain their no-signal outcomes.
The browser's adaptive tie/no-vote
decision and initial equal weights are also preserved by the extracted source.
Adaptive votes only on its required signals T3 and T9. T7 is stored, scored, and monitored independently and is never an Adaptive feature.

Historical CPL-1 uses ascending training order; active CPL-1 uses descending order,
matching `AlgorithmAnalyzer`. Supabase history is normalized exactly like the
existing API: `completed_at || created_at` becomes both T9 availability fields.
The API's `source_time` is **not** substituted for those fields.

## Recovery and durability

### Clean T3+T9 baseline

When the active baseline row does not yet exist, startup does not resume the old
checkpoint recovery. It scans durable history strictly after
`20261002100050850` (the historical missing-T7 gap) and selects the first period
after it. No T7 row is required: the new `adaptive-t3-t9-v1` model replays the
prefix from that start period using only T3 and T9. In the current durable dataset
the detected start is `20261002100052078`, and evaluation now continues straight
through `20261002100052220` even though that period has no finalized T7 row.

The new checkpoint state records `baselineId`, `baselineVersion`,
`baselineStartPeriod`, `excludedThroughPeriod`, `reason`, `createdAt`,
`sourceCheckpoint`, `periodsIncluded`, `adaptiveInputMode`,
`adaptiveRequiredSignals`, and `adaptiveOptionalSignals`. The old `WinGo_30S`
checkpoint is never deleted or overwritten. Baseline evaluation starts with a fresh
Adaptive engine at the selected period; no result before that start, including the
permanently missing period, is evaluated by the new baseline.

If there is no durable history after the boundary yet, the service waits for
history and keeps collecting. Once the baseline exists, T7 is optional: a missing,
pending, expired, delayed, or historically absent T7 row never holds the cursor.
Only a missing actual History outcome (a gap in settled results) pauses evaluation
as `waiting_for_history`. A duplicate identical T7 signal is harmless; a conflicting
finalized T7 value is a T7 concern and cannot alter Adaptive. T7 continues to be
captured (BDGTharu prediction → `wingo_t7_signals` → Supabase) and scored
independently.

Startup captures the checkpoint and a verified durable source boundary. New checkpoints contain
a resumable `runtime` snapshot and its SHA-256 digest inside the existing JSON
`state` column; no SQL schema change is needed. This includes the engine's records,
evaluations, CPL state, and signal/audit maps. The checkpoint is larger than the
legacy format so restarts can restore the exact state without fitting all historical
models again. Startup checks the runtime digest and source fingerprint, verifies
durable history and T7 against the chained input digest, and checks checkpoint
weights, counts, streaks, sequence index and independent maxima. Legacy checkpoints
still use their existing exact replay verification, then gain a resumable snapshot.
First-prediction audit records remain bounded to 500 and survive recovery.

The coordinator serializes each entire collector batch and each normal Adaptive request.
The collector never mutates engine internals. `onSettledPeriod({ periods })` is the
handoff: it deduplicates concurrent requests and reads durable inputs in the worker.
The HTTP server remains responsive while the worker computes. Upstream fetches
remain outside the queue; their durable writes go inside it. Recovery uses the
three-phase protocol below so ingestion can continue during CPU-heavy replay.

After startup only history after the evaluated cursor and changed T7 rows by
`stored_at` are fetched. Exact reads cover pending periods and IDs touched by the
collector, including revisions behind the timestamp cursor. Each new evaluation
requires an exact durable historical result. T7 is optional and independent, so a
missing, pending, expired, or delayed signal never enters the Adaptive input digest,
boundary, or cursor. BDGTharu rows keep their existing `win`/`loss`, `settled_at`,
and matching `actual_number` scoring rules for T7's own metrics. Legacy NULL-metadata
signals retain their exact historical meaning. The readiness gate does not alter any
prediction algorithm.

Missing/pending T7 never blocks Adaptive: T3 and T9 alone are sufficient, so no row
is withheld for T7 and no active prediction waits on it. Only a missing live actual
outcome produces `waiting_for_history`, including across midnight. `waiting_for_t7`
remains a reportable status for separate T7 workflows, never an Adaptive blocking
reason. Existing sequence/date
gaps in the initial historical dataset remain part of that dataset's replay.
Exact input digests are checked before evaluation and again before checkpointing.
An unchanged poll does not repeat prediction or learning. The original historical
NO_SIGNAL behavior remains available for validated legacy checkpoint prefixes.
Stats and rolling windows are maintained without full replay. All adaptive rows
remain in server memory for recovery verification and diagnostics; raw rows are
already durable in the existing Supabase tables.

Supabase atomically upserts one JSON checkpoint after each new settlement and
changed active prediction. A ready response is published only after persistence.
Failed/ambiguous checkpoint writes retain the computed row and retry verification
and persistence before further learning; the period is not evaluated twice. Failed
collector batches are retained and retried under the same queue even if the
upstream becomes unavailable. They hold Adaptive behind an ingestion retry barrier,
while the source pollers continue at their existing intervals (T7: 5s, history: configured
30s default). Collector history insertion stops at a failed row to preserve order.

The known previous pair-algorithm source fingerprint is explicitly migrated once:
startup verifies checkpoint period/count coverage and reconstructs the new T3
sequence, weights, and statistics from chronological durable history. Previous
first-prediction audit records remain intact; obsolete active predictions are
replaced. The new checkpoint is persisted before publishing a ready response.
Unknown versions and corrupt new-version checkpoints still fail recovery.

### Single-flight recovery state machine

`adaptiveState` is explicitly one of `normal`, `recovering`, `ready`,
`waiting_for_history`, or `recovery_failed`. (`waiting_for_t7` is never an Adaptive
blocking state; it is reserved for separate T7 workflows.) The API retains `recovery_required` for
integrity failures and separately exposes this state, recovery ID, original
high-water mark, observed high-water mark, and earliest affected evaluated period.
It also exposes `replayCursor`, `replayProcessed`, `replayTotal`,
`replayHighWater`, and `recoveryPhase`.

`t7PollingActive` is the in-flight HTTP request flag and is normally `false`
between five-second polls. `t7PollingRunning` reports whether the continuous
polling loop is alive. While waiting for an exact period, the collector keeps
polling the existing BDGTharu endpoint and records `pendingT7Observation` with
whether that exact period appeared in the latest upstream response. The endpoint
currently exposes only a recent bounded history window and does not honor tested
period/page/offset selectors, so a period outside that window cannot be invented
or reconstructed from official draw data.

1. **Capture under the collector write lock.** Read durable history and exact T7
   IDs twice, confirm coverage and identical canonical digests, then deep-copy the
   result. This blocks local writes only during capture. If another writer changes
   the dataset during capture, no replay starts on that mixed boundary. New data
   beyond this boundary is deliberately deferred, not included in a running replay.
2. **Replay outside the write lock.** One recovery session and one recovery promise
   own a private candidate. The collector continues committing entire batches;
   notifications coalesce into the existing flight. The worker does not query
   changing durable inputs during replay. A valid resumable checkpoint is reused
   when it precedes every potentially affected input. An evaluated T7 revision
   identifies the earliest affected period; the table currently retains only one
   checkpoint, so when that checkpoint already includes the revision, recovery
   uses deterministic full chronological replay. Valid legacy checkpoints retain
   their existing exact verification. A stale legacy checkpoint falls back to full
   finalized replay instead of repeatedly failing a timestamp-only late-row proof.
3. **Verify, checkpoint, promote under the write lock.** Check the snapshot digest
   and reconstructed input chain. Persist one recovery checkpoint, then replace
   the active engine atomically and transition to `ready` (logging
   `status=promoted`). Only afterward process
   newly collected periods. The previous active engine/checkpoint stays published
   as the last evaluated boundary until persistence is acknowledged. If a write
   acknowledgement is lost, read back the identical runtime digest before retrying,
   avoiding a second durable recovery write. Neither replay nor promotion is concurrent.

Replay uses actual History only, so it never waits for T7. It stops at the first
missing actual outcome and reports `waiting_for_history`. If this predecessor is
within the old evaluated checkpoint boundary, keep the old checkpoint and the
partially replayed candidate. Later history backfill resumes that **same recovery
ID** at the missing row; previously replayed rows are not repeated.
Under the write lock, refresh only its unevaluated signals and record the newer
observed high-water mark. The original recovery history/high-water mark remains
fixed. These readiness refreshes use incremental history after that mark, changed
T7 rows and exact pending IDs; they do not refetch full history every five seconds.
Once its finalized prefix can be safely checkpointed, promote it and catch
up to the newer boundary. No collector notification restarts an in-flight replay.

`InputRevisionError` remains the immutable-input guard; no revised input is accepted
by an already evaluated engine without recovery. Unknown/corrupt checkpoints and
verified history mutations latch `recovery_failed`/`recovery_required` and preserve
the durable checkpoint. Polling and new T7 rows do not restart terminal failure.
Transient capture or persistence failures retry safely, retaining any prepared
candidate rather than replaying it again. No checkpoints or source rows are deleted.
In-place edits to old history rows are checked during startup recovery; the normal
incremental reader assumes those settled source records remain immutable.

## Endpoint

The response is an in-memory snapshot, never a replay or database query:

- `activePrediction`: period, decision, probabilities, available-signal count, weights
- `signals`: T3/T7/T9 predictions, T3 sequence position reason, T9 no-signal reason, CPL-1 probability/training count
- `latestEvaluation`, `latestEvaluatedPeriod`, `finalDecision`
- `weights`, `dominantSignalIndex`, prediction/hit/miss counts and integer accuracy
- current and longest hit/miss streaks, `last20/50/100/250`, signal agreement
- `test3MaxLoss`, `test7MaxLoss`, `test9MaxLoss`: independent longest consecutive
  prediction misses. T3 spans sequence wraps/dates/gaps; T7 excludes missing
  signals as before; T9 preserves CPL-3's gap/date/no-signal streak breaks.
  None of these uses the ensemble's `longestMissStreak`.
- `predictedAt`, `evaluatedAt`, `checkpointAt`, source `version`, `status`

It contains no full history, raw training rows, credentials, or checkpoint audit map.
Responses distinguish:

- HTTP 200: `{ "success": true, "status": "ready", "adaptiveRequiredSignals": ["T3","T9"], "adaptiveOptionalSignals": ["T7"], "t7AvailableForAdaptive": false, "adaptiveBlocked": false, ... }`
- HTTP 200: `waiting_for_history` (a live actual outcome has not been persisted; Adaptive uses T3+T9)
- HTTP 200: `{ "success": false, "status": "waiting_for_t7", "pendingPeriod": "...", ... }` remains available for separate T7 workflows only; Adaptive never produces it as a blocking reason
- HTTP 503: `{ "success": false, "status": "recovery_required", ... }`
- HTTP 503: `recovering` (one active recovery; evaluations/checkpoint advancement held)
- HTTP 503: `initializing`/`error` for startup or a transient service failure

The official schedule still identifies the active issue. Its exact T7 signal must
exist before invoking the original active prediction calculation. A schedule error
is reported rather than inventing an active issue. `/health` always responds HTTP
200 and includes collector/database/polling status, last collected/evaluated periods,
Adaptive state/status, recovery ID/boundaries/earliest affected period, pending
period, checkpoint status/time, `waiting_for_history`, and `waiting_for_t7` (separate T7 workflows).

## Android startup and diagnostics

From the repository root, install collector dependencies once and start the service:

```sh
npm ci --prefix collector
PORT=8080 npm --prefix collector start
```

`npm --prefix collector start` runs in `collector/` and loads its existing `.env`.
In another Termux session, start the existing remotely managed tunnel with its
existing token held in the environment:

```sh
cloudflared tunnel --no-autoupdate run --token "$CLOUDFLARE_TUNNEL_TOKEN"
```

The tunnel's origin must be `http://127.0.0.1:8080`, independent of the phone's
Wi-Fi address. Tunnel credentials/configuration are not part of the Node service.
No Windows replica is required. The two processes can restart independently.

```sh
curl -i --max-time 10 http://127.0.0.1:8080/health
curl -i --max-time 10 http://127.0.0.1:8080/api/adaptive-learning/current
curl -i --max-time 20 https://adaptive.random9111.sbs/api/adaptive-learning/current
```

Read `status` and `success` as well as the HTTP status: a waiting response is HTTP
200 and explicitly reports unavailable input instead of a generic 503 outage.

`AdaptiveLearningPage` shares one compact server subscription between
`AdaptiveLearningPanel` and the bottom `MAX LOSS` section. That section displays
only TEST 3, TEST 7 and TEST 9 maxima. The page performs no history requests or
browser-side algorithm replay.

## Validation (repository root)

```sh
node collector/build-adaptive-algorithms.mjs --check
npm run test:adaptive
npm run test:t9
npm run build
npx tsc --noEmit -p tsconfig.server.json
npm run lint
node collector/validate-adaptive-learning.mjs --limit=300
```

`test:adaptive` includes deterministic replay/max-loss tests, frontend contract and
compact polling tests, MAX LOSS rendering checks, coordinator race/readiness/failure
tests (including 60 historical T7 arrivals during a paused replay, collector
progress, single-flight recovery, one recovery checkpoint, and deferred catch-up),
and a real unified server process restart test. Local fixtures check HTTP
200 and durable checkpoint recovery, and contact no live collector upstreams.

The final command requires Supabase credentials and reads existing data only. Set `--limit` to the desired
number of latest historical rows (a number larger than the dataset selects all).
The engine and original browser calculations receive the **same** selected dataset
and T7 map. Every row checks T3/T7/T9, CPL-1 probabilities, CPL-3 state-dependent
output, adaptive decision, probabilities, exact pre/post-update weights, hit/miss
and aggregate streak/rolling statistics. Active-period samples are also compared.
No floating-point tolerance is used. Any mismatch throws and stops validation.
Supabase authentication failures (for example `JWT issued at future`) must be
resolved in the deployment environment before live-data parity can be established.

The unit fixture exercises missing signals, availability-time gates, date changes,
sequence gaps, restart/checkpoint recovery, duplicate settlement, and real T9 votes.

The normal frontend build regenerates the shipped phone algorithms. To regenerate
them separately after reviewing an algorithm source change:

```sh
npm run build:adaptive
```

The source fingerprint prevents silently mixing checkpoints from different browser
implementations. Regeneration requires the repository's existing TypeScript dev
dependency; deployment does not.
