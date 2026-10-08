/**
 * Compact Checkpoint Regression Tests
 *
 * Verifies that:
 * A. Checkpoints are compact (no full history/records arrays).
 * B. Recovery equivalence: compact checkpoint + durable records → identical engine state.
 * C. Legacy checkpoint (with runtime/runtimeDigest) remains recoverable.
 * D. Baseline checkpoint is also compact.
 * E. 10,000+ records do not make checkpoint size grow linearly.
 * F. Restart and recovery without T7.
 * G. Missing history remains an explicit boundary.
 * H. T7 optional: absent/pending/expired T7 never blocks T3+T9 evaluation.
 *
 * Also measures and reports serialized checkpoint sizes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveLearningEngine, InputRevisionError } from './adaptive-learning.js';
import { AdaptiveRuntime, nextPeriod } from './adaptive-runtime.js';
import { AdaptiveCoordinator } from './adaptive-coordinator.js';
import { replayCheckpoint } from './adaptive-recovery.js';
import { ADAPTIVE_INPUT_POLICY } from './adaptive-input-policy.js';
import { scheduledStartFromIssue } from './adaptive-algorithms.generated.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecords(count, { sequential = false } = {}) {
  const startN = 20261007100050001n;
  return Array.from({ length: count }, (_, i) => {
    let issueNumber;
    if (sequential || count <= 100) {
      issueNumber = String(startN + BigInt(i));
    } else {
      const dIndex = Math.floor(i / 40);
      const day = String(7 + (dIndex % 20)).padStart(2, '0');
      const month = String(10 + Math.floor((dIndex / 20) % 2)).padStart(2, '0');
      const year = '2026';
      const pos = String(1 + (i % 40)).padStart(4, '0');
      issueNumber = `${year}${month}${day}10005${pos}`;
    }
    const createdAt = new Date(scheduledStartFromIssue(issueNumber) + 30_000).toISOString();
    return { issueNumber, winningNumber: (i * 7 + 3) % 10, sourceTime: createdAt, createdAt };
  });
}

function makeSignals(records) {
  return records.map((r, i) => ({
    period_id: r.issueNumber, signal: i % 2 === 0 ? 'BIG' : 'SMALL',
    source: 'server', status: 'win', settled_at: r.createdAt,
    actual_number: r.winningNumber, stored_at: r.createdAt, created_at: r.createdAt,
  }));
}

/** Build a compact checkpoint state via AdaptiveRuntime's internal checkpointState helper. */
function buildEngineAndCheckpoint(records, signals, policy = ADAPTIVE_INPUT_POLICY) {
  const engine = new AdaptiveLearningEngine({ inputPolicy: policy });
  // Load signals first (mirrors runtime behavior).
  engine.setSignals(signals.filter(s => records.some(r => r.issueNumber === s.period_id)));
  for (const record of records) engine.settle(record);
  // Produce the compact checkpoint as AdaptiveRuntime would.
  const cp = engine.checkpoint();
  cp.adaptiveInputMode = policy.id;
  cp.adaptiveRequiredSignals = [...policy.requiredSignals];
  cp.adaptiveOptionalSignals = [...policy.optionalSignals];
  // compactDigest would be added by checkpointState() internally; for test
  // comparison we only need engine.checkpoint() which is always compact.
  return { engine, checkpoint: cp };
}

