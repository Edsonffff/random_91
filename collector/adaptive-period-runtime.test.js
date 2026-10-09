import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptivePeriodRuntime, PERIOD_STATUS, classifyPeriod } from './adaptive-period-runtime.js';
import { nextPeriod } from './adaptive-runtime.js';

const firstPeriod = '20261009100050001';
const secondPeriod = nextPeriod(firstPeriod);
const record = (period, number) => ({ issueNumber: period, winningNumber: number, createdAt: '2026-10-09T00:00:30Z', sourceTime: '2026-10-09T00:00:30Z' });
const signal = (period, number) => ({ period_id: period, signal: number >= 5 ? 'BIG' : 'SMALL', status: 'win', actual_number: number, settled_at: '2026-10-09T00:00:30Z' });

test('classifies pending actuals separately from finalized low-signal periods', () => {
  assert.equal(classifyPeriod(firstPeriod, { record: null }, { t3pred: 'Big', t7pred: 'Small' }).status, PERIOD_STATUS.PENDING_RESULT);
  assert.equal(classifyPeriod(firstPeriod, { record: record(firstPeriod, 6) }, { t3pred: 'Big' }).status, PERIOD_STATUS.PERMANENTLY_SKIPPED);
  assert.equal(classifyPeriod(firstPeriod, { record: record(firstPeriod, 6) }, { t3pred: 'Big', t9pred: 'Small' }).status, PERIOD_STATUS.ELIGIBLE);
});

class Store {
  constructor(records, inputs) { this.records = records; this.inputs = inputs; this.saved = null; }
  async loadCheckpointRecord() { return this.saved; }
  async saveCheckpoint(state) { this.saved = { state: structuredClone(state), updatedAt: new Date().toISOString() }; }
  async historyAfter(cursor = null) { return { records: this.records.filter((row) => !cursor || BigInt(row.issueNumber) > BigInt(cursor)), count: this.records.length }; }
  async signalsSince() { return { signals: Object.values(this.inputs).map((input) => input.signal).filter(Boolean), through: null }; }
  async periodInputs(period) { return structuredClone(this.inputs[period] ?? { record: null, signal: null }); }
}

test('pending period remains retryable while later finalized eligible period is evaluated', async () => {
  const first = record(firstPeriod, 6);
  const second = record(secondPeriod, 2);
  const store = new Store([first, second], {
    [firstPeriod]: { record: null, signal: signal(firstPeriod, 6) },
    [secondPeriod]: { record: second, signal: signal(secondPeriod, 2) },
  });
  const runtime = new AdaptivePeriodRuntime(store, { currentIssue: async () => null });
  const body = await runtime.advance({ periods: [firstPeriod, secondPeriod] });
  assert.equal(body.status, 'ready');
  assert.equal(body.pendingResultCount, 1);
  assert.equal(body.latestEvaluatedPeriod, secondPeriod);
  assert.equal(body.recentPeriodStates.find((state) => state.period === firstPeriod).status, PERIOD_STATUS.PENDING_RESULT);
  assert.equal(body.recentPeriodStates.find((state) => state.period === secondPeriod).status, PERIOD_STATUS.EVALUATED);
  const weights = [...runtime.engine.weights];
  const retried = await runtime.advance({ periods: [firstPeriod] });
  assert.deepEqual(runtime.engine.weights, weights);
  assert.equal(retried.pendingResultCount, 1);
});

test('finalized period with fewer than two signals is permanently skipped and survives restart', async () => {
  const row = record(firstPeriod, 6);
  const store = new Store([row], { [firstPeriod]: { record: row, signal: null } });
  const runtime = new AdaptivePeriodRuntime(store, { currentIssue: async () => null });
  const first = await runtime.advance({ periods: [firstPeriod] });
  assert.equal(first.permanentlySkippedCount, 1);
  assert.equal(first.totalPredictions, 0);
  const restarted = new AdaptivePeriodRuntime(store, { currentIssue: async () => null });
  const second = await restarted.advance();
  assert.equal(second.permanentlySkippedCount, 1);
  assert.equal(second.totalPredictions, 0);
  assert.equal(store.saved.state.periods[0].status, PERIOD_STATUS.PERMANENTLY_SKIPPED);
});
