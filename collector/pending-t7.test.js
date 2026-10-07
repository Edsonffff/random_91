import test from 'node:test';
import assert from 'node:assert/strict';
import { finalizedT7 } from './adaptive-runtime.js';

const record = { issueNumber: '20261002100050850', winningNumber: 6 };

test('the live pending period is unavailable when no durable T7 row exists', () => {
  assert.equal(finalizedT7(null, record), false);
});

test('modern T7 rows require a finalized status, settlement timestamp, and matching actual number', () => {
  const base = { period_id: record.issueNumber, signal: 'SMALL', source: 'server' };
  assert.equal(finalizedT7({ ...base, status: 'pending' }, record), false);
  assert.equal(finalizedT7({ ...base, status: 'win', settled_at: record.createdAt, actual_number: 5 }, record), false);
  assert.equal(finalizedT7({ ...base, status: 'win', settled_at: '2026-10-02T07:09:00Z', actual_number: 6 }, record), true);
});

test('legacy rows remain usable only when they carry the legacy null metadata shape', () => {
  assert.equal(finalizedT7({ period_id: record.issueNumber, signal: 'SMALL' }, record), true);
  assert.equal(finalizedT7({ period_id: record.issueNumber, signal: 'SMALL', status: 'pending' }, record), false);
});