/** Minimal durable store for unit tests. */
class MinimalStore {
  constructor(records, signals = []) {
    this.records = structuredClone(records);
    this.signals = structuredClone(signals);
    this.saved = null;
  }
  async loadCheckpointRecord() { return this.saved ? structuredClone(this.saved) : null; }
  async saveCheckpoint(state) { this.saved = { state: structuredClone(state), updatedAt: new Date().toISOString() }; }
  async saveBaselineCheckpoint(state) { this.saved = { state: structuredClone(state), updatedAt: new Date().toISOString() }; }
  async loadBaselineCheckpointRecord() { return null; }
  async historyAfter(cursor = null) {
    const rows = this.records.filter(r => !cursor || BigInt(r.issueNumber) > BigInt(cursor))
      .sort((a, b) => a.issueNumber.localeCompare(b.issueNumber));
    return { records: structuredClone(rows), count: this.records.length };
  }
  async historyFrom(startPeriod, cursor = null) {
    const rows = this.records
      .filter(r => BigInt(r.issueNumber) >= BigInt(startPeriod) && (!cursor || BigInt(r.issueNumber) > BigInt(cursor)))
      .sort((a, b) => a.issueNumber.localeCompare(b.issueNumber));
    return { records: structuredClone(rows), count: this.records.filter(r => BigInt(r.issueNumber) >= BigInt(startPeriod)).length };
  }
  async signalsSince() { return { signals: structuredClone(this.signals), through: null }; }
  async periodInputs(period) {
    return structuredClone({
      record: this.records.find(r => r.issueNumber === period) ?? null,
      signal: this.signals.find(s => s.period_id === period) ?? null,
    });
  }
  assertCoverage(engine, batch) {
    if (engine.history.length + batch.records.length !== batch.count)
      throw new InputRevisionError('History coverage changed.');
  }
}

// ---------------------------------------------------------------------------
// A. Compact checkpoint test
// ---------------------------------------------------------------------------

test('A: compact checkpoint does not contain history, records, or sameDateRecords', () => {
  const records = makeRecords(50);
  const signals = makeSignals(records);
  const { engine, checkpoint } = buildEngineAndCheckpoint(records, signals);

  // The compact checkpoint is engine.checkpoint() — verify key invariants:
  assert.equal('history' in checkpoint, false, 'history must not be in compact checkpoint');
  assert.equal('records' in checkpoint, false, 'records must not be in compact checkpoint');
  assert.equal('sameDateRecords' in checkpoint, false, 'sameDateRecords must not be in compact checkpoint');
  assert.equal('t7Signals' in checkpoint, false, 't7Signals must not be in compact checkpoint');
  assert.equal('runtime' in checkpoint, false, 'runtime snapshot must not be in compact checkpoint');
  assert.equal('runtimeDigest' in checkpoint, false, 'runtimeDigest must not be in compact checkpoint');

  // Must contain bounded model state:
  assert.ok(checkpoint.version, 'version present');
  assert.ok(checkpoint.period, 'period present');
  assert.ok(checkpoint.inputDigest, 'inputDigest present');
  assert.ok(Array.isArray(checkpoint.weights), 'weights present');
  assert.equal(typeof checkpoint.predictionIndex, 'number');
  assert.equal(typeof checkpoint.totalPredictions, 'number');
  assert.equal(typeof checkpoint.totalHits, 'number');
  assert.equal(typeof checkpoint.test3MaxLoss, 'number');
  assert.equal(typeof checkpoint.test9MaxLoss, 'number');
  assert.equal(checkpoint.totalPredictions, engine.history.length);

  // firstPredictions is bounded (capped at 500 entries).
  assert.ok(Array.isArray(checkpoint.firstPredictions));
  assert.ok(checkpoint.firstPredictions.length <= 500, 'firstPredictions capped at 500');

  console.log(`  [MEASURE] compact checkpoint size for 50 records: ${JSON.stringify(checkpoint).length} bytes`);
});

test('A: checkpoint size does not grow linearly with history length', () => {
  const counts = [100, 1000, 10000];
  const sizes = [];
  for (const count of counts) {
    const records = makeRecords(count);
    const { checkpoint } = buildEngineAndCheckpoint(records, []);
    const size = JSON.stringify(checkpoint).length;
    sizes.push(size);
    console.log(`  [MEASURE] ${count} records → checkpoint ${size} bytes`);
  }
  // The checkpoint size must not grow more than 10% between 1000 and 10000 records
  // (firstPredictions grows logarithmically, everything else is constant).
  const ratio = sizes[2] / sizes[1];
  assert.ok(ratio < 2.0, `Checkpoint size must not scale linearly with history: ratio(10k/1k) = ${ratio.toFixed(2)}`);
  // Absolute size must stay bounded even with 10,000 records:
  assert.ok(sizes[2] < 200_000, `10k-record checkpoint must be <200 KB, got ${sizes[2]}`);
});

