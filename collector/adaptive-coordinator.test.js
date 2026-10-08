import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveCoordinator } from './adaptive-coordinator.js';
import { AdaptiveRuntime, nextPeriod } from './adaptive-runtime.js';
import { AdaptiveLearningEngine } from './adaptive-learning.js';
import { AdaptiveLearningStore } from './adaptive-learning-store.js';
import { scheduledStartFromIssue } from './adaptive-algorithms.generated.js';
import { validateDataset } from './validate-adaptive-learning.mjs';
import { ADAPTIVE_INPUT_POLICY } from './adaptive-input-policy.js';

// Adaptive operates in T3+T9 mode: T7 is optional and independent.
const t3t9 = (records, signals) => validateDataset(records, signals, { inputPolicy: ADAPTIVE_INPUT_POLICY });

function fixture(length = 4) {
  const records = Array.from({ length }, (_, i) => {
    const issueNumber = String(20261007100050001n + BigInt(i));
    const createdAt = new Date(scheduledStartFromIssue(issueNumber) + 30_000).toISOString();
    return { issueNumber, winningNumber: (i * 7 + 3) % 10, sourceTime: createdAt, createdAt };
  });
  const signals = records.map((record, i) => ({
    period_id: record.issueNumber, signal: i % 2 ? 'SMALL' : 'BIG', source: 'server',
    status: 'win', settled_at: record.createdAt, actual_number: record.winningNumber,
    stored_at: record.createdAt, created_at: record.createdAt,
  }));
  return { records, signals };
}

class MemoryStore {
  constructor(records = [], signals = []) {
    this.records = structuredClone(records);
    this.signals = structuredClone(signals);
    this.saved = null;
    this.writes = [];
    this.reads = [];
    this.failWrites = 0;
    this.failVerification = false;
  }
  async loadCheckpointRecord() { return structuredClone(this.saved); }
  async saveCheckpoint(state) {
    if (this.failWrites-- > 0) throw new Error('Supabase temporarily unavailable');
    this.saved = { state: structuredClone(state), updatedAt: new Date().toISOString() };
    this.writes.push(structuredClone(state));
  }
  async historyAfter(cursor = null) {
    this.reads.push(cursor);
    return { records: structuredClone(this.records.filter((r) => !cursor || BigInt(r.issueNumber) > BigInt(cursor))
      .sort((a, b) => a.issueNumber.localeCompare(b.issueNumber))), count: this.records.length };
  }
  async signalsSince(since, periods) {
    return { signals: structuredClone(this.signals), through: '2026-10-07T00:00:00Z', since, periods };
  }
  async periodInputs(period) {
    if (this.failVerification) { this.failVerification = false; throw new Error('Verification network interrupted'); }
    return structuredClone({ record: this.records.find((r) => r.issueNumber === period) ?? null,
      signal: this.signals.find((s) => s.period_id === period) ?? null });
  }
  assertCoverage(engine, batch) { AdaptiveLearningStore.prototype.assertCoverage(engine, batch); }
}

class BaselineMemoryStore extends MemoryStore {
  constructor(records = [], signals = [], legacyCheckpoint = null) {
    super(records, signals);
    this.legacyCheckpoint = legacyCheckpoint;
    this.baseline = null;
  }
  async loadCheckpointRecord() { return structuredClone(this.legacyCheckpoint); }
  async loadBaselineCheckpointRecord() { return structuredClone(this.baseline); }
  async saveBaselineCheckpoint(state) {
    this.baseline = { state: structuredClone(state), updatedAt: new Date().toISOString() };
    this.writes.push(structuredClone(state));
  }
  async historyFrom(startPeriod, cursor = null) {
    const records = this.records.filter((record) => BigInt(record.issueNumber) >= BigInt(startPeriod)
      && (!cursor || BigInt(record.issueNumber) > BigInt(cursor)))
      .sort((a, b) => a.issueNumber.localeCompare(b.issueNumber));
    return { records: structuredClone(records), count: this.records.filter((record) => BigInt(record.issueNumber) >= BigInt(startPeriod)).length };
  }
}

function jsonb(value) {
  if (Array.isArray(value)) return value.map(jsonb);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().reverse().map((key) => [key, jsonb(value[key])]));
  return value;
}

function session(store, activePeriod) {
  const logs = [];
  const runtime = new AdaptiveRuntime(store, { currentIssue: async () => activePeriod, log: (line) => logs.push(line) });
  const coordinator = new AdaptiveCoordinator(runtime);
  return { runtime, coordinator, logs };
}

function activeSignal(store, period) {
  store.signals.push({ period_id: period, signal: 'BIG', status: 'pending', stored_at: '2026-10-07T00:00:00Z' });
}

function strictSignal(record, signal = record.winningNumber >= 5 ? 'BIG' : 'SMALL') {
  return { period_id: record.issueNumber, signal, source: 'server', status: 'win',
    actual_number: record.winningNumber, settled_at: record.createdAt, stored_at: record.createdAt };
}

