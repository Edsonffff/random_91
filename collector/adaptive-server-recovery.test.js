import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { AdaptiveLearningEngine } from './adaptive-learning.js';
import { browserHistoryRecord } from './adaptive-learning-store.js';
import { TEST3_SEQUENCE, scheduledStartFromIssue } from './adaptive-algorithms.generated.js';

async function serverRecoveryFixture(t, { baseline = false, startupFailure = false } = {}) {
  const records = Array.from({ length: baseline ? 5 : 71 }, (_, i) => {
    const issueNumber = String((baseline ? 20261002100052078n : 20260928100050001n) + BigInt(i));
    const createdAt = new Date(scheduledStartFromIssue(issueNumber) + 30_000).toISOString();
    return { issueNumber, winningNumber: (i * 7 + 3) % 10, createdAt, sourceTime: createdAt };
  });
  const signals = records.map((r) => ({
    period_id: r.issueNumber, signal: 'BIG', confidence: 70,
    fetched_at: r.createdAt, stored_at: r.createdAt,
    created_at: r.createdAt,
    ...(baseline ? { source: 'server', status: r.winningNumber >= 5 ? 'win' : 'loss',
      actual_number: r.winningNumber, settled_at: r.createdAt } : {}),
  }));
  const activePeriod = String(BigInt(records.at(-1).issueNumber) + 1n);
  signals.push({ period_id: activePeriod, signal: 'BIG', confidence: 70, stored_at: records.at(-1).createdAt, status: 'pending' });
  const checkpointUpdatedAt = '2026-10-05T16:42:02.526Z';
  const oldCheckpointEngine = new AdaptiveLearningEngine();
  oldCheckpointEngine.setSignals(signals.slice(0, baseline ? 3 : 69));
  // Use the exact durable adapter's property order as well as its timestamps:
  // inputDigest covers the serialized record, not only algorithm inputs.
  records.slice(0, baseline ? 4 : 70).forEach((record) => oldCheckpointEngine.settle(browserHistoryRecord({
    issue_number: record.issueNumber, number: record.winningNumber, created_at: record.createdAt,
  })));
  const staleCheckpoint = oldCheckpointEngine.checkpoint();
  if (!baseline) {
    signals[69] = { ...signals[69], created_at: '2026-10-05T16:42:04.000Z', stored_at: '2026-10-05T16:42:04.000Z' };
    signals[70] = { ...signals[70], created_at: '2026-10-05T16:42:05.000Z', stored_at: '2026-10-05T16:42:05.000Z' };
  }
  const reference = new AdaptiveLearningEngine();
  reference.setSignals(signals);
  records.forEach((record) => reference.settle(record));
  reference.predict(activePeriod);
  const database = {
    real_wingo_30s_history: records.map((r) => ({ game_code: 'WinGo_30S', issue_number: r.issueNumber, number: r.winningNumber, created_at: r.createdAt })),
    wingo_t7_signals: signals,
    wingo_adaptive_checkpoints: [{ game_code: 'WinGo_30S', state: staleCheckpoint, updated_at: checkpointUpdatedAt }],
  };
  let writes = 0;
  let failBaselineLookup = startupFailure;
  let liveInput = null;
  let sourceWrites = 0;
  const dbServer = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://fixture');
      if (url.pathname === '/_fixture/upstream') {
        const kind = url.searchParams.get('kind');
        if (kind === 'schedule') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ current: { issueNumber: liveInput?.active ?? activePeriod } }));
        }
        if (!liveInput) { res.writeHead(503); return res.end('Upstream disabled'); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(kind === 't7' ? liveInput.t7 : liveInput.history));
      }
      const table = url.pathname.split('/').at(-1);
      assert.ok(table in database, `Unexpected table ${table}`);
      if (req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        if (table === 'wingo_adaptive_checkpoints') {
          const row = JSON.parse(body);
          const index = database[table].findIndex((existing) => existing.game_code === row.game_code);
          if (index >= 0) database[table][index] = row;
          else database[table].push(row);
          writes++;
        } else {
          assert.ok(liveInput, 'Source writes are allowed only in the live collector fixture');
          for (const row of JSON.parse(body)) {
            const key = table === 'wingo_t7_signals' ? 'period_id' : 'issue_number';
            const index = database[table].findIndex((existing) => existing[key] === row[key]);
            if (index >= 0) database[table][index] = { ...database[table][index], ...row };
            else database[table].push({ created_at: liveInput.createdAt, ...row });
            sourceWrites++;
          }
        }
        res.writeHead(201);
        return res.end();
      }
      assert.ok(['GET', 'HEAD'].includes(req.method));
      if (failBaselineLookup && table === 'wingo_adaptive_checkpoints'
        && url.searchParams.get('game_code') === 'eq.WinGo_30S:baseline') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ message: 'Injected baseline lookup failure' }));
      }
      let rows = database[table];
      for (const [key, filter] of url.searchParams) {
        if (['select', 'order', 'offset', 'limit'].includes(key)) continue;
         const [operator, ...parts] = filter.split('.');
        const value = parts.join('.');
        rows = rows.filter((row) => operator === 'in' ? value.slice(1, -1).split(',').includes(row[key]) : operator === 'eq' ? row[key] === value
          : operator === 'gt' ? row[key] > value : operator === 'gte' ? row[key] >= value : row[key] <= value);
      }
      const count = rows.length;
      const order = url.searchParams.get('order');
      if (order) rows = [...rows].sort((a, b) => {
        for (const column of order.split(',')) {
          const [key, direction] = column.split('.');
          const comparison = String(a[key]).localeCompare(String(b[key]));
          if (comparison) return direction === 'desc' ? -comparison : comparison;
        }
        return 0;
      });
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = Number(url.searchParams.get('limit') || rows.length);
      rows = rows.slice(offset, offset + limit);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Range': `0-${Math.max(0, count - 1)}/${count}` });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(rows));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ message: error.message }));
    }
  });
  dbServer.listen(0, '127.0.0.1');
  await once(dbServer, 'listening');
  t.after(() => new Promise((resolve) => dbServer.close(resolve)));

  async function launch({ ready = true, status = null } = {}) {
    let output = '';
    const child = spawn(process.execPath, ['--import', fileURLToPath(new URL('./fixtures/adaptive-upstream.mjs', import.meta.url)), fileURLToPath(new URL('./server.js', import.meta.url))], {
      env: { ...process.env, PORT: '0', SUPABASE_URL: `http://127.0.0.1:${dbServer.address().port}`, SUPABASE_SERVICE_ROLE_KEY: 'fixture-only', ADAPTIVE_BASELINE_AFTER_PERIOD: baseline ? '20261002100050850' : 'disabled', ADAPTIVE_FIXTURE_ACTIVE_PERIOD: activePeriod,
        ADAPTIVE_FIXTURE_UPSTREAM_URL: `http://127.0.0.1:${dbServer.address().port}/_fixture/upstream` },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const stop = async (signal = 'SIGKILL') => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit');
      child.kill(signal);
      await exited;
    };
    t.after(() => stop());
    // Discover the OS-assigned port via preload, keeping production HTTP code intact.
    let port;
    for (let i = 0; i < 100; i++) {
      port = output.match(/ADAPTIVE_FIXTURE_PORT=(\d+)/)?.[1];
      if (port && status) {
        const response = await fetch(`http://127.0.0.1:${port}/api/adaptive-learning/current`);
        const body = await response.json();
        if (body.status === status) return { stop, port, body, get output() { return output; } };
      }
      if (port && !status && !ready) {
        const response = await fetch(`http://127.0.0.1:${port}/api/adaptive-learning/current`);
        if (response.status === 200) {
          const body = await response.json();
          if (body.status === 'waiting_for_t7') return { stop, port, body, output };
        }
      }
      if (port && !status && ready) {
        const response = await fetch(`http://127.0.0.1:${port}/api/adaptive-learning/current`);
        if (response.status === 200) {
          assert.equal(response.headers.get('cache-control'), 'no-store');
          const body = await response.json();
          if (body.success) return { stop, port, body, output };
        }
      }
      assert.equal(child.exitCode, null, output);
      await delay(100);
    }
    assert.fail(`Adaptive endpoint did not become ready: ${output}`);
  }

  if (baseline) {
    const retiredCheckpoint = structuredClone(database.wingo_adaptive_checkpoints[0]);
    let first;
    if (startupFailure) {
      first = await launch({ status: 'error' });
      assert.match(first.body.error, /Injected baseline lookup failure/);
      assert.equal(first.body.checkpointStatus, 'error');
      const failedHealth = await fetch(`http://127.0.0.1:${first.port}/health`).then((r) => r.json());
      assert.equal(failedHealth.adaptiveStatus, 'error');
      assert.equal(failedHealth.adaptiveState, 'error');
      assert.equal(failedHealth.checkpointStatus, 'error');
      assert.equal(failedHealth.adaptiveBlocked, true);
      assert.match(first.output, /baseline initialization failed/);
      assert.equal(writes, 0, 'Failed initialization must not replace any checkpoint');
      failBaselineLookup = false;
      let readyBody;
      for (let i = 0; i < 100; i++) {
        const body = await fetch(`http://127.0.0.1:${first.port}/api/adaptive-learning/current`).then((r) => r.json());
        if (body.success) { readyBody = body; break; }
        await delay(100);
      }
      assert.ok(readyBody, `Startup did not retry after the lookup recovered: ${first.output}`);
      first = { ...first, body: readyBody };
    } else first = await launch();
    const baselineId = `adaptive-baseline-v2-${records[0].issueNumber}`;
    const health = await fetch(`http://127.0.0.1:${first.port}/health`).then((r) => r.json());
    assert.equal(health.adaptiveStatus, 'ready');
    assert.equal(health.adaptiveState, 'ready');
    assert.equal(health.checkpointStatus, 'saved');
    assert.equal(health.baselineId, baselineId);
    assert.equal(health.baselineStartPeriod, records[0].issueNumber);
    assert.equal(health.baselineReason, 'previous recovery contained an unrecoverable missing historical T7 input');
    assert.equal(health.baselinePendingAfter, null);
    assert.equal(health.baselinePeriodsIncluded, records.length);
    assert.equal(health.adaptiveCursor, records.at(-1).issueNumber);
    assert.equal(health.pendingT7Count, 0);
    assert.equal(health.oldestPendingT7, null);
    assert.equal(health.t7Coverage, 'complete');
    assert.equal(health.adaptiveBlocked, false);
    for (const diagnostic of ['worker started', 'baseline initialization started', 'baseline checkpoint not_found',
      'baseline candidate selected', 'baseline checkpoint persisted', 'baseline initialization completed']) {
      assert.ok(first.output.includes(`[ADAPTIVE] ${diagnostic}`), diagnostic);
    }
    const saved = database.wingo_adaptive_checkpoints.find((row) => row.game_code === 'WinGo_30S:baseline');
    assert.ok(saved, 'Startup must create the missing active baseline checkpoint');
    assert.equal(saved.state.baseline.baselineId, baselineId);
    assert.equal(saved.state.predictionIndex, records.length);
    assert.deepEqual(database.wingo_adaptive_checkpoints.find((row) => row.game_code === 'WinGo_30S'), retiredCheckpoint);
    for (const field of ['weights', 'test3MaxLoss', 'test7MaxLoss', 'test9MaxLoss', 'latestEvaluation', 'activePrediction']) {
      assert.deepEqual(first.body[field], reference.current()[field], field);
    }
    if (!startupFailure) {
      const checkpointBeforeWaiting = structuredClone(saved);
      database.real_wingo_30s_history.push({ game_code: 'WinGo_30S', issue_number: activePeriod,
        number: 6, created_at: new Date(scheduledStartFromIssue(activePeriod) + 30_000).toISOString() });
      let independentWaiting;
      for (let i = 0; i < 150; i++) {
        const body = await fetch(`http://127.0.0.1:${first.port}/api/adaptive-learning/current`).then((r) => r.json());
        if (body.status === 'waiting_for_t7' && body.maxLoss) { independentWaiting = body; break; }
        await delay(100);
      }
      assert.ok(independentWaiting, 'Independent Max Loss must be served while Adaptive waits for the provider settlement');
      assert.equal(independentWaiting.success, false);
      assert.equal(independentWaiting.pendingPeriod, activePeriod);
      assert.equal(independentWaiting.latestEvaluatedPeriod, records.at(-1).issueNumber);
      assert.deepEqual(database.wingo_adaptive_checkpoints.find((row) => row.game_code === 'WinGo_30S:baseline'), checkpointBeforeWaiting);
      assert.equal(database.wingo_t7_signals.find((row) => row.period_id === activePeriod).status, 'pending');
      for (const name of ['test3', 'test7', 'test9']) assert.ok(Number.isInteger(independentWaiting.maxLoss[name]));
      // Restore only the local test fixture before exercising its original clean restart.
      database.real_wingo_30s_history.pop();
    }
    await first.stop();
    const writesBeforeRestart = writes;
    const restarted = await launch();
    assert.match(restarted.output, /baseline checkpoint found/);
    assert.match(restarted.output, /baseline finalized prefix/);
    assert.match(restarted.output, /baseline initialization completed/);
    assert.equal(writes, writesBeforeRestart, 'Verified restart must restore without relearning or rewriting');
    for (const field of ['baselineId', 'baselineStartPeriod', 'baselinePeriodsIncluded', 'adaptiveCursor',
      'signals', 'weights', 'test3MaxLoss', 'test7MaxLoss', 'test9MaxLoss', 'latestEvaluation', 'activePrediction', 'totalPredictions']) {
      assert.deepEqual(restarted.body[field], first.body[field], `Baseline restart: ${field}`);
    }
    const restartedHealth = await fetch(`http://127.0.0.1:${restarted.port}/health`).then((r) => r.json());
    assert.equal(restartedHealth.baselineId, baselineId);
    assert.equal(restartedHealth.baselinePeriodsIncluded, records.length);
    assert.equal(restartedHealth.checkpointStatus, 'saved');
    assert.equal(restartedHealth.adaptiveState, 'ready');
    assert.deepEqual(database.wingo_adaptive_checkpoints.find((row) => row.game_code === 'WinGo_30S'), retiredCheckpoint);
    await restarted.stop('SIGTERM');
    return;
  }

  // History is visible first. The final T7 row is deliberately committed after
  // the worker has persisted the ready prefix; no arbitrary sleep is involved.
  const initialSignals = database.wingo_t7_signals;
  database.wingo_t7_signals = initialSignals.filter((s) => s.period_id !== records.at(-1).issueNumber);
  const waiting = await launch({ ready: false });
  assert.equal(waiting.body.status, 'waiting_for_t7');
  assert.equal(waiting.body.pendingPeriod, records.at(-1).issueNumber);
  assert.equal(database.wingo_adaptive_checkpoints[0].state.period, records.at(-2).issueNumber);
  assert.equal(database.wingo_adaptive_checkpoints[0].state.totalPredictions, 70);
  assert.equal(database.wingo_adaptive_checkpoints[0].state.predictionIndex, 70);
  assert.match(waiting.output, /strategy=full_chronological_replay/);
  assert.notEqual(database.wingo_adaptive_checkpoints[0].state.inputDigest, staleCheckpoint.inputDigest);
  await waiting.stop();
  const waitingRestarted = await launch({ ready: false });
  assert.equal(waitingRestarted.body.status, 'waiting_for_t7');
  assert.match(waitingRestarted.output, /checkpoint=verified/);
  database.wingo_t7_signals = initialSignals;

  let first;
  for (let i = 0; i < 100; i++) {
    const response = await fetch(`http://127.0.0.1:${waitingRestarted.port}/api/adaptive-learning/current`);
    if (response.status === 200) {
      const body = await response.json();
      if (body.success) { first = { ...waitingRestarted, body }; break; }
    }
    await delay(100);
  }
  assert.ok(first, 'Worker did not recover after the delayed T7 signal');
  assert.equal(first.body.totalPredictions, 71);
  assert.equal(first.body.signals.t3pred, TEST3_SEQUENCE[71 % 14]);
  assert.equal(database.wingo_adaptive_checkpoints[0].state.predictionIndex, 71);
  for (const field of ['weights', 'test3MaxLoss', 'test7MaxLoss', 'test9MaxLoss', 'latestEvaluation', 'activePrediction']) {
    assert.deepEqual(first.body[field], reference.current()[field], field);
  }
  assert.equal('history' in first.body, false);
  assert.ok(JSON.stringify(first.body).length < 6000);
  const checkpoint = structuredClone(database.wingo_adaptive_checkpoints[0].state);
  await first.stop();
  const restarted = await launch();
  assert.match(restarted.output, /checkpoint=verified/);
  for (const field of ['signals', 'weights', 'test3MaxLoss', 'test7MaxLoss', 'test9MaxLoss', 'latestEvaluation', 'activePrediction', 'totalPredictions']) {
    assert.deepEqual(restarted.body[field], first.body[field], `Restart: ${field}`);
  }
  const restored = database.wingo_adaptive_checkpoints[0].state;
  for (const field of ['predictionIndex', 'inputDigest', 'weights', 'test3MaxLoss', 'test7MaxLoss', 'test9MaxLoss', 'firstPredictions']) {
    assert.deepEqual(restored[field], checkpoint[field], `Checkpoint: ${field}`);
  }
  assert.ok(writes >= 3, 'Recovery, final settlement and active prediction must be durable');
  const newActive = String(BigInt(activePeriod) + 1n);
  const createdAt = new Date(scheduledStartFromIssue(activePeriod) + 30_000).toISOString();
  // Exercise the actual collector: one upstream response contains a pending
  // revision followed by its final signal. Adaptive must not see the middle write.
  liveInput = {
    active: newActive, createdAt,
    history: { serviceTime: Date.parse(createdAt), data: { list: [{ issueNumber: activePeriod, number: 7 }] } },
    t7: { prediction: { issue: newActive, size: 'SMALL', status: 'pending', source: 'server', createdAt: Date.parse(createdAt) },
      history: [
        { issue: activePeriod, size: 'SMALL', status: 'pending', source: 'server', createdAt: Date.parse(createdAt) },
        { issue: activePeriod, size: 'BIG', status: 'win', source: 'server', actualNumber: 7,
          settledAt: Date.parse(createdAt), createdAt: Date.parse(createdAt) },
      ] },
  };
  let collected;
  for (let i = 0; i < 200; i++) {
    const body = await fetch(`http://127.0.0.1:${restarted.port}/api/adaptive-learning/current`).then((r) => r.json());
    if (body.success && body.totalPredictions === 72) { collected = body; break; }
    await delay(100);
  }
  assert.ok(collected, 'Actual collector did not hand off the newly finalized period');
  assert.equal(collected.latestEvaluation.t7pred, 'Big');
  assert.equal(database.wingo_adaptive_checkpoints[0].state.predictionIndex, 72);
  assert.ok(sourceWrites >= 3, 'History, pending T7 revision, and final T7 must be persisted');
  const health = await fetch(`http://127.0.0.1:${restarted.port}/health`).then((r) => r.json());
  assert.equal(health.serverRunning, true);
  assert.equal(health.collectorStatus, 'healthy');
  assert.equal(health.dbConnected, true);
  assert.equal(health.lastCollectedPeriod, activePeriod);
  assert.equal(health.lastEvaluatedPeriod, activePeriod);
  assert.equal(health.checkpointStatus, 'saved');
  assert.equal(health.adaptiveStatus, 'ready');
  await restarted.stop('SIGTERM');
}

test('unified HTTP server and coordinated worker recover their durable checkpoint across a process restart',
  { timeout: 90_000 }, (t) => serverRecoveryFixture(t));
test('HTTP/worker startup creates a missing baseline checkpoint and restores baseline health across restart',
  { timeout: 90_000 }, (t) => serverRecoveryFixture(t, { baseline: true }));
test('HTTP/worker startup publishes a failed baseline lookup and retries without remaining loading',
  { timeout: 90_000 }, (t) => serverRecoveryFixture(t, { baseline: true, startupFailure: true }));