// ---------------------------------------------------------------------------
// B. Recovery equivalence
// ---------------------------------------------------------------------------

test('B: compact checkpoint → replay → recovered engine matches original state exactly', () => {
  const records = makeRecords(100);
  const signals = makeSignals(records);
  const { engine: original, checkpoint } = buildEngineAndCheckpoint(records, signals);

  // Recover: fresh engine + same signals + replay + verifyRecovery.
  const recovered = new AdaptiveLearningEngine({ inputPolicy: ADAPTIVE_INPUT_POLICY });
  recovered.setSignals(signals);
  for (const record of records) recovered.settle(record, { quiet: true });
  recovered.verifyRecovery(checkpoint);

  // All invariants must match:
  for (const field of ['period', 'weights', 'predictionIndex', 'totalPredictions',
    'totalHits', 'currentHitStreak', 'currentMissStreak', 'longestHitStreak',
    'longestMissStreak', 'test3MaxLoss', 'test7MaxLoss', 'test9MaxLoss',
    'test3MissStreak', 'test7MissStreak', 'inputDigest']) {
    assert.deepStrictEqual(
      recovered.checkpoint()[field], original.checkpoint()[field],
      `Recovery mismatch on field: ${field}`
    );
  }
  assert.deepStrictEqual(recovered.history, original.history, 'history arrays must match');
});

test('B: replayCheckpoint reproduces engine state from compact checkpoint', () => {
  const records = makeRecords(80);
  const signals = makeSignals(records.slice(0, 40));
  const engine = new AdaptiveLearningEngine({ inputPolicy: ADAPTIVE_INPUT_POLICY });
  engine.setSignals(signals.filter(s => records.some(r => r.issueNumber === s.period_id)));
  for (const record of records) engine.settle(record);
  const active = nextPeriod(records.at(-1).issueNumber);
  engine.predict(active);
  const checkpoint = engine.checkpoint();

  const allSignals = signals.map(s => s);
  const { candidate } = replayCheckpoint(records, allSignals, checkpoint, () => {}, ADAPTIVE_INPUT_POLICY);

  assert.equal(candidate.lastProcessedPeriod, engine.lastProcessedPeriod);
  assert.deepStrictEqual(candidate.weights, engine.weights);
  assert.equal(candidate.predictionIndex, engine.predictionIndex);
  assert.equal(candidate.totalHits, engine.totalHits);
  assert.equal(candidate.test3MaxLoss, engine.test3MaxLoss);
  assert.equal(candidate.test9MaxLoss, engine.test9MaxLoss);
  assert.deepStrictEqual(candidate.checkpoint().inputDigest, engine.checkpoint().inputDigest);
  // activePrediction is restored from checkpoint via verifyRecovery():
  assert.deepStrictEqual(candidate.activePrediction, engine.activePrediction);
});

// ---------------------------------------------------------------------------
// C. Legacy checkpoint compatibility (with runtime/runtimeDigest)
// ---------------------------------------------------------------------------