test('A: history → final T7 → one evaluation → atomic checkpoint → ready API snapshot', async () => {
  const { records, signals } = fixture(1);
  const active = nextPeriod(records[0].issueNumber);
  const store = new MemoryStore(records, signals);
  activeSignal(store, active);
  const { runtime, coordinator, logs } = session(store, active);
  const body = await coordinator.onSettledPeriod({ period: records[0].issueNumber });
  assert.equal(body.status, 'ready');
  assert.equal(body.totalPredictions, 1);
  assert.equal(store.saved.state.period, records[0].issueNumber);
  assert.equal(store.saved.state.inputDigest, runtime.engine.inputDigest);
  assert.ok(logs.findIndex((s) => s.includes('status=saved') && s.includes(records[0].issueNumber))
    < logs.findIndex((s) => s.includes('status=evaluated')));
});

test('B/I: missing or pending T7 never holds the tail; Adaptive progresses on T3+T9 alone', async () => {
  const { records, signals } = fixture(3);
  const active = nextPeriod(records.at(-1).issueNumber);
  const store = new MemoryStore([records[0]], []);
  const { runtime, coordinator } = session(store, active);
  const first = await coordinator.onSettledPeriod();
  assert.equal(first.status, 'ready', 'Missing T7 must not block Adaptive');
  assert.equal(first.adaptiveRequiredSignals.join('|'), 'T3|T9');
  assert.equal(first.adaptiveOptionalSignals.join('|'), 'T7');
  assert.equal(first.t7AvailableForAdaptive, false);
  assert.equal(first.adaptiveBlocked, false, 'T3+T9 are sufficient');
  assert.equal(runtime.engine.predictionIndex, 1);
  assert.equal(runtime.engine.history[0].t7pred, null, 'No fake T7 value may be invented');
  await coordinator.ingest(async () => {
    store.records.push(...records.slice(1));
    store.signals.push({ ...signals[0], status: 'pending' }, ...signals.slice(1));
  }, 't7');
  const pending = await coordinator.onSettledPeriod();
  assert.equal(pending.status, 'ready', 'A pending T7 row is still optional');
  assert.equal(pending.totalPredictions, 3);
  assert.equal(store.records.length, 3, 'Collector keeps persisting while Adaptive advances');
  assert.equal(runtime.engine.history.every((row) => row.t7pred === null), true, 'T7 stays out of the model');
});

test('C: a T7 response batch is serialized and never becomes an Adaptive feature', async () => {
  const { records, signals } = fixture(1);
  const active = nextPeriod(records[0].issueNumber);
  const store = new MemoryStore(records);
  activeSignal(store, active);
  const { runtime, coordinator } = session(store, active);
  let release;
  const latch = new Promise((resolve) => { release = resolve; });
  const ingest = coordinator.ingest(async () => {
    store.signals.push({ ...signals[0], signal: 'SMALL', status: 'pending' });
    await latch;
    store.signals[1] = signals[0];
  }, 't7');
  const evaluation = coordinator.onSettledPeriod();
  await Promise.resolve();
  assert.equal(runtime.engine, null, 'Evaluation cannot interleave with batch writes');
  release();
  await ingest;
  await evaluation;
  assert.equal(runtime.engine.history[0].t7pred, null, 'T7 is not an Adaptive feature');
  assert.equal(runtime.engine.predictionIndex, 1);
});

test('D: post-checkpoint T7 revisions never block or alter Adaptive', async () => {
  const { records, signals } = fixture(3);
  const active = nextPeriod(records.at(-1).issueNumber);
  const store = new MemoryStore(records.slice(0, 2), signals.slice(0, 2));
  activeSignal(store, active);
  const { runtime, coordinator, logs } = session(store, active);
  await coordinator.onSettledPeriod();
  const evaluated = structuredClone(runtime.engine.history);
  await coordinator.ingest(async () => {
    store.signals[0] = { ...signals[0], signal: 'SMALL' }; // revision of an evaluated T7 row
    store.records.push(records[2]); store.signals.push(signals[2]);
  });
  const advanced = await coordinator.onSettledPeriod();
  assert.equal(advanced.status, 'ready', 'A T7 revision is not an Adaptive input');
  assert.equal(advanced.totalPredictions, 3);
  assert.deepEqual(runtime.engine.history.slice(0, 2), evaluated, 'Evaluated rows are immutable');
  assert.equal(runtime.engine.history[2].t7pred, null);
  assert.equal(logs.some((s) => s.includes('revision_detected')), false);
});

test('E: concurrent/duplicate handoffs share a flight and never advance weights/index twice', async () => {
  const { records, signals } = fixture(2);
  const active = nextPeriod(records.at(-1).issueNumber);
  const store = new MemoryStore(records, signals); activeSignal(store, active);
  const { runtime, coordinator, logs } = session(store, active);
  const requests = Array.from({ length: 20 }, () => coordinator.onSettledPeriod());
  assert.ok(requests.every((p) => p === requests[0]));
  await Promise.all(requests);
  const checkpoint = structuredClone(store.saved.state);
  await coordinator.onSettledPeriod();
  assert.equal(runtime.engine.predictionIndex, 2);
  assert.deepEqual(store.saved.state, checkpoint);
  assert.equal(logs.filter((s) => s.includes('status=evaluated')).length, 2);
});

