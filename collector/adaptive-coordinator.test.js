import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveCoordinator } from './adaptive-coordinator.js';
import { AdaptiveRuntime, nextPeriod } from './adaptive-runtime.js';
import { AdaptiveLearningEngine } from './adaptive-learning.js';
import { AdaptiveLearningStore } from './adaptive-learning-store.js';
import { scheduledStartFromIssue } from './adaptive-algorithms.generated.js';
import { validateDataset } from './validate-adaptive-learning.mjs';

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

test('B/I: missing or pending T7 holds the entire tail; ingestion remains usable while waiting', async () => {
  const { records, signals } = fixture(3);
  const active = nextPeriod(records.at(-1).issueNumber);
  const store = new MemoryStore([records[0]], []);
  const { runtime, coordinator } = session(store, active);
  assert.equal((await coordinator.onSettledPeriod()).status, 'waiting_for_t7');
  assert.equal(runtime.engine.predictionIndex, 0);
  await coordinator.ingest(async () => {
    store.records.push(...records.slice(1));
    store.signals.push({ ...signals[0], status: 'pending' }, ...signals.slice(1));
  }, 't7');
  assert.equal((await coordinator.onSettledPeriod()).pendingPeriod, records[0].issueNumber);
  assert.equal(store.records.length, 3, 'Collector continues persisting while Adaptive waits');
  assert.equal(store.saved.state.totalPredictions, 0);
  await coordinator.ingest(async () => { store.signals[0] = signals[0]; activeSignal(store, active); }, 't7');
  assert.equal((await coordinator.onSettledPeriod()).totalPredictions, 3);
});

test('C: a complete T7 response batch is serialized; only its final value is evaluated', async () => {
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
  assert.equal(runtime.engine.history[0].t7pred, 'Big');
  assert.equal(runtime.engine.predictionIndex, 1);
});

