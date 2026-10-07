import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectT7StreamGaps,
  isFinalizedT7Entry,
  normalizeT7Entry,
  T7Diagnostics,
} from './t7-monitoring.js';
import { sameInstant, T7IngestionLedger } from './t7-ingestion.js';

const entry = (period, status = 'pending', actualNumber = null) => ({
  period_id: period,
  signal: 'SMALL',
  status,
  source: 'server',
  actual_number: actualNumber,
  settled_at: status === 'pending' ? null : '2026-10-02T18:30:00.000Z',
});

function ledgerFixture(initial = []) {
  const cache = new Map(initial.map((row) => [row.period_id, structuredClone(row)]));
  const persisted = [];
  const observations = [];
  const operations = [];
  const ledger = new T7IngestionLedger({
    cache,
    loadExisting: async (period) => cache.get(period) ?? null,
    persist: async (row) => { persisted.push(structuredClone(row)); cache.set(row.period_id, { ...cache.get(row.period_id), ...row }); },
    observe: async (row) => observations.push(structuredClone(row)),
    onStored: async (operation) => operations.push(operation),
  });
  return { ledger, cache, persisted, observations, operations };
}

test('normalizes prediction and history entries without deriving any T7 fields', () => {
  const normalized = normalizeT7Entry({
    issue: '20261002100052220', size: 'small', confidence: '72', status: 'PENDING',
    source: 'server', createdAt: 1790965772016,
  });
  assert.deepEqual(normalized, {
    period_id: '20261002100052220', signal: 'SMALL', confidence: 72,
    color: null, status: 'pending', source: 'server', algorithm_version: null,
    guard_applied: null, actual_number: null, actual_color: null,
    size_hit: null, color_hit: null, settled_at: null,
    prediction_created_at: '2026-10-02T18:29:32.016Z',
  });
});

test('finalization requires valid status, actual number and settlement time', () => {
  assert.equal(isFinalizedT7Entry(entry('20261002100052220')), false);
  assert.equal(isFinalizedT7Entry(entry('20261002100052220', 'win', 6)), true);
  assert.equal(isFinalizedT7Entry({ ...entry('20261002100052220', 'win', 6), settled_at: null }), false);
});

test('provider history gaps are diagnosed without creating synthetic rows', () => {
  const entries = [
    entry('20261002100052220', 'win', 6),
    entry('20261002100052219', 'win', 2),
    entry('20261002100052218', 'win', 5),
    entry('20261002100052216', 'win', 4),
  ];
  const gaps = detectT7StreamGaps(entries, '2026-10-07T00:00:00.000Z');
  assert.deepEqual(gaps.map((gap) => gap.period), ['20261002100052217']);
  assert.equal(gaps[0].resolved, false);
});

test('pending diagnostics track repeats, finalization, and provider-window expiration', () => {
  const diagnostics = new T7Diagnostics();
  diagnostics.seedPending({
    period_id: '20261002100052220', signal: 'SMALL', status: 'pending',
    prediction_created_at: '2026-10-02T18:29:32.016Z', stored_at: '2026-10-02T18:29:35.536Z',
  });
  diagnostics.observeEntry(entry('20261002100052220'), '2026-10-02T18:30:00.000Z');
  assert.equal(diagnostics.status().pending[0].lastSeenAt, '2026-10-02T18:30:00.000Z');
  diagnostics.expirePending('20261007100051919', '20261007100051998', '2026-10-07T00:00:00.000Z');
  assert.equal(diagnostics.status().expiredPending[0].state, 'provider_window_expired');

  diagnostics.observeEntry(entry('20261002100052220', 'win', 6), '2026-10-07T00:01:00.000Z');
  assert.equal(diagnostics.status().expiredPending.length, 0, 'A later exact settlement resolves the expiry state');
  assert.equal(diagnostics.pending.get('20261002100052220').state, 'resolved');
});

test('a returned missing period resolves only its diagnostic, never fabricates a T7 row', () => {
  const diagnostics = new T7Diagnostics();
  diagnostics.observeHistory([
    entry('20261002100052218', 'win', 5),
    entry('20261002100052216', 'win', 4),
  ], '2026-10-07T00:00:00.000Z');
  assert.equal(diagnostics.status().gaps[0].period, '20261002100052217');
  diagnostics.observeHistory([entry('20261002100052217', 'win', 7)], '2026-10-07T00:01:00.000Z');
  assert.equal(diagnostics.status().gaps.length, 0);
  assert.equal(diagnostics.pending.has('20261002100052217'), false);
});

test('every prediction and history entry is persisted, while duplicate predictions are idempotent', async () => {
  const fixture = ledgerFixture();
  const prediction = entry('20261002100052220');
  await fixture.ledger.ingest(prediction, 10, 'prediction');
  await fixture.ledger.ingest(prediction, 10, 'prediction');
  await fixture.ledger.ingest(entry('20261002100052219', 'pending'), 10, 'history');
  assert.equal(fixture.persisted.length, 2);
  assert.equal(fixture.cache.size, 2);
  assert.equal(fixture.operations.filter((operation) => operation.operation === 'inserted').length, 2);
});