test('F: P1, P3, P2 arrivals evaluate P1, P2, P3 without skipping absent history', async () => {
  const { records, signals } = fixture(3);
  const active = nextPeriod(records.at(-1).issueNumber);
  const store = new MemoryStore([records[0]], [signals[0]]); activeSignal(store, active);
  const { runtime, coordinator } = session(store, active);
  await coordinator.onSettledPeriod();
  await coordinator.ingest(async () => { store.records.push(records[2]); store.signals.push(signals[2]); });
  assert.equal((await coordinator.onSettledPeriod()).status, 'waiting_for_history');
  assert.equal(runtime.engine.predictionIndex, 1);
  await coordinator.ingest(async () => { store.records.push(records[1]); store.signals.push(signals[1]); });
  await coordinator.onSettledPeriod();
  assert.deepEqual(runtime.engine.history.map((r) => r.period), records.map((r) => r.issueNumber));
});

test('G: verified runtime checkpoint resumes without historical settlement/model fitting', async () => {
  const { records, signals } = fixture(75);
  const active = nextPeriod(records.at(-1).issueNumber);
  const store = new MemoryStore(records.slice(0, 74), signals); activeSignal(store, active);
  const original = session(store, active);
  await original.coordinator.onSettledPeriod();
  const persisted = structuredClone(store.saved.state);
  const writes = store.writes.length;
  const restarted = session(store, active);
  await restarted.coordinator.onSettledPeriod();
  assert.deepEqual(restarted.runtime.engine.checkpoint(), original.runtime.engine.checkpoint());
  assert.equal(store.writes.length, writes, 'An unchanged restart must not rewrite its checkpoint');
  assert.equal(restarted.logs.filter((s) => s.includes('newly processed')).length, 0);
  store.records.push(records[74]);
  await restarted.coordinator.onSettledPeriod();
  assert.equal(store.saved.state.predictionIndex, 75);
  assert.notEqual(store.saved.state.inputDigest, persisted.inputDigest);
  assert.ok(store.reads.slice(2).includes(records[73].issueNumber), 'Normal reads use an incremental cursor');
});

test('H: failed and ambiguous checkpoint writes retry before new learning; no duplicate evaluation', async () => {
  const { records, signals } = fixture(2);
  const active = nextPeriod(records.at(-1).issueNumber);
  const store = new MemoryStore([records[0]], signals); activeSignal(store, active);
  const { runtime, coordinator } = session(store, active);
  await coordinator.onSettledPeriod();
  store.records.push(records[1]);
  store.failWrites = 1;
  assert.equal((await coordinator.onSettledPeriod()).checkpointStatus, 'pending_retry');
  assert.equal(runtime.engine.predictionIndex, 2);
  assert.equal(store.saved.state.predictionIndex, 1);
  await coordinator.onSettledPeriod();
  assert.equal(runtime.engine.predictionIndex, 2);
  assert.equal(store.saved.state.predictionIndex, 2);
  const save = store.saveCheckpoint.bind(store);
  let lostAcknowledgement = true;
  store.saveCheckpoint = async (state) => {
    await save(state);
    if (lostAcknowledgement) { lostAcknowledgement = false; throw new Error('Acknowledgement lost after commit'); }
  };
  runtime.engine.activeCacheKey = null;
  assert.equal((await coordinator.onSettledPeriod()).status, 'error');
  const durable = structuredClone(store.saved.state);
  await coordinator.onSettledPeriod();
  assert.deepEqual(store.saved.state, durable);
});

test('a failed post-evaluation input read retains the computed row and retries verification, not learning', async () => {
  const { records, signals } = fixture(2);
  const active = nextPeriod(records.at(-1).issueNumber);
  const store = new MemoryStore([records[0]], signals); activeSignal(store, active);
  const { runtime, coordinator } = session(store, active);
  await coordinator.onSettledPeriod();
  store.records.push(records[1]);
  const settle = runtime.engine.settle.bind(runtime.engine);
  let calls = 0;
  runtime.engine.settle = (record) => { calls++; const result = settle(record); store.failVerification = true; return result; };
  assert.equal((await coordinator.onSettledPeriod()).status, 'error');
  assert.equal(runtime.engine.predictionIndex, 2);
  await coordinator.onSettledPeriod();
  assert.equal(calls, 1);
  assert.equal(store.saved.state.predictionIndex, 2);
});

test('failed collector writes block Adaptive until that same source retries, without blocking ingestion', async () => {
  const store = new MemoryStore();
  const { coordinator } = session(store, '20261007100050001');
  let unavailable = true;
  await assert.rejects(coordinator.ingest(async () => { if (unavailable) throw new Error('write failed'); }, 't7'));
  await coordinator.ingest(async () => {}, 'history');
  assert.equal((await coordinator.onSettledPeriod()).checkpointStatus, 'ingestion_pending_retry');
  unavailable = false;
  await coordinator.ingest(async () => {}, 't7');
  assert.equal((await coordinator.onSettledPeriod()).status, 'ready');
});

