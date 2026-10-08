import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveRuntime, nextPeriod, finalizedT7 } from './adaptive-runtime.js';
import { AdaptiveCoordinator } from './adaptive-coordinator.js';
import { AdaptiveLearningEngine } from './adaptive-learning.js';
import { ADAPTIVE_INPUT_POLICY } from './adaptive-input-policy.js';
import { compareIssuesAsc, computeTest7, scheduledStartFromIssue } from './adaptive-algorithms.generated.js';

const START = 20261002100052218n; // straddles the historical 20261002100052220 T7 gap
const PERIOD_AT_GAP = '20261002100052220';

function recordsFrom(offset, length) {
  return Array.from({ length }, (_, i) => {
    const issueNumber = String(START + BigInt(offset + i));
    const createdAt = new Date(scheduledStartFromIssue(issueNumber) + 30_000).toISOString();
    return { issueNumber, winningNumber: (i * 7 + 3) % 10, sourceTime: createdAt, createdAt };
  });
}

function t7(record, { signal = 'BIG', status = 'win' } = {}) {
  return {
    period_id: record.issueNumber, signal, status, source: 'server',
    settled_at: status === 'win' || status === 'loss' ? record.createdAt : null,
    actual_number: status === 'win' || status === 'loss' ? record.winningNumber : null,
    stored_at: record.createdAt, created_at: record.createdAt,
  };
}

/** Minimal durable adapter; never supplies a fabricated T7 row. */
class Store {
  constructor(records, signals = []) {
    this.records = structuredClone(records);
    this.signals = structuredClone(signals);
    this.saved = null;
  }
  async loadCheckpointRecord() { return structuredClone(this.saved); }
  async saveCheckpoint(state) { this.saved = { state: structuredClone(state), updatedAt: new Date().toISOString() }; }
  async historyAfter(cursor = null) {
    const rows = this.records.filter((r) => !cursor || BigInt(r.issueNumber) > BigInt(cursor))
      .sort((a, b) => a.issueNumber.localeCompare(b.issueNumber));
    return { records: structuredClone(rows), count: this.records.length };
  }
  async signalsSince() { return { signals: structuredClone(this.signals), through: null }; }
  async periodInputs(period) {
    return structuredClone({
      record: this.records.find((r) => r.issueNumber === period) ?? null,
      signal: this.signals.find((s) => s.period_id === period) ?? null,
    });
  }
  assertCoverage(engine, batch) {
    if (engine.history.length + batch.records.length !== batch.count) throw new Error('History coverage changed.');
  }
}

function session(store, activePeriod) {
  const runtime = new AdaptiveRuntime(store, { currentIssue: async () => activePeriod, log: () => {} });
  return { runtime, coordinator: new AdaptiveCoordinator(runtime) };
}

for (const scenario of [
  { name: 'completely absent', signals: () => [] },
  { name: 'pending', signals: (records) => records.map((r) => t7(r, { status: 'pending' })) },
  { name: 'expired', signals: (records) => records.map((r) => t7(r, { status: 'expired' })) },
  { name: 'unavailable historically', signals: (records) => records.slice(0, 2).map((r) => t7(r)) },
]) {
  test(`Adaptive progresses on T3+T9 while T7 is ${scenario.name}`, async () => {
    const records = recordsFrom(0, 8);
    const signals = scenario.signals(records);
    const active = nextPeriod(records.at(-1).issueNumber);
    const store = new Store(records, signals);
    const { runtime, coordinator } = session(store, active);
    const body = await coordinator.onSettledPeriod();
    assert.equal(body.status, 'ready');
    assert.equal(body.adaptiveRequiredSignals.join('|'), 'T3|T9');
    assert.equal(body.adaptiveOptionalSignals.join('|'), 'T7');
    assert.equal(body.adaptiveBlocked, false);
    assert.equal(body.totalPredictions, records.length);
    assert.equal(runtime.engine.history.every((row) => row.t7pred === null), true, 'T7 never enters the model');
  });
}

test('no fake T7 value is created and the checkpoint advances past 20261002100052220 without T7', async () => {
  const records = recordsFrom(0, 8);
  const store = new Store(records, []); // zero T7 rows at all
  const active = nextPeriod(records.at(-1).issueNumber);
  const { runtime, coordinator } = session(store, active);
  const body = await coordinator.onSettledPeriod();
  assert.equal(body.status, 'ready');
  assert.ok(records.some((r) => r.issueNumber === PERIOD_AT_GAP), 'fixture must include the historical gap period');
  assert.ok(compareIssuesAsc(runtime.engine.lastProcessedPeriod, PERIOD_AT_GAP) > 0, 'cursor advanced past the gap');
  assert.equal(runtime.engine.lastProcessedPeriod, records.at(-1).issueNumber);
  assert.equal(runtime.engine.history.every((row) => row.t7pred === null), true);
  assert.equal(runtime.engine.t7Signals.size, 0, 'no fabricated T7 signal was stored');
  assert.equal(store.saved.state.adaptiveInputMode, 'adaptive-t3-t9-v1');
  assert.equal(store.saved.state.inputDigest, runtime.engine.inputDigest);
});

