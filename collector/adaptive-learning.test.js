import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveLearningEngine, InputRevisionError } from './adaptive-learning.js';
import { AdaptiveLearningStore, browserHistoryRecord } from './adaptive-learning-store.js';
import { createClient } from '@supabase/supabase-js';
import { validateDataset } from './validate-adaptive-learning.mjs';
import { scheduledStartFromIssue } from './adaptive-algorithms.generated.js';

function fixture() {
  const records = [];
  const signals = [];
  let seed = 12345;
  for (const date of ['20260928', '20260929']) {
    for (let position = 1; position <= 85; position++) {
      if (position === 53) continue; // CPL-3 resets streak context at sequence gaps.
      seed = (1664525 * seed + 1013904223) >>> 0;
      const issueNumber = `${date}10005${String(position).padStart(4, '0')}`;
      const createdAt = new Date(scheduledStartFromIssue(issueNumber) + (position % 11 === 0 ? 180_000 : 30_000)).toISOString();
      records.push({ issueNumber, winningNumber: seed % 10, createdAt, sourceTime: createdAt });
      if (position % 4 !== 0) signals.push({ period_id: issueNumber, signal: seed % 3 === 0 ? 'BIG' : 'SMALL', confidence: 70, fetched_at: createdAt });
    }
  }
  return { records, signals };
}

test('exact browser parity: every settlement, active samples, gaps, date reset, timestamp gate and missing signals', () => {
  const { records, signals } = fixture();
  const { report } = validateDataset(records, signals);
  for (const count of Object.values(report.signalsEvaluated)) assert.ok(count > 0, 'Fixture must exercise every actual signal');
});

test('restart reconstructs weights/streaks/audit and continues exactly; duplicate input never learns twice', () => {
  const { records, signals } = fixture();
  const original = new AdaptiveLearningEngine();
  original.setSignals(signals);
  for (const record of records.slice(0, 70)) original.settle(record);
  original.predict((BigInt(records[69].issueNumber) + 1n).toString());
  const checkpoint = JSON.parse(JSON.stringify(original.checkpoint()));
  const restarted = new AdaptiveLearningEngine();
  restarted.setSignals(signals);
  for (const record of records.slice(0, 70)) restarted.settle(record);
  restarted.verifyRecovery(checkpoint);
  assert.deepStrictEqual(restarted.current(), original.current());
  assert.deepStrictEqual([...restarted.firstPredictions], [...original.firstPredictions]);
  assert.equal(restarted.settle(records[69]), false);
  for (const record of records.slice(70)) {
    const left = restarted.settle(record);
    const right = original.settle(record);
    assert.deepStrictEqual(left, right);
    assert.deepStrictEqual(restarted.weights, original.weights);
  }
  assert.deepStrictEqual(restarted.history, original.history);
  const response = restarted.current();
  assert.equal('history' in response, false);
  assert.equal('records' in response, false);
  assert.ok(JSON.stringify(response).length < 6000);
});

test('changed evaluated inputs and corrupt recovery fail explicitly', () => {
  const { records, signals } = fixture();
  const engine = new AdaptiveLearningEngine();
  engine.setSignals(signals);
  engine.settle(records[0]);
  const original = signals[0];
  assert.throws(() => engine.setSignals([{ ...original, signal: original.signal === 'BIG' ? 'SMALL' : 'BIG' }]), InputRevisionError);
  assert.throws(() => engine.settle({ ...records[0], winningNumber: (records[0].winningNumber + 1) % 10 }), InputRevisionError);
  assert.throws(() => engine.verifyRecovery({ ...engine.checkpoint(), weights: [1, 0, 0] }), InputRevisionError);
});