test('a captured failed collector batch retries even when the upstream is unavailable', async () => {
  const { records, signals } = fixture(1);
  const active = nextPeriod(records[0].issueNumber);
  const store = new MemoryStore(); activeSignal(store, active);
  const { coordinator } = session(store, active);
  let attempts = 0;
  await assert.rejects(coordinator.ingest(async () => {
    if (++attempts === 1) throw new Error('Supabase temporarily failed');
    store.records.push(records[0]); store.signals.push(signals[0]);
  }, 'history'));
  assert.equal((await coordinator.onSettledPeriod()).totalPredictions, 1);
  assert.equal(attempts, 2);
  assert.equal(store.records.length, 1);
});

test('restart ignores durable T7 revisions and keeps every T3+T9 row exact', async () => {
  const { records, signals } = fixture(4);
  const active = nextPeriod(records.at(-1).issueNumber);
  const store = new MemoryStore(records, signals); activeSignal(store, active);
  const original = session(store, active); await original.coordinator.onSettledPeriod();
  const audit = structuredClone(store.saved.state.firstPredictions);
  store.signals[0].signal = 'SMALL';
  const restarted = session(store, active);
  assert.equal((await restarted.coordinator.onSettledPeriod()).status, 'ready');
  const { engine: reference } = t3t9(records, store.signals);
  assert.deepEqual(restarted.runtime.engine.history, reference.history);
  assert.deepEqual(store.saved.state.firstPredictions, audit);
});

test('PostgreSQL JSONB object-key reordering preserves runtime integrity, restart and revision recovery', async () => {
  const { records, signals } = fixture(72);
  const active = nextPeriod(records.at(-1).issueNumber);
  const store = new MemoryStore(records, signals); activeSignal(store, active);
  const original = session(store, active); await original.coordinator.onSettledPeriod();
  store.saved = jsonb(store.saved);
  const restarted = session(store, active);
  assert.equal((await restarted.coordinator.onSettledPeriod()).status, 'ready');
  assert.deepEqual(restarted.runtime.engine.current(), original.runtime.engine.current());
  store.signals[0].signal = 'SMALL';
  assert.equal((await restarted.coordinator.onSettledPeriod()).status, 'ready', 'T7 revisions never force Adaptive recovery');
  const { engine: reference } = t3t9(records, store.signals);
  assert.deepEqual(restarted.runtime.engine.history, reference.history);
});

test('unknown/corrupt checkpoints and history mutation stay recovery_required and preserve durable state', async () => {
  const { records, signals } = fixture(2);
  const active = nextPeriod(records.at(-1).issueNumber);
  for (const mutate of [
    (store) => { store.saved.state.runtime.weights[0] = 999; },
    (store) => { store.saved.state.version = 'unknown'; },
    (store) => { store.records[0].winningNumber = 9; },
  ]) {
    const store = new MemoryStore(records, signals); activeSignal(store, active);
    await session(store, active).coordinator.onSettledPeriod();
    mutate(store);
    const saved = structuredClone(store.saved);
    const restarted = session(store, active);
    assert.equal((await restarted.coordinator.onSettledPeriod()).status, 'recovery_required');
    assert.equal((await restarted.coordinator.onSettledPeriod()).status, 'recovery_required');
    assert.deepEqual(store.saved, saved);
  }
});

test('J: coordinated historical replay preserves every exact T3/T7/T9 row, weight, statistic and maximum', async () => {
  const { records, signals } = fixture(85);
  const active = nextPeriod(records.at(-1).issueNumber);
  const store = new MemoryStore(records, signals); activeSignal(store, active);
  const { runtime, coordinator } = session(store, active);
  await coordinator.onSettledPeriod();
  const { engine: reference } = t3t9(records, store.signals);
  assert.deepEqual(runtime.engine.history, reference.history);
  assert.equal(runtime.engine.history.every((row) => row.t7pred === null), true);
  for (const field of ['inputDigest', 'weights', 'predictionIndex', 'totalHits', 'currentHitStreak', 'currentMissStreak',
    'longestHitStreak', 'longestMissStreak', 'test3MaxLoss', 'test7MaxLoss', 'test9MaxLoss']) {
    assert.deepEqual(runtime.engine[field], reference[field], field);
  }
});

test('midnight ordering advances the real 30s period format', () => {
  assert.equal(nextPeriod('20261007100052880'), '20261008100050001');
});

test('collector handoff ignores T7 revisions behind the stored_at delta cursor', async () => {
  const { records, signals } = fixture(2);
  const active = nextPeriod(records.at(-1).issueNumber);
  const store = new MemoryStore(records, signals); activeSignal(store, active);
  store.signalsSince = async (since, periods = []) => ({
    signals: structuredClone(store.signals.filter((s) => !since || s.stored_at >= since || periods.includes(s.period_id))),
    through: '2026-10-08T00:00:00Z',
  });
  const { coordinator } = session(store, active);
  await coordinator.onSettledPeriod();
  store.signals[0] = { ...store.signals[0], signal: 'SMALL', stored_at: '2026-10-01T00:00:00Z' };
  const body = await coordinator.onSettledPeriod({ period: records[0].issueNumber });
  assert.equal(body.status, 'ready');
  assert.equal(body.adaptiveBlocked, false);
});

