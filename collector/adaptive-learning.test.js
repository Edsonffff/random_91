import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveLearningEngine, InputRevisionError, PREVIOUS_T3_FINGERPRINT } from './adaptive-learning.js';
import { AdaptiveLearningStore, browserHistoryRecord } from './adaptive-learning-store.js';
import { isLateT7Checkpoint, recoverLateT7Checkpoint, settleReadyHistory } from './adaptive-learning-worker.js';
import { createClient } from '@supabase/supabase-js';
import { validateDataset } from './validate-adaptive-learning.mjs';
import { scheduledStartFromIssue, computeTest3, TEST3_SEQUENCE } from './adaptive-algorithms.generated.js';

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

test('exact browser parity and independent T3/T7/T9 max loss: settlements, active samples, gaps, dates and missing signals', () => {
  const { records, signals } = fixture();
  const { report } = validateDataset(records, signals);
  for (const count of Object.values(report.signalsEvaluated)) assert.ok(count > 0, 'Fixture must exercise every actual signal');
});

test('Test 3 repeats the exact 14-round sequence from the first round; active polls and duplicates never advance it', () => {
  const expected = ['Small', 'Big', 'Small', 'Big', 'Small', 'Small', 'Big', 'Small', 'Big', 'Big', 'Small', 'Big', 'Small', 'Small'];
  assert.deepEqual(TEST3_SEQUENCE, expected);
  const { records } = fixture();
  const engine = new AdaptiveLearningEngine();
  engine.predict(records[0].issueNumber);
  assert.equal(engine.activeSignals.t3pred, 'Small');
  const rounds = records.slice(0, 43).map((record, i) => ({ ...record, winningNumber: expected[i % 14] === 'Big' ? 7 : 2 }));
  for (const [i, record] of rounds.entries()) {
    assert.equal(engine.predict(record.issueNumber), false);
    const step = engine.settle(record);
    assert.equal(step.evaluated.t3pred, expected[i % 14]);
    assert.equal(step.test3.outcome, 'HIT');
    assert.equal(engine.settle(record), false);
    assert.equal(engine.predictionIndex, i + 1);
    engine.predict(records[i + 1].issueNumber);
    assert.equal(engine.activeSignals.t3pred, expected[(i + 1) % 14]);
  }
  assert.equal(engine.current().test3MaxLoss, 0);
  const replay = computeTest3(rounds.slice().reverse().map((r) => ({ period: r.issueNumber, number: r.winningNumber })));
  assert.equal(replay.total, 43);
  assert.deepEqual(replay.details.map((row) => row.predictedSize), rounds.map((_, i) => expected[i % 14]));
  assert.equal(replay.latestPrediction, expected[43 % 14]);
});

test('Test 3 max loss counts consecutive misses across the wrap, skips no rounds, and is independent of ensemble and T7', () => {
  const { records } = fixture();
  const engine = new AdaptiveLearningEngine();
  const outcomes = 'HMHHMMMMMMHMMHHMMMMH';
  const rounds = records.slice(0, outcomes.length).map((record, i) => {
    const predicted = TEST3_SEQUENCE[i % 14];
    const actual = outcomes[i] === 'H' ? predicted : predicted === 'Big' ? 'Small' : 'Big';
    return { ...record, winningNumber: actual === 'Big' ? 7 : 2 };
  });
  // Perfect T7 explicitly separates its maximum from Test 3 and the ensemble.
  engine.setSignals(rounds.map((r) => ({ period_id: r.issueNumber, signal: r.winningNumber >= 5 ? 'BIG' : 'SMALL' })));
  for (const record of rounds) engine.settle(record);
  assert.equal(engine.current().test3MaxLoss, 6);
  assert.equal(engine.current().test7MaxLoss, 0);
  assert.notEqual(engine.current().test3MaxLoss, engine.current().longestMissStreak);
  assert.equal(computeTest3(rounds.map((r) => ({ period: r.issueNumber, number: r.winningNumber }))).longestMissStreak, 6);
  // A second run spanning positions 14 -> 1 must remain one miss streak.
  const allMiss = new AdaptiveLearningEngine();
  for (const [i, record] of records.slice(0, 29).entries()) {
    allMiss.settle({ ...record, winningNumber: TEST3_SEQUENCE[i % 14] === 'Big' ? 2 : 7 });
  }
  assert.equal(allMiss.current().test3MaxLoss, 29);
});