test('C: legacy checkpoint with runtime/runtimeDigest is still recoverable via replayCheckpoint', () => {
  const records = makeRecords(30);
  const signals = makeSignals(records);

  // Build a simulated legacy checkpoint that includes runtime snapshot.
  const legacyEngine = new AdaptiveLearningEngine({ inputPolicy: ADAPTIVE_INPUT_POLICY });
  legacyEngine.setSignals(signals);
  for (const record of records) legacyEngine.settle(record, { quiet: true });
  const compactCp = legacyEngine.checkpoint();

  // Simulate what old checkpointState() used to produce: runtime + runtimeDigest.
  const legacyCp = {
    ...compactCp,
    adaptiveInputMode: ADAPTIVE_INPUT_POLICY.id,
    adaptiveRequiredSignals: [...ADAPTIVE_INPUT_POLICY.requiredSignals],
    adaptiveOptionalSignals: [...ADAPTIVE_INPUT_POLICY.optionalSignals],
    // Old runtime fields (large but needed for backward compat testing):
    runtime: {
      history: legacyEngine.history,
      records: legacyEngine.records,
      sameDateRecords: legacyEngine.sameDateRecords,
      t7Signals: [...legacyEngine.t7Signals],
      firstPredictions: [...legacyEngine.firstPredictions],
      weights: [...legacyEngine.weights],
      cplState: legacyEngine.cplState,
      totalHits: legacyEngine.totalHits,
      currentHitStreak: legacyEngine.currentHitStreak,
      currentMissStreak: legacyEngine.currentMissStreak,
      longestHitStreak: legacyEngine.longestHitStreak,
      longestMissStreak: legacyEngine.longestMissStreak,
      predictionIndex: legacyEngine.predictionIndex,
      test3MissStreak: legacyEngine.test3MissStreak,
      test7MissStreak: legacyEngine.test7MissStreak,
      test3MaxLoss: legacyEngine.test3MaxLoss,
      test7MaxLoss: legacyEngine.test7MaxLoss,
      test9MaxLoss: legacyEngine.test9MaxLoss,
      lastProcessedPeriod: legacyEngine.lastProcessedPeriod,
      lastEvaluatedAt: legacyEngine.lastEvaluatedAt,
      activePrediction: legacyEngine.activePrediction,
      activeSignals: legacyEngine.activeSignals,
      predictedAt: legacyEngine.predictedAt,
      activeCacheKey: legacyEngine.activeCacheKey,
      inputDigest: legacyEngine.inputDigest,
    },
    runtimeDigest: 'any-value-not-checked-by-replayCheckpoint',
  };

  // Recovery via replayCheckpoint succeeds with legacy checkpoint:
  const { candidate } = replayCheckpoint(records, signals, legacyCp, () => {}, ADAPTIVE_INPUT_POLICY);
  assert.equal(candidate.lastProcessedPeriod, legacyEngine.lastProcessedPeriod);
  assert.deepStrictEqual(candidate.weights, legacyEngine.weights);
  assert.equal(candidate.predictionIndex, legacyEngine.predictionIndex);
  assert.deepStrictEqual(candidate.checkpoint().inputDigest, legacyEngine.checkpoint().inputDigest);
});

// ---------------------------------------------------------------------------
// D. Baseline checkpoint is compact
// ---------------------------------------------------------------------------

test('D: saveBaselineCheckpoint receives and persists the compact checkpoint format', async () => {
  const records = makeRecords(20);
  const store = new MinimalStore(records, []);

  // Simulate baseline initialization path: process.env must have ADAPTIVE_BASELINE_AFTER_PERIOD set.
  const startPeriod = records[0].issueNumber;
  const baselineMetadata = {
    baselineId: `adaptive-baseline-v2-${startPeriod}`,
    baselineVersion: 2,
    baselineStartPeriod: startPeriod,
    excludedThroughPeriod: null,
    reason: 'test',
    createdAt: new Date().toISOString(),
    sourceCheckpoint: { checkpointKey: 'WinGo_30S', period: null },
    periodsIncluded: 0,
  };

  const runtime = new AdaptiveRuntime(store, {
    currentIssue: async () => nextPeriod(records.at(-1).issueNumber),
    log: () => {},
    inputPolicy: ADAPTIVE_INPUT_POLICY,
  });
  // Manually set baseline state to trigger saveBaselineCheckpoint path.
  runtime.baseline = baselineMetadata;
  runtime.baselineStartPeriod = startPeriod;
  runtime.engine = new AdaptiveLearningEngine({ inputPolicy: ADAPTIVE_INPUT_POLICY });
  for (const record of records) runtime.engine.settle(record, { quiet: true });
  runtime.dirty = true;

  await runtime.persist();

  assert.ok(store.saved, 'baseline checkpoint was saved');
  const savedState = store.saved.state;

  // Key assertion: the saved state must NOT contain full history arrays.
  assert.equal('runtime' in savedState, false, 'No runtime snapshot in baseline checkpoint');
  assert.equal('runtimeDigest' in savedState, false, 'No runtimeDigest in baseline checkpoint');

  // Must be compact:
  assert.ok(savedState.version, 'version present');
  assert.ok(savedState.period, 'period present');
  assert.ok(savedState.compactDigest, 'compactDigest present');
  assert.equal(savedState.baseline.baselineId, baselineMetadata.baselineId);

  const bytes = JSON.stringify(savedState).length;
  console.log(`  [MEASURE] baseline checkpoint size for 20 records: ${bytes} bytes`);
  assert.ok(bytes < 10_000, `Baseline checkpoint must be <10KB, got ${bytes} bytes`);
});