test('D: post-checkpoint revision blocks downstream and recovers the complete state safely', async () => {
  const { records, signals } = fixture(3);
  const active = nextPeriod(records.at(-1).issueNumber);
  const store = new MemoryStore(records.slice(0, 2), signals.slice(0, 2));
  activeSignal(store, active);
  const { runtime, coordinator, logs } = session(store, active);
  await coordinator.onSettledPeriod();
  const before = structuredClone(store.saved.state);
  await coordinator.ingest(async () => {
    store.signals[0] = { ...signals[0], signal: 'SMALL' };
    store.records.push(records[2]); store.signals.push(signals[2]);
  });
  const blocked = await coordinator.onSettledPeriod();
  assert.equal(blocked.status, 'recovery_required');
  assert.equal(runtime.engine.history.length, 2);
  assert.deepEqual(store.saved.state, before, 'Revision cannot silently overwrite the checkpoint');
  const recovered = await coordinator.onSettledPeriod();
  assert.equal(recovered.status, 'ready');
  const reference = new AdaptiveLearningEngine();
  reference.setSignals(store.signals);
  records.forEach((r) => reference.settle(r)); reference.predict(active);
  assert.deepEqual(runtime.engine.history, reference.history);
  assert.deepEqual(recovered.weights, reference.weights);
  assert.ok(logs.some((s) => s.includes('status=revision_detected')));
  assert.ok(logs.some((s) => s.includes('[RECOVERY] status=completed')));
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
  assert.equal((await coordinator.onSettledPeriod()).status, 'waiting_for_t7');
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

test('restart detects durable T7 revisions and repairs with exact full replay, preserving original audit', async () => {
  const { records, signals } = fixture(4);
  const active = nextPeriod(records.at(-1).issueNumber);
  const store = new MemoryStore(records, signals); activeSignal(store, active);
  const original = session(store, active); await original.coordinator.onSettledPeriod();
  const audit = structuredClone(store.saved.state.firstPredictions);
  store.signals[0].signal = 'SMALL';
  const restarted = session(store, active);
  assert.equal((await restarted.coordinator.onSettledPeriod()).status, 'ready');
  const { engine: reference } = validateDataset(records, store.signals);
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
  assert.equal((await restarted.coordinator.onSettledPeriod()).status, 'recovery_required');
  assert.equal((await restarted.coordinator.onSettledPeriod()).status, 'ready');
  const { engine: reference } = validateDataset(records, store.signals);
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
  const { engine: reference } = validateDataset(records, store.signals);
  assert.deepEqual(runtime.engine.history, reference.history);
  for (const field of ['inputDigest', 'weights', 'predictionIndex', 'totalHits', 'currentHitStreak', 'currentMissStreak',
    'longestHitStreak', 'longestMissStreak', 'test3MaxLoss', 'test7MaxLoss', 'test9MaxLoss']) {
    assert.deepEqual(runtime.engine[field], reference[field], field);
  }
});

test('midnight ordering advances the real 30s period format', () => {
  assert.equal(nextPeriod('20261007100052880'), '20261008100050001');
});

test('collector handoff detects evaluated revisions even behind the stored_at delta cursor', async () => {
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
  assert.equal((await coordinator.onSettledPeriod({ period: records[0].issueNumber })).status, 'recovery_required');
  assert.equal((await coordinator.onSettledPeriod()).status, 'ready');
});

test('an external revision during computation fails digest verification before the checkpoint is replaced', async () => {
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
    store.signals[1].signal = 'BIG';
    return step;
  };
  assert.equal((await coordinator.onSettledPeriod()).status, 'recovery_required');
  assert.deepEqual(store.saved.state, before);
  assert.equal((await coordinator.onSettledPeriod()).status, 'ready');
  assert.equal(store.saved.state.totalPredictions, 2);
  assert.equal(runtime.engine.history[1].t7pred, 'Big');
});

test('legacy late-addition recovery pauses the same full replay until its input is finalized', async () => {
  const { records, signals } = fixture(1);
  const active = nextPeriod(records[0].issueNumber);
  const store = new MemoryStore(records, [{ ...signals[0], status: 'pending', created_at: '2026-10-07T00:00:00Z' }]);
  activeSignal(store, active);
  const legacy = new AdaptiveLearningEngine(); legacy.settle(records[0]);
  store.saved = { state: legacy.checkpoint(), updatedAt: '2026-10-01T00:00:00Z' };
  const before = structuredClone(store.saved);
  const { runtime, coordinator } = session(store, active);
  assert.equal((await coordinator.onSettledPeriod()).status, 'waiting_for_t7');
  assert.deepEqual(store.saved, before);
  store.signals[0].status = 'win';
  assert.equal((await coordinator.onSettledPeriod()).status, 'ready');
  assert.equal(runtime.engine.history[0].t7pred, 'Big');
});

test('exact durable T7 verification cannot be satisfied by a stale cached signal', async () => {
  const { records, signals } = fixture(1);
  const active = nextPeriod(records[0].issueNumber);
  const store = new MemoryStore(records, signals); activeSignal(store, active);
  store.periodInputs = async () => ({ record: records[0], signal: null });
  const { runtime, coordinator } = session(store, active);
  assert.equal((await coordinator.onSettledPeriod()).status, 'waiting_for_t7');
  assert.equal(runtime.engine.predictionIndex, 0);
});

test('live-log reproduction: legacy checkpoint mismatch must not start startup recovery on every T7 backfill', async () => {
  const { records, signals } = fixture(65);
  const active = nextPeriod(records.at(-1).issueNumber);
  const legacy = new AdaptiveLearningEngine();
  legacy.setSignals(signals.slice(0, 5));
  records.forEach((record) => legacy.settle(record));
  // Backfilled rows have old source timestamps: the timestamp-only late-addition
  // proof used in the Windows log cannot classify this otherwise valid dataset.
  const store = new MemoryStore(records, signals.slice(0, 10));
  store.saved = { state: legacy.checkpoint(), updatedAt: '2026-10-08T00:00:00Z' };
  const { coordinator, logs } = session(store, active);
  const first = await coordinator.onSettledPeriod();
  assert.equal(first.status, 'waiting_for_t7', logs.join('\n'));
  for (let offset = 10; offset < signals.length; offset += 10) {
    await coordinator.ingest(async () => { store.signals.push(...signals.slice(offset, offset + 10)); }, 't7');
    await coordinator.onSettledPeriod({ periods: signals.slice(offset, offset + 10).map((s) => s.period_id) });
  }
  assert.equal(logs.filter((line) => line.includes('[RECOVERY] status=started')).length, 1,
    'Historical backfill must continue the original recovery, not restart startup');
  assert.equal(store.saved.state.totalPredictions, 65);
  assert.equal(store.reads.filter((cursor) => cursor === null).length, 2,
    'Backfill readiness polling must not fetch full history after initial boundary capture');
});

function latch() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('60 historical T7 arrivals during recovery continue one frozen replay; accumulated new periods run after promotion', { timeout: 20_000 }, async () => {
  const { records, signals } = fixture(130);
  const active = nextPeriod(records.at(-1).issueNumber);
  const legacy = new AdaptiveLearningEngine();
  legacy.setSignals(signals.slice(0, 5));
  records.slice(0, 70).forEach((record) => legacy.settle(record));
  const store = new MemoryStore(records.slice(0, 70), signals.slice(0, 10));
  activeSignal(store, active);
  store.saved = { state: legacy.checkpoint(), updatedAt: '2026-10-08T00:00:00Z' };
  const durableBefore = structuredClone(store.saved);
  const entered = latch(); const release = latch();
  const replayed = []; const logs = []; const states = [];
  const runtime = new AdaptiveRuntime(store, {
    currentIssue: async () => active, log: (line) => logs.push(line),
    replayYield: async ({ period }) => {
      replayed.push(period);
      if (period === records[4].issueNumber) { entered.resolve(); await release.promise; }
    },
  });
  const coordinator = new AdaptiveCoordinator(runtime, { onState: (body) => states.push(structuredClone(body)) });
  const recovery = coordinator.onSettledPeriod();
  await entered.promise;
  assert.equal(runtime.phase, 'recovering');
  assert.equal(coordinator.body.status, 'recovering');
  assert.equal(runtime.engine, null, 'A private recovery candidate must not become the active engine');
  const recoveryId = runtime.recoverySession.id;
  await coordinator.ingest(async () => {
    store.signals.push(...signals.slice(10, 70)); // 60 late historical signals
    store.records.push(...records.slice(70));
    store.signals.push(...signals.slice(70));
  }, 't7');
  assert.equal(store.records.length, 130, 'Collector must commit while the replay is paused');
  for (let i = 10; i < 70; i++) {
    assert.equal(coordinator.onSettledPeriod({ period: records[i].issueNumber }), recovery);
  }
  assert.equal(runtime.runRecovery(), runtime.recoveryPromise, 'Runtime recovery itself must also be single-flight');
  assert.equal(runtime.recoverySession.boundary.highWater, records[69].issueNumber);
  assert.equal(runtime.recoverySession.boundary.stored.signals.some((s) => s.period_id === records[10].issueNumber), false,
    'Backfill must not mutate the captured snapshot');
  assert.deepEqual(store.saved, durableBefore);
  release.resolve();
  const waiting = await recovery;
  assert.equal(waiting.status, 'waiting_for_t7');
  assert.equal(waiting.pendingPeriod, records[10].issueNumber, 'First incomplete snapshot predecessor must hold replay');
  assert.equal(store.writes.length, 0, 'No partial/regressive recovery checkpoint');
  assert.equal(runtime.recoverySession.id, recoveryId);
  const completed = await coordinator.onSettledPeriod();
  assert.equal(completed.status, 'ready');
  assert.equal(completed.totalPredictions, 130);
  assert.equal(logs.filter((line) => line.includes('[RECOVERY] status=started')).length, 1);
  assert.equal(logs.filter((line) => line.includes('[RECOVERY] status=completed')).length, 1);
  assert.deepEqual(replayed, records.slice(0, 70).map((r) => r.issueNumber), 'Previously replayed rows cannot replay on backfill');
  const recoveryWrites = logs.filter((line) => line.startsWith('[CHECKPOINT]') && line.includes('recovery_id='));
  assert.equal(recoveryWrites.length, 1);
  assert.match(recoveryWrites[0], new RegExp(`period=${records[69].issueNumber}`));
  const promoted = states.find((body) => body.adaptiveState === 'ready' && body.totalPredictions === 70);
  assert.ok(promoted, 'The original finalized boundary must be promoted before catch-up');
  const settledCheckpoints = store.writes.filter((state) => state.activePrediction === null);
  assert.equal(new Set(settledCheckpoints.map((state) => state.period)).size, settledCheckpoints.length);
  assert.equal(store.saved.state.predictionIndex, 130);
  assert.equal(store.reads.filter((cursor) => cursor === null).length, 2,
    'Paused recovery refreshes only incremental history and required signal IDs');
  const { engine: reference } = validateDataset(records, signals);
  assert.deepEqual(runtime.engine.history, reference.history);
  for (const field of ['weights', 'inputDigest', 'test3MaxLoss', 'test7MaxLoss', 'test9MaxLoss', 'totalHits', 'longestMissStreak']) {
    assert.deepEqual(runtime.engine[field], reference[field], field);
  }
});

test('new data during an already finalized replay never restarts it and catches up after the one recovery checkpoint', { timeout: 20_000 }, async () => {
  const { records, signals } = fixture(125);
  const active = nextPeriod(records.at(-1).issueNumber);
  const store = new MemoryStore(records.slice(0, 65), signals.slice(0, 65));
  activeSignal(store, active);
  await session(store, active).coordinator.onSettledPeriod();
  store.signals[0].signal = 'SMALL';
  const entered = latch(); const release = latch(); const logs = []; const replayed = [];
  const runtime = new AdaptiveRuntime(store, { currentIssue: async () => active, log: (line) => logs.push(line),
    replayYield: async ({ period }) => {
      replayed.push(period);
      if (period === records[2].issueNumber) { entered.resolve(); await release.promise; }
    } });
  const coordinator = new AdaptiveCoordinator(runtime);
  const flight = coordinator.onSettledPeriod();
  await entered.promise;
  assert.equal(runtime.recoverySession.earliestAffectedPeriod, records[0].issueNumber);
  await coordinator.ingest(async () => { store.records.push(...records.slice(65)); store.signals.push(...signals.slice(65)); }, 'history');
  for (const row of records.slice(65)) assert.equal(coordinator.onSettledPeriod({ period: row.issueNumber }), flight);
  assert.equal(store.saved.state.totalPredictions, 65);
  release.resolve();
  const body = await flight;
  assert.equal(body.totalPredictions, 125);
  assert.equal(logs.filter((line) => line.includes('[RECOVERY] status=started')).length, 1);
  assert.equal(logs.filter((line) => line.startsWith('[CHECKPOINT]') && line.includes('recovery_id=')).length, 1);
  assert.deepEqual(replayed, records.slice(0, 65).map((row) => row.issueNumber));
  const reference = new AdaptiveLearningEngine(); reference.setSignals(store.signals);
  records.forEach((record) => reference.settle(record));
  assert.deepEqual(runtime.engine.history, reference.history);
});

test('failed recovery checkpoint preserves active state and retries the same candidate without replay or duplicate durable write', async () => {
  const { records, signals } = fixture(8);
  const active = nextPeriod(records.at(-1).issueNumber);
  const store = new MemoryStore(records, signals); activeSignal(store, active);
  const { runtime, coordinator, logs } = session(store, active);
  await coordinator.onSettledPeriod();
  const previousEngine = runtime.engine;
  store.signals[0].signal = 'SMALL';
  await coordinator.onSettledPeriod(); // revision detection
  const save = store.saveCheckpoint.bind(store); let acknowledgementLost = true;
  store.saveCheckpoint = async (state) => {
    await save(state);
    if (acknowledgementLost) { acknowledgementLost = false; throw new Error('Recovery checkpoint acknowledgement lost'); }
  };
  const writesBefore = store.writes.length;
  assert.equal((await coordinator.onSettledPeriod()).status, 'recovering');
  assert.equal(runtime.engine, previousEngine, 'Promotion must wait for verified persistence');
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
  const store = new MemoryStore(records, signals); activeSignal(store, active);
  await session(store, active).coordinator.onSettledPeriod();
  const saved = structuredClone(store.saved);
  const read = store.signalsSince.bind(store); let externalWrite = true;
  store.signalsSince = async (...args) => {
    const result = await read(...args);
    if (externalWrite) { externalWrite = false; store.signals[0].signal = 'SMALL'; }
    return result;
  };
  const { runtime, coordinator, logs } = session(store, active);
  assert.equal((await coordinator.onSettledPeriod()).status, 'error');
  assert.equal(runtime.recoverySession, null);
  assert.deepEqual(store.saved, saved);
  assert.equal(logs.filter((line) => line.includes('status=started')).length, 0);
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

test('blocked recovery ignores unrelated T7 backfill and resumes only when the exact replay cursor is finalized', async () => {
  const { records, signals } = fixture(15);
  const active = nextPeriod(records.at(-1).issueNumber);
  const legacy = new AdaptiveLearningEngine();
  legacy.setSignals(signals.slice(0, 5));
  records.forEach((record) => legacy.settle(record));
  const store = new MemoryStore(records, signals.slice(0, 10));
  activeSignal(store, active);
  store.saved = { state: legacy.checkpoint(), updatedAt: '2026-10-08T00:00:00Z' };
  const logs = []; const { coordinator } = (() => {
    const runtime = new AdaptiveRuntime(store, { currentIssue: async () => active, log: (line) => logs.push(line) });
    return { runtime, coordinator: new AdaptiveCoordinator(runtime) };
  })();
  const first = await coordinator.onSettledPeriod();
  assert.equal(first.status, 'waiting_for_t7', logs.join('\\n'));
  const cursor = first.replayCursor;
  const processed = first.replayProcessed;
  assert.equal(cursor, records[10].issueNumber);
  assert.equal(processed, 10);
  const resumedBefore = logs.filter((line) => line.includes('status=resumed')).length;
  for (let i = 0; i < 50; i++) {
    store.signals.push({ ...signals[14], period_id: `${signals[14].period_id}${i}`, status: 'win' });
    const waiting = await coordinator.onSettledPeriod({ period: records[i % 10].issueNumber });
    assert.equal(waiting.status, 'waiting_for_t7');
    assert.equal(waiting.replayCursor, cursor);
    assert.equal(waiting.replayProcessed, processed);
  }
  assert.equal(logs.filter((line) => line.includes('status=resumed')).length, resumedBefore);
  store.signals.push(signals[10]);
  const next = await coordinator.onSettledPeriod({ period: records[10].issueNumber });
  assert.equal(next.status, 'waiting_for_t7');
  assert.equal(next.replayCursor, records[11].issueNumber);
  assert.ok(next.replayProcessed > processed);
  assert.equal(logs.filter((line) => line.includes('status=resumed')).length, resumedBefore + 1);
  for (let i = 11; i < records.length; i++) store.signals.push(signals[i]);
  const ready = await coordinator.onSettledPeriod({ periods: records.slice(11).map((record) => record.issueNumber) });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.totalPredictions, records.length);
  assert.equal(logs.filter((line) => line.includes('status=started')).length, 1);
  assert.equal(logs.filter((line) => line.includes('status=completed')).length, 1);
});

test('resume remains waiting when durable probe sees T7 but the captured replay snapshot omits it', async () => {
  const { records, signals } = fixture(3);
  const active = nextPeriod(records.at(-1).issueNumber);
  const legacy = new AdaptiveLearningEngine();
  legacy.setSignals([signals[0]]);
  records.forEach((record) => legacy.settle(record));
  const store = new MemoryStore(records, []);
  activeSignal(store, active);
  store.saved = { state: legacy.checkpoint(), updatedAt: '2026-10-08T00:00:00Z' };
  const logs = [];
  const runtime = new AdaptiveRuntime(store, { currentIssue: async () => active, log: (line) => logs.push(line) });
  const coordinator = new AdaptiveCoordinator(runtime);
  const originalPeriodInputs = store.periodInputs.bind(store);
  let exposeAtProbe = false;
  store.periodInputs = async (period) => exposeAtProbe && period === records[0].issueNumber
    ? { record: records[0], signal: signals[0] } : originalPeriodInputs(period);
  let exposeInSnapshot = false;
  store.signalsSince = async (...args) => exposeInSnapshot
    ? { signals: structuredClone(store.signals), through: '2026-10-08T00:00:00Z', args }
    : { signals: [], through: null, args };

  const first = await coordinator.onSettledPeriod();
  assert.equal(first.status, 'waiting_for_t7', logs.join('\\n'));
  assert.equal(first.replayProcessed, 0);
  exposeAtProbe = true;
  const transient = await coordinator.onSettledPeriod({ period: records[0].issueNumber });
  assert.equal(transient.status, 'waiting_for_t7', logs.join('\n'));
  assert.equal(transient.replayProcessed, 0);
  assert.equal(logs.filter((line) => line.includes('phase=resume_probe status=rejected')).length, 0);
  assert.equal(logs.filter((line) => line.includes('status=resumed')).length, 0);
  assert.equal(logs.filter((line) => line.includes('phase=replay_blocked')).length, 1,
    'Only the initial missing-input replay block should exist');
  assert.ok(logs.some((line) => line.includes('phase=resume_probe_snapshot_mismatch') && line.includes('reason=missing_signal')));
  assert.ok(logs.some((line) => line.includes('phase=resume_probe') && line.includes('finalized":true')));
  exposeInSnapshot = true;
  store.signals.push(signals[0]);
  for (let i = 1; i < records.length; i++) store.signals.push(signals[i]);
  const ready = await coordinator.onSettledPeriod({ periods: records.map((record) => record.issueNumber) });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.totalPredictions, records.length);
  assert.equal(logs.filter((line) => line.includes('status=resumed')).length, 1);
});

test('a verified resume snapshot is the exact snapshot consumed by replay', async () => {
  const { records, signals } = fixture(4);
  const active = nextPeriod(records.at(-1).issueNumber);
  const legacy = new AdaptiveLearningEngine();
  legacy.setSignals([signals[0]]);
  records.forEach((record) => legacy.settle(record));
  const store = new MemoryStore(records, []);
  activeSignal(store, active);
  store.saved = { state: legacy.checkpoint(), updatedAt: '2026-10-08T00:00:00Z' };
  const logs = [];
  const runtime = new AdaptiveRuntime(store, { currentIssue: async () => active, log: (line) => logs.push(line) });
  const coordinator = new AdaptiveCoordinator(runtime);
  let snapshotReady = false;
  store.periodInputs = async (period) => period === records[1].issueNumber
    ? { record: records[1], signal: signals[1] }
    : { record: store.records.find((record) => record.issueNumber === period) ?? null,
      signal: null };
  store.signalsSince = async () => ({
    signals: snapshotReady ? [...signals, ...store.signals] : [signals[0], signals[2], store.signals.find((signal) => signal.period_id === active)],
    through: '2026-10-08T00:00:00Z',
  });
  const waiting = await coordinator.onSettledPeriod();
  assert.equal(waiting.status, 'waiting_for_t7');
  assert.equal(waiting.pendingPeriod, records[1].issueNumber);
  snapshotReady = true;
  const result = await coordinator.onSettledPeriod();
  assert.equal(result.status, 'ready');
  assert.equal(runtime.engine.history.length, records.length);
  const probe = logs.find((line) => line.includes('phase=resume_probe pendingPeriod='));
  const replayInput = logs.find((line) => line.includes(`phase=replay_input period=${records[0].issueNumber}`));
  assert.ok(probe, 'resume probe diagnostics should be recorded');
  assert.ok(replayInput, 'replay input diagnostics should be recorded');
  assert.match(probe, /"finalized":true/);
  assert.match(replayInput, /"finalized":true/);
  assert.equal(logs.filter((line) => line.includes('phase=resume_probe_snapshot_mismatch')).length, 0);
  assert.equal(logs.filter((line) => line.includes('status=resumed')).length, 1);
});

test('new baseline starts at the first strict finalized T7 period after the permanent gap', async () => {
  const { records: tail } = fixture(5);
  const before = tail.map((record, index) => ({ ...record, issueNumber: String(20261002100050851n + BigInt(index)) }));
  const start = { ...before[0], issueNumber: '20261002100050860' };
  const records = [start, ...before.slice(1).map((record, index) => ({ ...record, issueNumber: String(20261002100050861n + BigInt(index)) }))];
  const signals = records.map((record) => strictSignal(record));
  const active = nextPeriod(records.at(-1).issueNumber);
  const store = new BaselineMemoryStore(records, [...signals, { period_id: active, signal: 'BIG', status: 'pending' }]);
  const { runtime, coordinator, logs } = session(store, active);
  const body = await coordinator.onSettledPeriod();
  assert.equal(body.status, 'ready');
  assert.equal(body.baselineStartPeriod, start.issueNumber);
  assert.equal(body.baselinePeriodsIncluded, records.length);
  assert.equal(body.baselineReason, 'previous recovery contained an unrecoverable missing historical T7 input');
  assert.equal(runtime.engine.records[0].issueNumber, start.issueNumber);
  assert.equal(store.legacyCheckpoint, null, 'The old checkpoint remains separate and untouched');
  assert.equal(store.baseline.state.baseline.baselineStartPeriod, start.issueNumber);
  assert.equal(store.baseline.state.baseline.periodsIncluded, records.length);
  assert.ok(logs.some((line) => line.includes('[ADAPTIVE] baseline initialization started')));
  assert.ok(logs.some((line) => line.includes('[ADAPTIVE] baseline checkpoint not_found')));
  assert.ok(logs.some((line) => line.includes('[ADAPTIVE] baseline candidate selected')));
  assert.ok(logs.some((line) => line.includes('[ADAPTIVE] baseline checkpoint persisted')));
  assert.ok(logs.some((line) => line.includes('[ADAPTIVE] baseline initialization completed')));
});

test('baseline waits for a future missing T7 and resumes after the exact finalized signal arrives', async () => {
  const { records } = fixture(3);
  const active = nextPeriod(records.at(-1).issueNumber);
  const store = new BaselineMemoryStore(records.slice(0, 2), [strictSignal(records[0]), strictSignal(records[1])]);
  store.signals.push({ period_id: active, signal: 'BIG', status: 'pending' });
  const { runtime, coordinator } = session(store, active);
  assert.equal((await coordinator.onSettledPeriod()).status, 'ready');
  store.records.push(records[2]);
  const waiting = await coordinator.onSettledPeriod({ period: records[2].issueNumber });
  assert.equal(waiting.status, 'waiting_for_t7');
  assert.equal(waiting.adaptiveCursor, records[1].issueNumber);
  assert.equal(runtime.engine.records.at(-1).issueNumber, records[1].issueNumber);
  store.signals.push(strictSignal(records[2]));
  const ready = await coordinator.onSettledPeriod({ period: records[2].issueNumber });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.adaptiveCursor, records[2].issueNumber);
});