test('pending T7 finalizes from an exact upstream settlement and preserves earliest creation time', async () => {
  const initial = { ...entry('20261002100052220'), prediction_created_at: '2026-10-02T18:29:32.016Z', fetched_at: '2026-10-02T18:29:32.016Z', stored_at: '2026-10-02T18:29:35.536Z' };
  const fixture = ledgerFixture([initial]);
  await fixture.ledger.ingest({ ...entry('20261002100052220', 'win', 6), prediction_created_at: '2026-10-02T18:30:00.000Z' }, 10, 'history');
  const final = fixture.cache.get('20261002100052220');
  assert.equal(final.status, 'win');
  assert.equal(final.actual_number, 6);
  assert.equal(final.prediction_created_at, '2026-10-02T18:29:32.016Z');
  assert.equal(fixture.operations.at(-1).operation, 'updated');
});

test('finalized T7 is immutable and conflicting upstream finalization is rejected', async () => {
  const finalized = entry('20261002100052220', 'win', 6);
  const fixture = ledgerFixture([finalized]);
  await fixture.ledger.ingest(finalized, 10, 'history');
  await assert.rejects(
    fixture.ledger.ingest(entry('20261002100052220', 'loss', 7), 10, 'history'),
    /T7 finalized input conflict/,
  );
  assert.equal(fixture.persisted.length, 0);
  assert.equal(fixture.cache.get('20261002100052220').actual_number, 6);
});

const storedFinalized = () => ({
  ...entry('20261007100052059', 'loss', 7),
  settled_at: '2026-10-07T17:09:31.941+00:00',
  prediction_created_at: '2026-10-07T17:09:02.052+00:00',
  fetched_at: '2026-10-07T17:09:02.052+00:00',
  stored_at: '2026-10-07T17:09:42.35+00:00',
});

test('timestamp equality accepts Z and +00:00 for the same instant, but rejects changed or invalid instants', () => {
  assert.equal(sameInstant('2026-10-07T17:09:31.941Z', '2026-10-07T17:09:31.941+00:00'), true);
  assert.equal(sameInstant('2026-10-07T17:09:31.941+00:00', '2026-10-07T17:09:31.941Z'), true);
  assert.equal(sameInstant('2026-10-07T17:09:31.941Z', '2026-10-07T17:09:31.942Z'), false);
  assert.equal(sameInstant(null, null), true);
  assert.equal(sameInstant(undefined, undefined), true);
  assert.equal(sameInstant(null, undefined), false);
  assert.equal(sameInstant(null, '2026-10-07T17:09:31.941Z'), false);
  assert.equal(sameInstant('invalid', 'invalid'), false);
});

test('a finalized repeat with differently formatted settlement and creation timestamps performs no write', async () => {
  const stored = storedFinalized();
  const fixture = ledgerFixture([stored]);
  const incoming = {
    ...stored,
    settled_at: '2026-10-07T17:09:31.941Z',
    prediction_created_at: '2026-10-07T17:09:02.052Z',
  };
  await fixture.ledger.ingest(incoming, 10, 'history');
  await fixture.ledger.ingest(incoming, 10, 'history');
  assert.equal(fixture.persisted.length, 0);
  assert.equal(fixture.operations.length, 0);
  assert.equal(fixture.observations.length, 2);
  assert.deepEqual(fixture.cache.get(stored.period_id), stored, 'Original stored values and timestamps are preserved');
});

test('a different finalized settlement instant remains an integrity conflict without a write', async () => {
  const stored = storedFinalized();
  const fixture = ledgerFixture([stored]);
  await assert.rejects(fixture.ledger.ingest({
    ...stored,
    settled_at: '2026-10-07T17:09:31.942Z',
  }, 10, 'history'), /T7 finalized input conflict/);
  assert.equal(fixture.persisted.length, 0);
  assert.equal(fixture.operations.length, 0);
  assert.deepEqual(fixture.cache.get(stored.period_id), stored);
});

for (const [field, value] of Object.entries({ signal: 'BIG', status: 'win', actual_number: 8, source: 'other-provider' })) {
  test(`a different finalized ${field} remains an integrity conflict despite equivalent timestamp formatting`, async () => {
    const stored = storedFinalized();
    const fixture = ledgerFixture([stored]);
    await assert.rejects(fixture.ledger.ingest({
      ...stored,
      settled_at: '2026-10-07T17:09:31.941Z',
      prediction_created_at: '2026-10-07T17:09:02.052Z',
      [field]: value,
    }, 10, 'history'), /T7 finalized input conflict/);
    assert.equal(fixture.persisted.length, 0);
    assert.equal(fixture.operations.length, 0);
    assert.deepEqual(fixture.cache.get(stored.period_id), stored);
  });
}

test('a finalized record never regresses when the provider repeats a pending prediction', async () => {
  const stored = storedFinalized();
  const fixture = ledgerFixture([stored]);
  await fixture.ledger.ingest({
    ...stored,
    status: 'pending',
    settled_at: null,
    actual_number: null,
    prediction_created_at: '2026-10-07T17:09:02.052Z',
  }, 10, 'prediction');
  assert.equal(fixture.persisted.length, 0);
  assert.equal(fixture.operations.length, 0);
  assert.deepEqual(fixture.cache.get(stored.period_id), stored);
});
