import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceVerifiedStreak, calculateVerifiedMaxLoss, historyGap, scoreVerifiedT7 } from './verified-max-loss.js';
import { computeTest3, computeTest7, evaluateWalkForward, runCpl3WalkForward, CPL3_CONFIGS, calculateLossStreakMetrics, scheduledStartFromIssue } from './adaptive-algorithms.generated.js';
import { verifiedBaselineFixture } from './fixtures/verified-max-loss-baseline.js';
import { finalizedT7 } from './adaptive-runtime.js';

const record = (position, winningNumber = 6) => {
  const issueNumber = String(20261002100050001n + BigInt(position));
  const createdAt = new Date(scheduledStartFromIssue(issueNumber) + 30_000).toISOString();
  return { issueNumber, winningNumber, createdAt, sourceTime: createdAt };
};
const signal = (row, prediction = 'SMALL') => ({ period_id: row.issueNumber, signal: prediction, status: 'pending', source: 'server', settled_at: null, actual_number: null });

for (const [name, current, outcome, expectedCurrent, expectedMax] of [
  ['A: loss establishes a new record', 12, 'LOSS', 13, 13],
  ['B: win preserves the record', 12, 'WIN', 0, 12],
  ['C: smaller loss streak preserves the record', 5, 'LOSS', 6, 12],
]) {
  test(name, () => {
    const state = { currentLossStreak: current, longestLossStreak: 12 };
    advanceVerifiedStreak(state, outcome);
    assert.equal(state.currentLossStreak, expectedCurrent);
    assert.equal(state.longestLossStreak, expectedMax);
  });
}

test('D/G: missing T7 prediction is UNKNOWN and does not count as a loss', async () => {
  const rows = Array.from({ length: 6 }, (_, index) => record(index));
  const signals = rows.filter((_, index) => index !== 3).map((row) => signal(row));
  assert.equal(scoreVerifiedT7(rows[3], undefined), 'UNKNOWN');
  const metric = await calculateVerifiedMaxLoss(rows, signals);
  assert.equal(metric.test7, 5);
  assert.equal(metric.tests.test7.currentLossStreak, 5);
  assert.equal(metric.tests.test7.unknownPeriods, 1);
  assert.equal(metric.coverage, 'partial');
  assert.equal(metric.knownThrough, null, 'No overall known-through is claimed when a test has no scorable predictions yet');
});

test('E/F: the original T7 scorer classifies SMALL/6 as LOSS and BIG/6 as WIN without provider finalization', () => {
  const row = record(0);
  assert.equal(scoreVerifiedT7(row, signal(row)), 'LOSS');
  assert.equal(scoreVerifiedT7(row, signal(row, 'BIG')), 'WIN');
  assert.equal(finalizedT7(signal(row), row), false, 'Statistical scoring never changes Adaptive eligibility');
});

test('all seven diagnosed periods retain their metric-only classifications without finalizing or guessing provider inputs', () => {
  const cases = [
    ['20261002100052220', 'SMALL', 6, 'LOSS'], ['20261002100052221', null, 2, 'UNKNOWN'],
    ['20261003100052220', 'BIG', 6, 'WIN'], ['20261003100052221', null, 1, 'UNKNOWN'],
    ['20261005100052220', 'SMALL', 9, 'LOSS'], ['20261005100052221', null, 0, 'UNKNOWN'],
    ['20261005100052819', 'SMALL', 0, 'WIN'],
  ];
  for (const [issueNumber, prediction, winningNumber, outcome] of cases) {
    const row = { issueNumber, winningNumber };
    const stored = prediction ? signal(row, prediction) : undefined;
    const before = structuredClone(stored);
    assert.equal(scoreVerifiedT7(row, stored), outcome);
    assert.deepEqual(stored, before);
    assert.equal(finalizedT7(stored, row), false);
  }
});