test('baseline handles result-before-T7 and T7-before-result without future-result leakage', async () => {
  const { records } = fixture(3);
  const active = nextPeriod(records.at(-1).issueNumber);
  const store = new BaselineMemoryStore([records[0]], [strictSignal(records[0])]);
  store.signals.push({ period_id: active, signal: 'BIG', status: 'pending' });
  const { runtime, coordinator } = session(store, active);
  await coordinator.onSettledPeriod();
  store.records.push(records[1]); // result arrives before its T7
  const waiting = await coordinator.onSettledPeriod({ period: records[1].issueNumber });
  assert.equal(waiting.status, 'waiting_for_t7');
  assert.equal(runtime.engine.history.length, 1);
  store.signals.push(strictSignal(records[2])); // T7 arrives before its result
  store.records.push(records[2]);
  assert.equal((await coordinator.onSettledPeriod({ period: records[2].issueNumber })).status, 'waiting_for_t7');
  assert.equal(runtime.engine.history.length, 1);
  store.signals.push(strictSignal(records[1]));
  const ready = await coordinator.onSettledPeriod({ periods: [records[1].issueNumber, records[2].issueNumber] });
  assert.equal(ready.status, 'ready');
  assert.equal(runtime.engine.history.length, 3);
  assert.deepEqual(runtime.engine.records.map((record) => record.issueNumber), records.map((record) => record.issueNumber));
});