test('an external history revision during computation fails digest verification before the checkpoint is replaced', async () => {
  const { records, signals } = fixture(2);
  const active = nextPeriod(records.at(-1).issueNumber);
  const store = new MemoryStore([records[0]], signals); activeSignal(store, active);
  const { runtime, coordinator } = session(store, active);
  await coordinator.onSettledPeriod();
  const before = structuredClone(store.saved.state);
  store.records.push(records[1]);
  const settle = runtime.engine.settle.bind(runtime.engine);
  runtime.engine.settle = (record) => {
    const step = settle(record);
    store.records[1] = { ...records[1], winningNumber: (records[1].winningNumber + 1) % 10 };
    return step;
  };
  assert.equal((await coordinator.onSettledPeriod()).status, 'recovery_required');
  assert.deepEqual(store.saved.state, before);
  store.records[1] = records[1]; // the durable value is restored, then recovery rebuilds
  assert.equal((await coordinator.onSettledPeriod()).status, 'ready');
  assert.equal(store.saved.state.totalPredictions, 2);
  assert.equal(runtime.engine.history[1].period, records[1].issueNumber);
});

test('a legacy checkpoint is rebuilt in T3+T9 mode without waiting for T7', async () => {
  const { records, signals } = fixture(1);
  const active = nextPeriod(records[0].issueNumber);
  const store = new MemoryStore(records, [{ ...signals[0], status: 'pending', created_at: '2026-10-07T00:00:00Z' }]);
  activeSignal(store, active);
  const legacy = new AdaptiveLearningEngine(); legacy.settle(records[0]);
  store.saved = { state: legacy.checkpoint(), updatedAt: '2026-10-01T00:00:00Z' };
  const { runtime, coordinator, logs } = session(store, active);
  assert.equal((await coordinator.onSettledPeriod()).status, 'ready');
  assert.equal(runtime.engine.history.length, 1);
  assert.equal(runtime.engine.history[0].t7pred, null);
  assert.ok(logs.some((line) => line.includes('incompatible mode=legacy')));
});

test('a missing durable T7 row is optional and never blocks Adaptive', async () => {
  const { records, signals } = fixture(1);
  const active = nextPeriod(records[0].issueNumber);
  const store = new MemoryStore(records, signals); activeSignal(store, active);
  store.periodInputs = async () => ({ record: records[0], signal: null });
  const { runtime, coordinator } = session(store, active);
  const body = await coordinator.onSettledPeriod();
  assert.equal(body.status, 'ready');
  assert.equal(body.t7AvailableForAdaptive, false);
  assert.equal(runtime.engine.predictionIndex, 1);
});

test('a legacy checkpoint rebuilds in T3+T9 mode and never restarts for T7 backfill', async () => {
  const { records, signals } = fixture(65);
  const active = nextPeriod(records.at(-1).issueNumber);
  const legacy = new AdaptiveLearningEngine();
  legacy.setSignals(signals.slice(0, 5));
  records.forEach((record) => legacy.settle(record));
  const store = new MemoryStore(records, signals.slice(0, 10));
  store.saved = { state: legacy.checkpoint(), updatedAt: '2026-10-08T00:00:00Z' };
  const { coordinator, logs } = session(store, active);
  const first = await coordinator.onSettledPeriod();
  assert.equal(first.status, 'ready', logs.join('\n'));
  assert.equal(first.totalPredictions, 65);
  for (let offset = 10; offset < signals.length; offset += 10) {
    await coordinator.ingest(async () => { store.signals.push(...signals.slice(offset, offset + 10)); }, 't7');
    await coordinator.onSettledPeriod({ periods: signals.slice(offset, offset + 10).map((s) => s.period_id) });
  }
  assert.equal(logs.filter((line) => line.includes('[RECOVERY] status=started')).length, 0,
    'Adaptive never waits on the T7 queue');
  assert.equal(store.saved.state.totalPredictions, 65);
});

