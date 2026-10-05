import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { AdaptiveLearningEngine } from './adaptive-learning.js';
import { TEST3_SEQUENCE, scheduledStartFromIssue } from './adaptive-algorithms.generated.js';

test('real HTTP server and adaptive worker recover their durable checkpoint across a process restart', { timeout: 30_000 }, async (t) => {
  const records = Array.from({ length: 71 }, (_, i) => {
    const issueNumber = String(20260928100050001n + BigInt(i));
    const createdAt = new Date(scheduledStartFromIssue(issueNumber) + 30_000).toISOString();
    return { issueNumber, winningNumber: (i * 7 + 3) % 10, createdAt, sourceTime: createdAt };
  });
  const signals = records.filter((_, i) => i % 4 !== 0).map((r) => ({
    period_id: r.issueNumber, signal: 'BIG', confidence: 70,
    fetched_at: r.createdAt, stored_at: r.createdAt,
  }));
  const activePeriod = String(BigInt(records.at(-1).issueNumber) + 1n);
  const reference = new AdaptiveLearningEngine();
  reference.setSignals(signals);
  records.forEach((record) => reference.settle(record));
  reference.predict(activePeriod);
  const database = {
    real_wingo_30s_history: records.map((r) => ({ game_code: 'WinGo_30S', issue_number: r.issueNumber, number: r.winningNumber, created_at: r.createdAt })),
    wingo_t7_signals: signals,
    wingo_adaptive_checkpoints: [],
  };
  let writes = 0;
  const dbServer = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://fixture');
      const table = url.pathname.split('/').at(-1);
      assert.ok(table in database, `Unexpected table ${table}`);
      if (req.method === 'POST') {
        assert.equal(table, 'wingo_adaptive_checkpoints', 'Only adaptive checkpoints may be written');
        let body = '';
        for await (const chunk of req) body += chunk;
        database[table] = [JSON.parse(body)];
        writes++;
        res.writeHead(201);
        return res.end();
      }
      assert.ok(['GET', 'HEAD'].includes(req.method));
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

  async function launch() {
    let output = '';
    const child = spawn(process.execPath, ['--import', fileURLToPath(new URL('./fixtures/adaptive-upstream.mjs', import.meta.url)), fileURLToPath(new URL('./server.js', import.meta.url))], {
      env: { ...process.env, PORT: '0', SUPABASE_URL: `http://127.0.0.1:${dbServer.address().port}`, SUPABASE_SERVICE_ROLE_KEY: 'fixture-only', ADAPTIVE_FIXTURE_ACTIVE_PERIOD: activePeriod },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const stop = async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    };
    t.after(stop);
    // Discover the OS-assigned port via preload, keeping production HTTP code intact.
    for (let i = 0; i < 100; i++) {
      const port = output.match(/ADAPTIVE_FIXTURE_PORT=(\d+)/)?.[1];
      if (port) {
        const response = await fetch(`http://127.0.0.1:${port}/api/adaptive-learning/current`);
        if (response.status === 200) {
          assert.equal(response.headers.get('cache-control'), 'no-store');
          return { stop, body: await response.json(), output };
        }
      }
      assert.equal(child.exitCode, null, output);
      await delay(100);
    }
    assert.fail(`Adaptive endpoint did not become ready: ${output}`);
  }

  const first = await launch();
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
  assert.ok(writes >= 4, 'Both processes must persist recovery and active state');
  await restarted.stop();
});