test('T3 and T9 outputs are identical whether or not T7 is present', () => {
  const records = recordsFrom(0, 24);
  const signals = records.map((r) => t7(r));
  const legacy = new AdaptiveLearningEngine();
  legacy.setSignals(signals);
  records.forEach((record) => legacy.settle(record));
  const adaptive = new AdaptiveLearningEngine({ inputPolicy: ADAPTIVE_INPUT_POLICY });
  adaptive.setSignals(signals);
  records.forEach((record) => adaptive.settle(record));
  assert.deepEqual(adaptive.history.map((r) => r.t3pred), legacy.history.map((r) => r.t3pred), 'T3 is unchanged');
  assert.deepEqual(adaptive.history.map((r) => r.t9pred), legacy.history.map((r) => r.t9pred), 'T9 is unchanged');
  assert.deepEqual(adaptive.cplState, legacy.cplState);
  assert.equal(adaptive.test3MaxLoss, legacy.test3MaxLoss);
  assert.equal(adaptive.test9MaxLoss, legacy.test9MaxLoss);
  assert.equal(adaptive.predictionIndex, legacy.predictionIndex);
  // Test 7 itself still scores identically; Adaptive simply does not consume it.
  const dataset = records.slice().reverse().map((r) => ({ period: r.issueNumber, number: r.winningNumber }));
  const map = new Map(signals.map((s) => [s.period_id, s]));
  assert.deepEqual(computeTest7(dataset, map).details, computeTest7(dataset, map).details);
  assert.ok(computeTest7(dataset, map).details.some((row) => row.predictedSize !== null), 'T7 scoring still produces signals');
  assert.equal(finalizedT7(t7(records[0], { status: 'pending' }), records[0]), false);
  assert.equal(finalizedT7(t7(records[0]), records[0]), true);
});

test('T7 collection stays independent: durable rows are retained and never block Adaptive', async () => {
  const records = recordsFrom(0, 6);
  const signals = records.map((r) => t7(r));
  const store = new Store(records, signals);
  const active = nextPeriod(records.at(-1).issueNumber);
  const { runtime, coordinator } = session(store, active);
  await coordinator.onSettledPeriod();
  assert.equal(runtime.engine.t7Signals.size, signals.length, 'Adaptive still tracks the independent T7 rows');
  assert.equal(store.signals.length, signals.length, 'T7 persistence is untouched');
  // A later T7 revision neither changes Adaptive nor forces recovery.
  store.signals[0] = { ...store.signals[0], signal: 'SMALL' };
  const body = await coordinator.onSettledPeriod({ period: records[0].issueNumber });
  assert.equal(body.status, 'ready');
  assert.equal(runtime.t7AvailableForAdaptive, false);
});

test('missing History remains an explicit boundary while T7 is absent', async () => {
  const records = recordsFrom(0, 5);
  const store = new Store(records.slice(0, 3), []);
  const active = nextPeriod(records.at(-1).issueNumber);
  const { runtime, coordinator } = session(store, active);
  await coordinator.onSettledPeriod();
  store.records.push(records[4]);
  const waiting = await coordinator.onSettledPeriod({ period: records[4].issueNumber });
  assert.equal(waiting.status, 'waiting_for_history');
  assert.equal(waiting.pendingPeriod, records[3].issueNumber);
  assert.equal(waiting.adaptiveBlocked, true);
  assert.equal(runtime.engine.predictionIndex, 3);
  store.records.push(records[3]);
  const ready = await coordinator.onSettledPeriod({ period: records[3].issueNumber });
  assert.equal(ready.status, 'ready');
  assert.equal(runtime.engine.history.length, 5);
});

test('restart and recovery work without any T7 row', async () => {
  const records = recordsFrom(0, 10);
  const store = new Store(records, []);
  const active = nextPeriod(records.at(-1).issueNumber);
  const first = session(store, active);
  await first.coordinator.onSettledPeriod();
  const checkpoint = structuredClone(first.runtime.engine.checkpoint());
  const restarted = session(store, active);
  const body = await restarted.coordinator.onSettledPeriod();
  assert.equal(body.status, 'ready');
  assert.equal(body.totalPredictions, records.length);
  assert.deepEqual(restarted.runtime.engine.history, first.runtime.engine.history);
  assert.deepEqual(restarted.runtime.engine.checkpoint(), checkpoint);
});