test('baseline restart while T7 is pending restores the active baseline without using the retired checkpoint', async () => {
  const { records } = fixture(3);
  const active = nextPeriod(records[1].issueNumber);
  const store = new BaselineMemoryStore(records.slice(0, 2), [strictSignal(records[0]), strictSignal(records[1])]);
  store.signals.push({ period_id: active, signal: 'BIG', status: 'pending' });
  const first = session(store, active);
  await first.coordinator.onSettledPeriod();
  store.records.push(records[2]);
  assert.equal((await first.coordinator.onSettledPeriod()).status, 'waiting_for_t7');
  const restarted = session(store, active);
  const pending = await restarted.coordinator.onSettledPeriod();
  assert.equal(pending.status, 'waiting_for_t7');
  assert.equal(pending.baselineId, first.runtime.baseline.baselineId);
  assert.equal(pending.adaptiveCursor, records[1].issueNumber);
  assert.equal(restarted.runtime.engine.history.length, 2);
});

test('duplicate finalized T7 is idempotent, while a conflicting finalized value blocks the baseline', async () => {
  const { records } = fixture(2);
  const active = nextPeriod(records.at(-1).issueNumber);
  const store = new BaselineMemoryStore(records, [...records.map((record) => strictSignal(record)),
    { period_id: active, signal: 'BIG', status: 'pending' }]);
  const { runtime, coordinator } = session(store, active);
  const ready = await coordinator.onSettledPeriod();
  assert.equal(ready.status, 'ready');
  const index = store.signals.findIndex((signal) => signal.period_id === records[0].issueNumber);
  store.signals.push(structuredClone(store.signals[index]));
  assert.equal((await coordinator.onSettledPeriod({ period: records[0].issueNumber })).status, 'ready');
  store.signals[index] = { ...store.signals[index], signal: store.signals[index].signal === 'BIG' ? 'SMALL' : 'BIG' };
  const blocked = await coordinator.onSettledPeriod({ period: records[0].issueNumber });
  assert.equal(blocked.adaptiveState, 'recovery_failed');
  assert.equal(runtime.engine.history.length, records.length);
});

test('baseline checkpoint metadata and exact replay remain stable across a clean restart with no future-result leakage', async () => {
  const { records } = fixture(6);
  const active = nextPeriod(records.at(-1).issueNumber);
  const signals = records.map((record) => strictSignal(record));
  const store = new BaselineMemoryStore(records, [...signals, { period_id: active, signal: 'BIG', status: 'pending' }]);
  const first = session(store, active);
  const ready = await first.coordinator.onSettledPeriod();
  assert.equal(ready.status, 'ready');
  const metadata = structuredClone(store.baseline.state.baseline);
  const checkpoint = structuredClone(store.baseline.state);
  const restarted = session(store, active);
  const restored = await restarted.coordinator.onSettledPeriod();
  assert.equal(restored.status, 'ready');
  assert.deepEqual(store.baseline.state.baseline, metadata);
  assert.deepEqual(restarted.runtime.engine.history, first.runtime.engine.history);
  assert.equal(restarted.runtime.engine.history.some((row) => row.period === active), false);
  assert.equal(store.baseline.state.period, checkpoint.period);
  assert.equal(restored.baselinePeriodsIncluded, records.length);
});
