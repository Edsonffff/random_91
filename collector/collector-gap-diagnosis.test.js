import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveCoordinator } from './adaptive-coordinator.js';
import {
  REPRESENTATIVE_GAPS, createReadOnlyTransport, describeGap, outageLossBounds,
  summarizeGapEvidence, summarizeWindow, windowLoss,
} from './collector-gap-diagnosis.js';

test('reported gaps have exact sizes, including the real midnight sequence', () => {
  const gaps = REPRESENTATIVE_GAPS.map((gap) => describeGap(gap, 10));
  assert.deepEqual(gaps.map((gap) => gap.missingCount), [46, 69, 307, 588]);
  const midnight = gaps[3];
  assert.equal(midnight.firstMissing, '20261007100052313');
  assert.equal(midnight.lastMissing, '20261008100050020');
  assert.equal(midnight.missingPeriods[567], '20261007100052880');
  assert.equal(midnight.missingPeriods[568], '20261008100050001');
  assert.equal(new Set(midnight.missingPeriods).size, 588);
  assert.deepEqual(gaps.map((gap) => gap.windowOverflowModel.inferredSuccessToSuccessSeconds), [1680, 2370, 9510, 17940]);
});

test('rolling windows cover short capture outages but have no unbounded protection', () => {
  assert.equal(windowLoss(10, 10).permanentlyMissedWithoutArchive, 0);
  assert.equal(windowLoss(11, 10).permanentlyMissedWithoutArchive, 1);
  assert.equal(windowLoss(120, 10).permanentlyMissedWithoutArchive, 110);
  const bounds = outageLossBounds(301, 10);
  assert.equal(bounds.minimum.permanentlyMissedWithoutArchive, 0);
  assert.equal(bounds.maximum.permanentlyMissedWithoutArchive, 1);
  assert.equal(summarizeWindow(['20261007100052880', '20261008100050001']).consecutive, true);
  assert.equal(summarizeWindow(['20261007100052880', '20261008100050002']).consecutive, false);
});

test('read-only transport rejects writes and request-body bypasses before fetch', async () => {
  let networkCalls = 0;
  const { readOnlyFetch, operations } = createReadOnlyTransport(async () => { networkCalls++; return Response.json({}); });
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    await assert.rejects(readOnlyFetch('https://fixture.invalid', { method }), /refused non-read/);
  }
  await assert.rejects(readOnlyFetch(new Request('https://fixture.invalid', { method: 'POST', body: '{}' })), /refused non-read/);
  await assert.rejects(readOnlyFetch('https://fixture.invalid', { method: 'GET', body: '{}' }), /refused non-read/);
  assert.equal(networkCalls, 0);
  await readOnlyFetch('https://fixture.invalid');
  await readOnlyFetch('https://fixture.invalid', { method: 'HEAD' });
  assert.deepEqual(operations.methods, { GET: 1, HEAD: 1 });
});

test('T7 row creation evidence does not confuse late stored prediction timestamps with continuous capture', () => {
  const gap = describeGap(REPRESENTATIVE_GAPS[0]);
  const period = gap.firstMissing;
  const during = '2026-10-02T19:11:05.000Z';
  const late = '2026-10-08T00:00:00.000Z';
  const evidence = summarizeGapEvidence(gap, [], [{ period_id: period, fetched_at: during, created_at: late, stored_at: late }]);
  assert.equal(evidence.t7InsideHistoryGap.rowsCreatedDuringScheduledGap, 0);
  const continuous = summarizeGapEvidence(gap, [], [{ period_id: period, created_at: during, stored_at: late }]);
  assert.equal(continuous.t7InsideHistoryGap.rowsCreatedDuringScheduledGap, 1);
  assert.equal(continuous.missingHistoryStillAbsent, true);
});

test('actual coordinator retains a failed captured batch after source expiry, but a fresh process has no pending batch', async () => {
  const durable = new Set();
  const seen = new Set();
  let failing = true;
  const runtime = { advance: async () => ({ success: true, status: 'ready' }) };
  const collector = new AdaptiveCoordinator(runtime);
  const captured = ['20261007100052880', '20261008100050001'];
  const writeCaptured = async () => {
    for (const period of captured) {
      if (seen.has(period)) continue;
      if (failing) throw new Error('DB unavailable');
      durable.add(period);
      seen.add(period);
    }
  };
  await assert.rejects(collector.ingest(writeCaptured, 'history'), /DB unavailable/);
  assert.equal(seen.size, 0, 'Failed rows must not become seen');
  assert.equal(collector.pendingWrites.get('history').length, 1);
  const restarted = new AdaptiveCoordinator(runtime);
  assert.equal(restarted.pendingWrites.size, 0, 'Pending response closures are not durable across a fresh instance');
  await restarted.onSettledPeriod();
  assert.equal(durable.size, 0);
  failing = false;
  await collector.onSettledPeriod();
  assert.deepEqual([...durable], captured, 'Surviving process retries the original response without another upstream response');
  assert.equal(collector.pendingWrites.size, 0);
});