function latch() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('T7 backfill during a restart suffix replay never restarts it; accumulated periods run after promotion', { timeout: 20_000 }, async () => {
  const { records, signals } = fixture(130);
  const active = nextPeriod(records.at(-1).issueNumber);
  const store = new MemoryStore(records.slice(0, 70), signals.slice(0, 10));
  activeSignal(store, active);
  await session(store, active).coordinator.onSettledPeriod();
  store.records.push(...records.slice(70)); // durable but unevaluated suffix
  const durableBefore = structuredClone(store.saved);
  const entered = latch(); const release = latch();
  const replayed = []; const logs = [];
  const runtime = new AdaptiveRuntime(store, {
    currentIssue: async () => active, log: (line) => logs.push(line),
    replayYield: async ({ period }) => {
      replayed.push(period);
      if (period === records[71].issueNumber) { entered.resolve(); await release.promise; }
    },
  });
  const coordinator = new AdaptiveCoordinator(runtime);
  const recovery = coordinator.onSettledPeriod();
  await entered.promise;
  assert.equal(runtime.phase, 'recovering');
  assert.equal(runtime.engine, null, 'A private recovery candidate must not become the active engine');
  const recoveryId = runtime.recoverySession.id;
  await coordinator.ingest(async () => { store.signals.push(...signals.slice(10, 70)); }, 't7');
  for (let i = 10; i < 70; i++) {
    assert.equal(coordinator.onSettledPeriod({ period: records[i].issueNumber }), recovery);
  }
  assert.equal(runtime.runRecovery(), runtime.recoveryPromise, 'Runtime recovery itself must also be single-flight');
  assert.equal(runtime.recoverySession.boundary.highWater, records[129].issueNumber);
  assert.equal(runtime.recoverySession.boundary.stored.signals.some((s) => s.period_id === records[10].issueNumber), false,
    'Backfill must not mutate the captured snapshot');
  assert.deepEqual(store.saved, durableBefore);
  release.resolve();
  const completed = await recovery;
  assert.equal(completed.status, 'ready');
  assert.equal(completed.totalPredictions, 130);
  assert.equal(logs.filter((line) => line.includes('[RECOVERY] status=started')).length, 1);
  assert.equal(logs.filter((line) => line.includes('[RECOVERY] status=completed')).length, 1);
  assert.deepEqual(replayed, records.slice(70).map((r) => r.issueNumber), 'The frozen replay covers the durable suffix once');
  const recoveryWrites = logs.filter((line) => line.startsWith('[CHECKPOINT]') && line.includes('recovery_id='));
  assert.equal(recoveryWrites.length, 1);
  assert.equal(runtime.recoverySession, null);
  assert.equal(store.saved.state.predictionIndex, 130);
  const { engine: reference } = t3t9(records, signals);
  assert.deepEqual(runtime.engine.history, reference.history);
  for (const field of ['weights', 'inputDigest', 'test3MaxLoss', 'test7MaxLoss', 'test9MaxLoss', 'totalHits', 'longestMissStreak']) {
    assert.deepEqual(runtime.engine[field], reference[field], field);
  }
  assert.equal(logs.filter((line) => line.includes(`recovery_id=${recoveryId}`)).length > 0, true);
});

test('new data during a suffix replay never restarts it and catches up after the one recovery checkpoint', { timeout: 20_000 }, async () => {
  const { records, signals } = fixture(125);
  const active = nextPeriod(records.at(-1).issueNumber);
  const store = new MemoryStore(records.slice(0, 60), signals.slice(0, 60));
  activeSignal(store, active);
  await session(store, active).coordinator.onSettledPeriod();
  store.records.push(...records.slice(60, 65));
  store.signals.push(...signals.slice(60, 65));
  const entered = latch(); const release = latch(); const logs = []; const replayed = [];
  const runtime = new AdaptiveRuntime(store, { currentIssue: async () => active, log: (line) => logs.push(line),
    replayYield: async ({ period }) => {
      replayed.push(period);
      if (period === records[61].issueNumber) { entered.resolve(); await release.promise; }
    } });
  const coordinator = new AdaptiveCoordinator(runtime);
  const flight = coordinator.onSettledPeriod();
  await entered.promise;
  await coordinator.ingest(async () => { store.records.push(...records.slice(65)); store.signals.push(...signals.slice(65)); }, 'history');
  for (const row of records.slice(65)) assert.equal(coordinator.onSettledPeriod({ period: row.issueNumber }), flight);
  assert.equal(store.saved.state.totalPredictions, 60);
  release.resolve();
  const body = await flight;
  assert.equal(body.totalPredictions, 125);
  assert.equal(logs.filter((line) => line.includes('[RECOVERY] status=started')).length, 1);
  assert.equal(logs.filter((line) => line.startsWith('[CHECKPOINT]') && line.includes('recovery_id=')).length, 1);
  assert.deepEqual(replayed, records.slice(60, 65).map((row) => row.issueNumber));
  const { engine: reference } = t3t9(records, signals);
  assert.deepEqual(runtime.engine.history, reference.history);
});

test('failed recovery checkpoint preserves active state and retries the same candidate without replay or duplicate durable write', async () => {
  const { records, signals } = fixture(9);
  const active = nextPeriod(records.at(-1).issueNumber);
  const store = new MemoryStore(records.slice(0, 8), signals.slice(0, 8)); activeSignal(store, active);
  await session(store, active).coordinator.onSettledPeriod();
  store.records.push(records[8]); store.signals.push(signals[8]); // durable unevaluated suffix
  const { runtime, coordinator, logs } = session(store, active);
  const save = store.saveCheckpoint.bind(store); let acknowledgementLost = true;
  store.saveCheckpoint = async (state) => {
    await save(state);
    if (acknowledgementLost) { acknowledgementLost = false; throw new Error('Recovery checkpoint acknowledgement lost'); }
  };
  const writesBefore = store.writes.length;
  assert.equal((await coordinator.onSettledPeriod()).status, 'recovering');
  assert.equal(runtime.engine, null, 'Promotion must wait for verified persistence');
  const candidate = runtime.recoverySession.candidate;
  const recoveryId = runtime.recoverySession.id;
  assert.equal((await coordinator.onSettledPeriod()).status, 'ready');
  assert.equal(runtime.engine, candidate);
  assert.equal(store.writes.slice(writesBefore).filter((s) => s.activePrediction === null).length, 1,
    'Reading the identical committed checkpoint prevents a duplicate recovery upsert');
  assert.equal(logs.filter((line) => line.includes('status=started') && line.includes(`recovery_id=${recoveryId}`)).length, 1);
});