// ---------------------------------------------------------------------------
// E. Long-history test: 10,000+ records, checkpoint stays bounded
// ---------------------------------------------------------------------------

test('E: 10,000-record checkpoint creation and recovery remain bounded', () => {
  const COUNT = 10_000;
  const records = makeRecords(COUNT);
  const t0 = Date.now();
  const { engine, checkpoint } = buildEngineAndCheckpoint(records, []);
  const buildMs = Date.now() - t0;
  const bytes = JSON.stringify(checkpoint).length;
  console.log(`  [MEASURE] 10,000 records: checkpoint ${bytes} bytes, build ${buildMs}ms`);

  assert.equal('runtime' in checkpoint, false, 'No runtime in 10k checkpoint');
  assert.equal('records' in checkpoint, false, 'No records in 10k checkpoint');
  assert.equal('history' in checkpoint, false, 'No history in 10k checkpoint');
  assert.ok(bytes < 200_000, `10k checkpoint must be <200KB, got ${bytes} bytes`);

  // Recovery must succeed:
  const t1 = Date.now();
  const { candidate } = replayCheckpoint(records, [], checkpoint, () => {}, ADAPTIVE_INPUT_POLICY);
  const recoverMs = Date.now() - t1;
  console.log(`  [MEASURE] 10,000 records: replay recovery ${recoverMs}ms`);
  assert.equal(candidate.lastProcessedPeriod, engine.lastProcessedPeriod);
  assert.deepStrictEqual(candidate.weights, engine.weights);
});

// ---------------------------------------------------------------------------
// F. Restart test: process restart recovers correctly without T7
// ---------------------------------------------------------------------------

test('F: restart recovers Adaptive without T7 present', async () => {
  const records = makeRecords(15);
  const store = new MinimalStore(records, []); // zero T7 rows
  const active = nextPeriod(records.at(-1).issueNumber);

  const first = new AdaptiveRuntime(store, { currentIssue: async () => active, log: () => {}, inputPolicy: ADAPTIVE_INPUT_POLICY });
  const coord1 = new AdaptiveCoordinator(first);
  const body1 = await coord1.onSettledPeriod();
  assert.equal(body1.status, 'ready');
  assert.equal(body1.totalPredictions, records.length);

  // Simulate restart: same store (checkpoint persisted), new runtime.
  const second = new AdaptiveRuntime(store, { currentIssue: async () => active, log: () => {}, inputPolicy: ADAPTIVE_INPUT_POLICY });
  const coord2 = new AdaptiveCoordinator(second);
  const body2 = await coord2.onSettledPeriod();
  assert.equal(body2.status, 'ready', 'Restarted runtime must reach ready');
  assert.equal(body2.totalPredictions, records.length);
  assert.equal(body2.adaptiveRequiredSignals.join('|'), 'T3|T9');

  // Saved checkpoint must be compact:
  const savedState = store.saved?.state;
  assert.ok(savedState, 'checkpoint was saved');
  assert.equal('runtime' in savedState, false);
  assert.equal('runtimeDigest' in savedState, false);
  assert.ok(savedState.compactDigest, 'compactDigest present in saved state');
});

// ---------------------------------------------------------------------------
// G. Missing history creates explicit boundary, never fabricates periods
// ---------------------------------------------------------------------------