test('Supabase mapping retains browser availability timestamps rather than collector source_time', () => {
  const row = { issue_number: '20260928100050001', number: '7', created_at: '2026-09-28T00:00:30Z', source_time: '2026-09-28T00:10:00Z' };
  assert.deepStrictEqual(browserHistoryRecord(row), {
    issueNumber: row.issue_number, winningNumber: 7, createdAt: row.created_at, sourceTime: row.created_at,
  });
});

test('Supabase adapter pages history/signals, reads only new rows, and surfaces failed durable writes', async () => {
  const database = {
    real_wingo_30s_history: Array.from({ length: 1003 }, (_, i) => ({
      game_code: 'WinGo_30S', issue_number: String(20261004100050000n + BigInt(i)),
      number: i % 10, created_at: '2026-10-04T00:00:00Z',
    })),
    wingo_t7_signals: [],
    wingo_adaptive_checkpoints: [],
  };
  const requests = [];
  let failWrite = false;
  const client = createClient('https://fixture.invalid', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, options) => {
      const url = new URL(input);
      const table = url.pathname.split('/').at(-1);
      requests.push({ table, method: options.method, search: url.search });
      if (options.method === 'POST') {
        assert.equal(table, 'wingo_adaptive_checkpoints', 'Adapter must never write to history/T7');
        if (failWrite) return new Response(JSON.stringify({ message: 'simulated persistence outage' }), { status: 503 });
        database[table] = [JSON.parse(options.body)];
        return new Response(null, { status: 201 });
      }
      let rows = database[table];
      for (const [key, filter] of url.searchParams) {
        if (['select', 'order', 'offset', 'limit'].includes(key)) continue;
        const [operator, ...parts] = filter.split('.');
        const value = parts.join('.');
        rows = rows.filter((row) => operator === 'eq' ? row[key] === value
          : operator === 'gt' ? row[key] > value : operator === 'gte' ? row[key] >= value : row[key] <= value);
      }
      const count = rows.length;
      const order = url.searchParams.get('order');
      if (order) {
        rows = [...rows].sort((a, b) => {
          for (const column of order.split(',')) {
            const [key, direction] = column.split('.');
            const comparison = String(a[key]).localeCompare(String(b[key]));
            if (comparison) return direction === 'desc' ? -comparison : comparison;
          }
          return 0;
        });
      }
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = Number(url.searchParams.get('limit') || rows.length);
      rows = rows.slice(offset, offset + limit);
      return new Response(options.method === 'HEAD' ? null : JSON.stringify(rows), {
        status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': `0-${Math.max(0, count - 1)}/${count}` },
      });
    } },
  });
  const store = new AdaptiveLearningStore(client);
  assert.equal(await store.loadCheckpoint(), null);
  const bootstrap = await store.historyAfter();
  assert.equal(bootstrap.records.length, 1003);
  assert.equal(bootstrap.count, 1003);
  const delta = await store.historyAfter(bootstrap.records[999].issueNumber);
  assert.equal(delta.records.length, 3);
  const since = '2026-10-04T00:00:00.000Z';
  assert.equal((await store.signalsSince(since)).through, since, 'Empty poll must not skip an in-flight older write');
  database.wingo_t7_signals = Array.from({ length: 1003 }, (_, i) => ({
    period_id: bootstrap.records[i].issueNumber, signal: 'BIG', stored_at: since,
  }));
  const changed = await store.signalsSince(since);
  assert.equal(changed.signals.length, 1003, 'Equal timestamp pages must retain every period');
  assert.equal(changed.through, since);
  const checkpoint = { period: bootstrap.records.at(-1).issueNumber, weights: [0.1, 0.3, 0.6] };
  await store.saveCheckpoint(checkpoint);
  assert.deepStrictEqual(await store.loadCheckpoint(), checkpoint);
  failWrite = true;
  await assert.rejects(store.saveCheckpoint({ period: 'next' }), /simulated persistence outage/);
  assert.deepStrictEqual(await store.loadCheckpoint(), checkpoint);
  assert.ok(requests.some((r) => r.search.includes('gt.')));
});