test('a changing durable capture is rejected before replay, then one stable recovery starts', async () => {
  const { records, signals } = fixture(4);
  const active = nextPeriod(records.at(-1).issueNumber);
  const store = new MemoryStore(records.slice(0, 3), signals.slice(0, 3)); activeSignal(store, active);
  await session(store, active).coordinator.onSettledPeriod();
  store.records.push(records[3]); store.signals.push(signals[3]); // durable unevaluated suffix
  const saved = structuredClone(store.saved);
  const read = store.historyAfter.bind(store); let externalWrite = true;
  store.historyAfter = async (...args) => {
    const result = await read(...args);
    if (externalWrite) { externalWrite = false; store.records[3] = { ...records[3], createdAt: '2026-01-01T00:00:00.000Z' }; }
    return result;
  };
  const { runtime, coordinator, logs } = session(store, active);
  assert.equal((await coordinator.onSettledPeriod()).status, 'error');
  assert.equal(runtime.recoverySession, null);
  assert.deepEqual(store.saved, saved);
  assert.equal(logs.filter((line) => line.includes('status=started')).length, 0);
  store.records[3] = records[3]; // the durable boundary is stable again
  assert.equal((await coordinator.onSettledPeriod()).status, 'ready');
  assert.equal(logs.filter((line) => line.includes('status=started')).length, 1);
});

test('recovery_failed is latched: repeated polling/backfill cannot restart corrupt-checkpoint recovery', async () => {
  const { records, signals } = fixture(5);
  const active = nextPeriod(records.at(-1).issueNumber);
  const store = new MemoryStore(records, signals); activeSignal(store, active);
  await session(store, active).coordinator.onSettledPeriod();
  store.saved.state.runtimeDigest = 'corrupt';
  const saved = structuredClone(store.saved);
  const { runtime, coordinator, logs } = session(store, active);
  const first = await coordinator.onSettledPeriod();
  assert.equal(first.adaptiveState, 'recovery_failed');
  const reads = store.reads.length;
  for (let i = 0; i < 60; i++) await coordinator.onSettledPeriod({ period: records[i % 5].issueNumber });
  assert.equal(runtime.phase, 'recovery_failed');
  assert.equal(store.reads.length, reads);
  assert.deepEqual(store.saved, saved);
  assert.equal(logs.filter((line) => line.includes('status=started')).length, 0);
});

test('recovery is unaffected by unrelated T7 backfill and completes on durable history', async () => {
  const { records, signals } = fixture(15);
  const active = nextPeriod(records.at(-1).issueNumber);
  const store = new MemoryStore(records.slice(0, 10), signals.slice(0, 10));
  activeSignal(store, active);
  await session(store, active).coordinator.onSettledPeriod();
  store.records.push(...records.slice(10)); // durable unevaluated suffix
  const logs = [];
  const runtime = new AdaptiveRuntime(store, { currentIssue: async () => active, log: (line) => logs.push(line) });
  const coordinator = new AdaptiveCoordinator(runtime);
  for (let i = 0; i < 20; i++) store.signals.push({ ...signals[14], period_id: `${signals[14].period_id}${i}`, status: 'win' });
  const ready = await coordinator.onSettledPeriod({ periods: records.slice(10).map((record) => record.issueNumber) });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.totalPredictions, records.length);
  assert.equal(logs.filter((line) => line.includes('status=started')).length, 1);
  assert.equal(logs.filter((line) => line.includes('status=completed')).length, 1);
});



test('a missing history predecessor pauses evaluation and resumes when it is persisted', async () => {
  const { records, signals } = fixture(6);
  const active = nextPeriod(records.at(-1).issueNumber);
  const store = new MemoryStore(records.slice(0, 3), signals.slice(0, 3));
  activeSignal(store, active);
  const { runtime, coordinator } = session(store, active);
  await coordinator.onSettledPeriod();
  assert.equal(runtime.engine.predictionIndex, 3);
  await coordinator.ingest(async () => {
    store.records.push(records[4], records[5]);
    store.signals.push(signals[4], signals[5]);
  }, 'history');
  const waiting = await coordinator.onSettledPeriod({ periods: [records[4].issueNumber, records[5].issueNumber] });
  assert.equal(waiting.status, 'waiting_for_history');
  assert.equal(waiting.pendingPeriod, records[3].issueNumber);
  assert.equal(waiting.adaptiveBlocked, true, 'A missing actual outcome remains an explicit boundary');
  assert.equal(runtime.engine.predictionIndex, 3);
  await coordinator.ingest(async () => { store.records.push(records[3]); store.signals.push(signals[3]); }, 'history');
  const ready = await coordinator.onSettledPeriod({ period: records[3].issueNumber });
  assert.equal(ready.status, 'ready');
  assert.equal(runtime.engine.history.length, 6);
  assert.deepEqual(runtime.engine.records.map((row) => row.issueNumber), records.map((row) => row.issueNumber));
});