test('H: history holes are diagnosed, ignored by streaks, and do not compress T3 ordinals', async () => {
  const rows = [record(0), record(1), record(2), record(4), record(5)];
  const metric = await calculateVerifiedMaxLoss(rows, rows.map((row) => signal(row)));
  assert.equal(metric.test7, 5);
  assert.equal(metric.tests.test7.currentLossStreak, 5);
  assert.equal(metric.tests.test3.scoredPeriods, 5);
  assert.equal(metric.tests.test3.unknownPeriods, 0);
  assert.equal(metric.tests.test9.unknownPeriods, 5);
  assert.equal(metric.coverageReason, 'historical_gap');
  assert.deepEqual(historyGap('20261002100052301', '20261002100052348'), {
    lastAvailablePeriod: '20261002100052301', firstMissingHistoryPeriod: '20261002100052302',
    lastMissingHistoryPeriod: '20261002100052347', nextAvailablePeriod: '20261002100052348', missingCount: 46,
  });
  assert.equal(historyGap('20261002100052880', '20261003100050001'), null, 'Midnight is contiguous');
});

test('I/J: captured baseline records remain T3=5 T7=5 T9=6 through pending 52220; no inputs are modified', async () => {
  const fixture = verifiedBaselineFixture();
  const before = structuredClone(fixture);
  const prefix = await calculateVerifiedMaxLoss(fixture.records.slice(0, 142), fixture.signals, { baselineId: fixture.baselineId });
  const target = await calculateVerifiedMaxLoss(fixture.records, fixture.signals, { baselineId: fixture.baselineId });
  for (const name of ['test3', 'test7', 'test9']) assert.equal(prefix[name], target[name]);
  assert.deepEqual([target.test3, target.test7, target.test9], [5, 5, 6]);
  assert.equal(prefix.tests.test7.currentLossStreak, 0);
  assert.equal(target.tests.test7.currentLossStreak, 1);
  assert.equal(target.knownThrough, '20261002100052220');
  assert.equal(target.coverage, 'partial', 'Baseline-scoped records are not claimed as fully verified global all-time');
  assert.deepEqual(fixture, before);
  assert.equal(finalizedT7(fixture.signals.at(-1), fixture.records.at(-1)), false);
});

test('existing T3/T7/T9 scoring is identical on a complete contiguous input and cached T9 uses exact context', async () => {
  const records = Array.from({ length: 60 }, (_, index) => record(index, (index * 7 + 3) % 10));
  const signals = records.map((row, index) => signal(row, index % 2 ? 'SMALL' : 'BIG'));
  const dataset = records.map((row) => ({ period: row.issueNumber, number: row.winningNumber }));
  const config = CPL3_CONFIGS.find((item) => item.name === 'context-8-cap-3');
  const originalT9 = calculateLossStreakMetrics(runCpl3WalkForward(evaluateWalkForward(records), config));
  const cplCache = new Map();
  const result = await calculateVerifiedMaxLoss(records, signals, { cplCache });
  assert.equal(result.test3, computeTest3(dataset).longestMissStreak);
  assert.equal(result.test7, computeTest7(dataset, new Map(signals.map((row) => [row.period_id, row]))).longestMissStreak);
  assert.equal(result.test9, originalT9.longestLossStreak);
  const cached = await calculateVerifiedMaxLoss(records, signals, { cplCache });
  assert.deepEqual(cached.tests, result.tests);
  const unordered = await calculateVerifiedMaxLoss([...records].reverse(), signals, { cplCache });
  assert.deepEqual(unordered.tests, result.tests, 'Chronological scope is established after sorting');
  // A revised availability/input prefix invalidates the cached predictions.
  const revised = records.map((row, index) => index === 22 ? { ...row, winningNumber: 9 } : row);
  const reused = await calculateVerifiedMaxLoss(revised, signals, { cplCache });
  const fresh = await calculateVerifiedMaxLoss(revised, signals);
  assert.deepEqual(reused.tests, fresh.tests);
});
