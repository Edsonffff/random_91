import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HISTORY_GAP,
  UNRESOLVED_T7_PERIODS,
  buildHistoryPeriodReports,
  buildT7PeriodReports,
  normalizeBdgTharuPayload,
  normalizeOfficialHistoryPayload,
  periodRange,
  sourceMatch,
  summarizeReports,
} from './historical-recovery-audit.js';

test('periodRange enumerates every period in the known 46-period gap', () => {
  const periods = periodRange(HISTORY_GAP.firstMissingPeriod, HISTORY_GAP.lastMissingPeriod);
  assert.equal(periods.length, 46);
  assert.equal(periods[0], HISTORY_GAP.firstMissingPeriod);
  assert.equal(periods.at(-1), HISTORY_GAP.lastMissingPeriod);
});

test('history report does not treat repository fixture text as authoritative', () => {
  const reports = buildHistoryPeriodReports(['1', '2'], new Map([
    ['1', [sourceMatch('repository:fixture.js', 7, { period: '1' })]],
    ['2', [sourceMatch('official', 3, { period: '2', authoritative: true, independentlyVerifiable: true })]],
  ]), new Map([['1', [{ file: 'fixture.js' }]], ['2', []]]));
  assert.equal(reports[0].recoverable, false);
  assert.equal(reports[1].recoverable, true);
  assert.deepEqual(summarizeReports(reports), {
    total: 2, recoverableCount: 1, unrecoverableCount: 1,
    recoverablePeriods: ['2'], unrecoverablePeriods: ['1'],
  });
});

test('T7 report separates stored prediction recovery from finalized settlement recovery', () => {
  const stored = new Map([['a', { period: 'a', signal: 'SMALL', status: 'pending', raw: { period_id: 'a' } }]]);
  const reports = buildT7PeriodReports(['a', 'b'], stored, new Map([
    ['a', [sourceMatch('supabase', null, { period: 'a', signal: 'SMALL', authoritative: true })]],
    ['b', []],
  ]));
  assert.equal(reports[0].predictionExists, true);
  assert.equal(reports[0].recoverable, true);
  assert.equal(reports[0].completeFinalizedRecovery, false);
  assert.equal(reports[0].safeToRepair, false);
  assert.equal(reports[1].predictionExists, false);
  assert.equal(reports[1].recoverable, false);
});

test('provider parsers only accept the existing response shapes', () => {
  assert.deepEqual(normalizeOfficialHistoryPayload({ data: { list: [{ issueNumber: 'x', number: 8 }] } }), [{
    period: 'x', winningNumber: 8, size: 'Big', sourceTime: null,
  }]);
  assert.deepEqual(normalizeBdgTharuPayload({ prediction: { issue: 'a', size: 'small' }, history: [{ issue: 'b', size: 'BIG' }] })
    .map((entry) => [entry.period, entry.signal]), [['a', 'SMALL'], ['b', 'BIG']]);
  assert.deepEqual(normalizeBdgTharuPayload({}), []);
  assert.equal(UNRESOLVED_T7_PERIODS.length, 7);
});