test('new baseline starts at the first period after the excluded gap without requiring T7', async () => {
  const { records } = fixture(5);
  const before = records.map((record, index) => ({ ...record, issueNumber: String(20261002100050851n + BigInt(index)) }));
  const start = { ...before[0], issueNumber: '20261002100050860' };
  const shifted = [start, ...before.slice(1).map((record, index) => ({ ...record, issueNumber: String(20261002100050861n + BigInt(index)) }))];
  const signals = shifted.map((record) => strictSignal(record));
  const active = nextPeriod(shifted.at(-1).issueNumber);
  const store = new BaselineMemoryStore(shifted, [...signals, { period_id: active, signal: 'BIG', status: 'pending' }]);
  const { runtime, coordinator, logs } = session(store, active);
  const body = await coordinator.onSettledPeriod();
  assert.equal(body.status, 'ready');
  assert.equal(body.baselineStartPeriod, start.issueNumber);
  assert.equal(body.baselinePeriodsIncluded, shifted.length);
  assert.equal(body.baselineReason, 'Adaptive T3+T9 mode; T7 is optional and independent');
  assert.equal(runtime.engine.records[0].issueNumber, start.issueNumber);
  assert.equal(store.legacyCheckpoint, null, 'The old checkpoint remains separate and untouched');
  assert.equal(store.baseline.state.baseline.baselineStartPeriod, start.issueNumber);
  assert.equal(store.baseline.state.adaptiveRequiredSignals.join('|'), 'T3|T9');
  assert.equal(store.baseline.state.adaptiveOptionalSignals.join('|'), 'T7');
  assert.ok(logs.some((line) => line.includes('[ADAPTIVE] baseline initialization started')));
  assert.ok(logs.some((line) => line.includes('[ADAPTIVE] baseline checkpoint not_found')));
  assert.ok(logs.some((line) => line.includes('[ADAPTIVE] baseline candidate selected')));
});

test('baseline progresses on T3+T9 while T7 is missing and never waits for it', async () => {
  const { records } = fixture(4);
  const active = nextPeriod(records.at(-1).issueNumber);
  const store = new BaselineMemoryStore(records.slice(0, 2), [strictSignal(records[0])]);
  store.signals.push({ period_id: active, signal: 'BIG', status: 'pending' });
  const { runtime, coordinator } = session(store, active);
  const first = await coordinator.onSettledPeriod();
  assert.equal(first.status, 'ready');
  assert.equal(first.baselinePeriodsIncluded, 2);
  store.records.push(records[2]);
  const next = await coordinator.onSettledPeriod({ period: records[2].issueNumber });
  assert.equal(next.status, 'ready', 'A missing T7 row cannot hold the baseline cursor');
  assert.equal(next.adaptiveCursor, records[2].issueNumber);
  assert.equal(runtime.engine.history.every((row) => row.t7pred === null), true);
});

test('duplicate or conflicting T7 rows never affect the baseline', async () => {
  const { records } = fixture(2);
  const active = nextPeriod(records.at(-1).issueNumber);
  const store = new BaselineMemoryStore(records, [...records.map((record) => strictSignal(record)), { period_id: active, signal: 'BIG', status: 'pending' }]);
  const { runtime, coordinator } = session(store, active);
  const ready = await coordinator.onSettledPeriod();
  assert.equal(ready.status, 'ready');
  const index = store.signals.findIndex((signal) => signal.period_id === records[0].issueNumber);
  store.signals.push(structuredClone(store.signals[index]));
  assert.equal((await coordinator.onSettledPeriod({ period: records[0].issueNumber })).status, 'ready');
  store.signals[index] = { ...store.signals[index], signal: store.signals[index].signal === 'BIG' ? 'SMALL' : 'BIG' };
  const conflicted = await coordinator.onSettledPeriod({ period: records[0].issueNumber });
  assert.equal(conflicted.status, 'ready', 'T7 conflicts are a separate T7 concern, not an Adaptive blocker');
  assert.equal(runtime.engine.history.length, records.length);
});

test('baseline checkpoint metadata and exact replay remain stable across a clean restart', async () => {
  const { records } = fixture(6);
  const active = nextPeriod(records.at(-1).issueNumber);
  const signals = records.map((record) => strictSignal(record));
  const store = new BaselineMemoryStore(records, [...signals, { period_id: active, signal: 'BIG', status: 'pending' }]);
  const first = session(store, active);
  const ready = await first.coordinator.onSettledPeriod();
  assert.equal(ready.status, 'ready');
  const metadata = structuredClone(store.baseline.state.baseline);
  const restarted = session(store, active);
  const restored = await restarted.coordinator.onSettledPeriod();
  assert.equal(restored.status, 'ready');
  assert.deepEqual(store.baseline.state.baseline, metadata);
  assert.deepEqual(restarted.runtime.engine.history, first.runtime.engine.history);
  assert.equal(restarted.runtime.engine.history.some((row) => row.period === active), false);
  assert.equal(restored.baselinePeriodsIncluded, records.length);
});