test('old pair-algorithm checkpoints migrate once from durable history; unknown versions and changed coverage fail', () => {
  const { records } = fixture();
  const engine = new AdaptiveLearningEngine();
  for (const record of records.slice(0, 17)) engine.settle(record);
  const before = engine.checkpoint();
  const legacy = { ...before, version: PREVIOUS_T3_FINGERPRINT, weights: [1, 0, 0], inputDigest: 'old-pair-model' };
  engine.verifyRecovery(legacy);
  assert.deepEqual(engine.checkpoint(), before);
  engine.predict(records[17].issueNumber);
  assert.equal(engine.activeSignals.t3pred, TEST3_SEQUENCE[17 % 14]);
  assert.throws(() => engine.verifyRecovery({ ...legacy, totalPredictions: 16 }), InputRevisionError);
  assert.throws(() => engine.verifyRecovery({ ...legacy, version: 'unknown-version' }), InputRevisionError);
  assert.throws(() => engine.verifyRecovery({ ...engine.checkpoint(), predictionIndex: 0 }), InputRevisionError);
  assert.throws(() => engine.verifyRecovery({ ...engine.checkpoint(), test3MaxLoss: 999 }), InputRevisionError);
});

test('restart reconstructs weights/streaks/audit and continues exactly; duplicate input never learns twice', () => {
  const { records, signals } = fixture();
  const original = new AdaptiveLearningEngine();
  original.setSignals(signals);
  for (const record of records.slice(0, 71)) original.settle(record);
  original.predict((BigInt(records[70].issueNumber) + 1n).toString());
  const checkpoint = JSON.parse(JSON.stringify(original.checkpoint()));
  const restarted = new AdaptiveLearningEngine();
  restarted.setSignals(signals);
  for (const record of records.slice(0, 71)) restarted.settle(record);
  restarted.verifyRecovery(checkpoint);
  assert.deepStrictEqual(restarted.current(), original.current());
  assert.deepStrictEqual([...restarted.firstPredictions], [...original.firstPredictions]);
  assert.equal(restarted.settle(records[70]), false);
  assert.equal(restarted.predictionIndex, 71);
  assert.equal(restarted.activeSignals.t3pred, TEST3_SEQUENCE[71 % 14]);
  for (const record of records.slice(71)) {
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

test('history before T7 stays unlearned and uncheckpointed until its exact stored signal arrives', () => {
  const { records } = fixture();
  const engine = new AdaptiveLearningEngine();
  const before = engine.checkpoint();
  assert.deepEqual(settleReadyHistory(engine, [records[0]]), { processedCount: 0, pendingPeriod: records[0].issueNumber });
  assert.deepEqual(engine.checkpoint(), before);
  assert.equal(engine.history.length, 0);
  assert.equal(engine.predictionIndex, 0);
  engine.setSignals([{ period_id: records[0].issueNumber, signal: 'BIG', confidence: 72 }]);
  assert.deepEqual(settleReadyHistory(engine, [records[0]]), { processedCount: 1, pendingPeriod: null });
  assert.equal(engine.history[0].t7pred, 'Big');
  assert.equal(engine.checkpoint().period, records[0].issueNumber);
  assert.equal(engine.checkpoint().totalPredictions, 1);
  assert.deepEqual(settleReadyHistory(engine, [records[0]]), { processedCount: 0, pendingPeriod: null });
});

test('T7 before history evaluates normally; multiple pending periods never bypass a missing predecessor', () => {
  const { records } = fixture();
  const rounds = records.slice(0, 4);
  const engine = new AdaptiveLearningEngine();
  engine.setSignals([0, 2, 3].map((i) => ({ period_id: rounds[i].issueNumber, signal: 'SMALL' })));
  assert.deepEqual(settleReadyHistory(engine, rounds), { processedCount: 1, pendingPeriod: rounds[1].issueNumber });
  const committed = engine.checkpoint();
  assert.deepEqual(settleReadyHistory(engine, rounds.slice(1)), { processedCount: 0, pendingPeriod: rounds[1].issueNumber });
  assert.deepEqual(engine.checkpoint(), committed);
  engine.setSignals([{ period_id: rounds[1].issueNumber, signal: 'BIG' }]);
  assert.deepEqual(settleReadyHistory(engine, rounds.slice(1)), { processedCount: 3, pendingPeriod: null });
  assert.deepEqual(engine.history.map((row) => row.period), rounds.map((row) => row.issueNumber));
  assert.deepEqual(engine.history.map((row) => row.t7pred), ['Small', 'Big', 'Small', 'Small']);
});

test('held tail reconstructs from the checkpoint cursor on restart and matches exact replay after asynchronous arrivals', () => {
  const { records, signals } = fixture();
  const rounds = records.slice(0, 80);
  const engine = new AdaptiveLearningEngine();
  // A pre-existing verified prefix may legitimately have historical no-signal rows.
  engine.setSignals(signals.filter((s) => s.period_id <= rounds[69].issueNumber));
  for (const row of rounds.slice(0, 70)) engine.settle(row);
  const checkpoint = engine.checkpoint();
  assert.deepEqual(settleReadyHistory(engine, rounds.slice(70)), { processedCount: 0, pendingPeriod: rounds[70].issueNumber });
  assert.deepEqual(engine.checkpoint(), checkpoint);
  const restarted = new AdaptiveLearningEngine();
  restarted.setSignals([...engine.t7Signals.values()]);
  for (const row of rounds.slice(0, 70)) restarted.settle(row);
  restarted.verifyRecovery(checkpoint);
  const tailSignals = rounds.slice(70).map((row, i) => ({ period_id: row.issueNumber, signal: i % 2 === 0 ? 'BIG' : 'SMALL' }));
  restarted.setSignals(tailSignals.slice(1).reverse());
  assert.equal(settleReadyHistory(restarted, rounds.slice(70)).processedCount, 0);
  restarted.setSignals(tailSignals.slice(0, 1));
  assert.equal(settleReadyHistory(restarted, rounds.slice(70)).processedCount, 10);
  const { engine: reference } = validateDataset(rounds, [...engine.t7Signals.values(), ...tailSignals]);
  assert.deepEqual(restarted.history, reference.history);
  for (const field of ['weights', 'inputDigest', 'predictionIndex', 'test3MaxLoss', 'test7MaxLoss', 'test9MaxLoss']) {
    assert.deepEqual(restarted.checkpoint()[field], reference.checkpoint()[field], field);
  }
});

test('genuine post-evaluation T7 mutation still rejects without changing inputs, results or checkpoint', () => {
  const { records } = fixture();
  const engine = new AdaptiveLearningEngine();
  const signal = { period_id: records[0].issueNumber, signal: 'BIG', confidence: 72 };
  engine.setSignals([signal]);
  settleReadyHistory(engine, [records[0]]);
  const before = JSON.stringify({ checkpoint: engine.checkpoint(), history: engine.history, signals: [...engine.t7Signals] });
  assert.throws(() => engine.setSignals([{ ...signal, signal: 'SMALL' }]), InputRevisionError);
  assert.equal(JSON.stringify({ checkpoint: engine.checkpoint(), history: engine.history, signals: [...engine.t7Signals] }), before);
  // Missing T7 in an already committed historical prefix is still immutable too.
  const historical = new AdaptiveLearningEngine();
  historical.settle(records[0]);
  assert.throws(() => historical.setSignals([signal]), InputRevisionError);
});

test('stale checkpoint recovery only recognizes absent T7 rows created after the checkpoint', () => {
  const checkpoint = { period: '20261005100050002' };
  const records = [
    { period: '20261005100050001' },
    { period: '20261005100050002' },
  ];
  const updatedAt = '2026-10-05T16:42:02.526Z';
  const existing = {
    period_id: records[0].period, signal: 'SMALL',
    created_at: '2026-10-05T16:40:00.000Z', stored_at: '2026-10-05T16:42:03.000Z',
  };
  const late = {
    period_id: records[1].period, signal: 'BIG',
    created_at: '2026-10-05T16:42:04.000Z', stored_at: '2026-10-05T16:42:04.000Z',
  };
  assert.equal(isLateT7Checkpoint(checkpoint, updatedAt, [existing, late]), true);
  assert.equal(isLateT7Checkpoint(checkpoint, updatedAt, [existing]), false);
  assert.equal(isLateT7Checkpoint(checkpoint, updatedAt, [{ ...existing, created_at: '2026-10-05T16:41:00.000Z' }]), false);
});

test('late T7 checkpoint recovery proves the old state, then rebuilds with final input', () => {
  const { records } = fixture();
  const checkpointTime = '2026-10-05T16:42:02.526Z';
  const old = new AdaptiveLearningEngine();
  const oldSignals = records.slice(0, 4).map((record) => ({ period_id: record.issueNumber, signal: 'SMALL', created_at: '2026-10-05T16:40:00.000Z', stored_at: '2026-10-05T16:40:00.000Z' }));
  old.setSignals(oldSignals.slice(0, 3));
  records.slice(0, 4).forEach((record) => old.settle(record));
  const checkpoint = old.checkpoint();
  const finalSignals = [...oldSignals.slice(0, 3), {
    period_id: records[3].issueNumber, signal: 'BIG',
    created_at: '2026-10-05T16:42:04.000Z', stored_at: '2026-10-05T16:42:04.000Z',
  }];
  const recovered = recoverLateT7Checkpoint(records.slice(0, 4), finalSignals, checkpoint, checkpointTime);
  assert.equal(recovered.replayedCount, 4);
  assert.equal(recovered.candidate.history.length, 4);
  assert.equal(recovered.candidate.history.at(-1).t7pred, 'Big');
  assert.notEqual(recovered.candidate.checkpoint().inputDigest, checkpoint.inputDigest);
  assert.throws(() => recoverLateT7Checkpoint(records.slice(0, 4), [
    ...oldSignals.slice(0, 2), { ...oldSignals[2], signal: 'BIG' }, finalSignals[3],
  ], checkpoint, checkpointTime), InputRevisionError);
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
        if (operator === 'in') {
          const values = value.slice(1, -1).split(',');
          rows = rows.filter((row) => values.includes(row[key]));
          continue;
        }
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
  // A newer write advances the cursor while an older timestamp's transaction
  // is still invisible. The exact pending ID read must recover that late commit.
  const pending = database.wingo_t7_signals[0];
  database.wingo_t7_signals = [{ ...database.wingo_t7_signals[1], stored_at: '2026-10-04T00:00:02.000Z' }];
  const ahead = await store.signalsSince(since);
  database.wingo_t7_signals.push({ ...pending, stored_at: '2026-10-04T00:00:01.000Z' });
  const late = await store.signalsSince(ahead.through, [pending.period_id]);
  assert.ok(late.signals.some((s) => s.period_id === pending.period_id));
  assert.equal(late.through, ahead.through, 'Exact pending reads must not move the delta cursor backwards');
  database.wingo_t7_signals = bootstrap.records.map((r) => ({ period_id: r.issueNumber, signal: 'BIG', stored_at: since }));
  const manyPending = await store.signalsSince(ahead.through, bootstrap.records.map((r) => r.issueNumber));
  assert.equal(manyPending.signals.length, 1003, 'All pending exact-ID pages must be retrieved');
  const checkpoint = { period: bootstrap.records.at(-1).issueNumber, weights: [0.1, 0.3, 0.6] };
  await store.saveCheckpoint(checkpoint);
  assert.deepStrictEqual(await store.loadCheckpoint(), checkpoint);
  failWrite = true;
  await assert.rejects(store.saveCheckpoint({ period: 'next' }), /simulated persistence outage/);
  assert.deepStrictEqual(await store.loadCheckpoint(), checkpoint);
  assert.ok(requests.some((r) => r.search.includes('gt.')));
});