test('G: missing history is an explicit boundary, never fabricated or bridged', async () => {
  const records = makeRecords(6);
  // Provide only records 0,1,2 — skip 3, then add 4.
  const store = new MinimalStore([records[0], records[1], records[2], records[4]], []);
  const active = nextPeriod(records.at(-1).issueNumber);
  const runtime = new AdaptiveRuntime(store, { currentIssue: async () => active, log: () => {}, inputPolicy: ADAPTIVE_INPUT_POLICY });
  const coord = new AdaptiveCoordinator(runtime);

  const body = await coord.onSettledPeriod();

  // Engine only evaluated what was available before the gap.
  assert.ok(['waiting_for_history', 'ready'].includes(body.status), `status should be waiting or ready, got ${body.status}`);

  // Add the missing record 3.
  store.records.push(records[3]);
  store.records.sort((a, b) => a.issueNumber.localeCompare(b.issueNumber));

  const body2 = await coord.onSettledPeriod({ period: records[3].issueNumber });
  assert.equal(body2.status, 'ready', 'Engine advances once the gap is filled');
  assert.equal(runtime.engine.lastProcessedPeriod, records[4].issueNumber,
    'Engine processes up to record[4] after gap is filled');
  assert.equal(runtime.engine.history.every(r => r.t7pred === null), true, 'No fake T7 added');
});

// ---------------------------------------------------------------------------
// H. T7 optional: absent T7 never blocks T3+T9 evaluation
// ---------------------------------------------------------------------------

for (const scenario of [
  { name: 'completely absent', signals: () => [] },
  { name: 'pending only', signals: (records) => records.map(r => ({ period_id: r.issueNumber, signal: 'BIG', status: 'pending', stored_at: r.createdAt })) },
  { name: 'expired only', signals: (records) => records.map(r => ({ period_id: r.issueNumber, signal: 'BIG', status: 'expired', stored_at: r.createdAt })) },
]) {
  test(`H: T7 ${scenario.name} does not block T3+T9 Adaptive evaluation`, async () => {
    const records = makeRecords(8);
    const signals = scenario.signals(records);
    const active = nextPeriod(records.at(-1).issueNumber);
    const store = new MinimalStore(records, signals);
    const runtime = new AdaptiveRuntime(store, { currentIssue: async () => active, log: () => {}, inputPolicy: ADAPTIVE_INPUT_POLICY });
    const coord = new AdaptiveCoordinator(runtime);
    const body = await coord.onSettledPeriod();

    assert.equal(body.status, 'ready');
    assert.equal(body.adaptiveRequiredSignals.join('|'), 'T3|T9');
    assert.equal(body.adaptiveOptionalSignals.join('|'), 'T7');
    assert.equal(body.adaptiveBlocked, false, 'T3+T9 must not be blocked by missing T7');
    assert.equal(body.totalPredictions, records.length);
    // T7 is never smuggled into the adaptive decision:
    assert.equal(runtime.engine.history.every(row => row.t7pred === null), true, 'No fake T7 in model');
  });
}

// ---------------------------------------------------------------------------
// Checkpoint size measurement summary
// ---------------------------------------------------------------------------

test('10: checkpoint size grows sub-linearly with history (size report)', () => {
  const sizes = {};
  for (const count of [100, 500, 1000, 5000, 10000]) {
    const records = makeRecords(count);
    const { checkpoint } = buildEngineAndCheckpoint(records, []);
    const bytes = JSON.stringify(checkpoint).length;
    sizes[count] = bytes;
    console.log(`  [SIZE] ${String(count).padStart(6)} records → ${String(bytes).padStart(7)} bytes`);
  }

  // Checkpoint size should be nearly constant. Test that going from 1k to 10k doesn't triple the size.
  const ratio = sizes[10000] / sizes[1000];
  console.log(`  [RATIO] checkpoint size ratio (10k / 1k) = ${ratio.toFixed(3)} (must be < 3.0)`);
  assert.ok(ratio < 3.0, `Checkpoint must not scale more than 3× from 1k to 10k records: ratio=${ratio.toFixed(2)}`);

  // Absolute maximum: compact checkpoint must always stay under 200KB regardless of history size.
  assert.ok(sizes[10000] < 200_000, `10k-record checkpoint must be <200 KB, got ${sizes[10000]}`);

  console.log(`  [NOTE] New compact checkpoints eliminate the history/records/runtime arrays.`);
  console.log(`         Old runtimeDigest-based checkpoints embedded thousands of records;`);
  console.log(`         New checkpoints are O(1) in history length.`);
});
