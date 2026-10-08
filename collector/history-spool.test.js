import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import {
  compareHistoryPeriods,
  detectHistoryGaps,
  fetchJsonWithFailover,
  HistorySpool,
  nextHistoryPeriod,
} from './history-spool.js';
import { filterHistoryRecordsAfterBoundary } from './history-reset-boundary.js';

function record(period, number = 7) {
  return {
    game_code: 'WinGo_30S', issue_number: period, number, color: number >= 5 ? 'green' : 'red',
    premium: String(number), sum: 0, source: 'COMPLETED REAL HISTORY', source_time: '2026-10-08T00:00:00.000Z',
  };
}

async function withSpool(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'wingo-history-spool-'));
  try { return await callback(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test('spool writes atomically, survives a fresh instance, and removes only after ACK', async () => {
  await withSpool(async (directory) => {
    const first = await new HistorySpool(directory).initialize();
    const entry = await first.enqueue(record('20261008100050001'), { sourceUrl: 'fixture' });
    assert.equal(entry.created, true);
    assert.equal((await first.listPending()).length, 1);

    const restarted = await new HistorySpool(directory).initialize();
    const pending = await restarted.listPending();
    assert.equal(pending[0].record.issue_number, '20261008100050001');
    await restarted.acknowledge(pending[0]);
    assert.equal((await restarted.listPending()).length, 0);
  });
});

test('duplicate delivery is idempotent and conflicting values are rejected', async () => {
  await withSpool(async (directory) => {
    const spool = await new HistorySpool(directory).initialize();
    const original = record('20261008100050002', 3);
    assert.equal((await spool.enqueue(original)).created, true);
    assert.equal((await spool.enqueue(original)).created, false);
    await assert.rejects(spool.enqueue(record('20261008100050002', 8)), /conflict/);
    assert.equal((await spool.listPending()).length, 1);
  });
});

test('failed persistence leaves the spool pending, then retry ACKs after success', async () => {
  await withSpool(async (directory) => {
    const spool = await new HistorySpool(directory).initialize();
    await spool.enqueue(record('20261008100050003'));
    const pending = (await spool.listPending())[0];
    let available = false;
    const persist = async () => {
      if (!available) throw new Error('Supabase unavailable');
    };
    await assert.rejects(persist(pending.record), /unavailable/);
    assert.equal((await spool.listPending()).length, 1);
    available = true;
    await persist(pending.record);
    await spool.acknowledge(pending);
    assert.equal((await spool.listPending()).length, 0);
  });
});

test('process crash after receipt is recoverable and cursor advances only after persistence ACK', async () => {
  await withSpool(async (directory) => {
    const spool = await new HistorySpool(directory).initialize();
    const period = '20261008100050004';
    await spool.enqueue(record(period));
    let cursor = null;
    const restarted = await new HistorySpool(directory).initialize();
    const pending = (await restarted.listPending())[0];
    assert.equal(cursor, null, 'receipt alone must not advance the persisted cursor');
    const persisted = new Set();
    persisted.add(pending.record.issue_number);
    await restarted.acknowledge(pending);
    cursor = pending.record.issue_number;
    assert.equal(cursor, period);
    assert.deepEqual([...persisted], [period]);
  });
});

test('a SIGKILL after the response is durably spooled leaves the whole batch for restart recovery', async () => {
  await withSpool(async (directory) => {
    const moduleUrl = new URL('./history-spool.js', import.meta.url).href;
    const script = `import { HistorySpool } from ${JSON.stringify(moduleUrl)};
const spool = await new HistorySpool(${JSON.stringify(directory)}).initialize();
await spool.enqueueBatch([
  ${JSON.stringify(record('20261008100050006'))},
  ${JSON.stringify(record('20261008100050007', 2))},
], { sourceUrl: 'crash-fixture' });
console.log('SPOOL_READY');
setTimeout(() => {}, 60000);`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`child did not spool: ${output}`)), 5000);
      child.stdout.on('data', () => {
        if (output.includes('SPOOL_READY')) { clearTimeout(timer); resolve(); }
      });
      child.once('error', reject);
    });
    child.kill('SIGKILL');
    await once(child, 'exit');

    const restarted = await new HistorySpool(directory).initialize();
    const pending = await restarted.listPending();
    assert.equal(pending.length, 1);
    assert.deepEqual(pending[0].records.map((entry) => entry.issue_number), [
      '20261008100050006', '20261008100050007',
    ]);
    await restarted.acknowledge(pending[0]);
    assert.equal((await restarted.listPending()).length, 0);
  });
});

test('continuity detects missing periods without generating records', () => {
  const before = '20261007100052880';
  const afterMidnight = '20261008100050002';
  assert.equal(nextHistoryPeriod(before), '20261008100050001');
  assert.ok(compareHistoryPeriods(before, afterMidnight) < 0);
  assert.deepEqual(detectHistoryGaps(before, [before, afterMidnight]), [{
    after: before, expectedNext: '20261008100050001', observedNext: afterMidnight,
  }]);
});

test('post-reset boundary excludes the boundary and older records without fabricating periods', () => {
  const boundary = '20261007100052880';
  const records = [
    record('20261007100052879'),
    record(boundary),
    record('20261008100050001'),
    record('20261008100050003'),
  ];
  const accepted = filterHistoryRecordsAfterBoundary(records, boundary);
  assert.deepEqual(accepted.map((entry) => entry.issue_number), [
    '20261008100050001', '20261008100050003',
  ]);
  assert.equal(accepted.some((entry) => entry.issue_number === '20261008100050002'), false);
  assert.equal(accepted.length, 2);
});

test('post-reset boundary uses normal comparison across midnight rollover', () => {
  const boundary = '20261007100052880';
  const accepted = filterHistoryRecordsAfterBoundary([
    { issue_number: boundary },
    { issue_number: '20261008100050001' },
    { issue_number: '20261008100050002' },
  ], boundary);
  assert.deepEqual(accepted.map((entry) => entry.issue_number), [
    '20261008100050001', '20261008100050002',
  ]);
  assert.equal(nextHistoryPeriod(boundary), '20261008100050001');
});

test('official mirror failover uses the next mirror after an HTTP failure', async () => {
  const requests = [];
  const result = await fetchJsonWithFailover({
    hosts: ['https://first.invalid', 'https://second.invalid'], path: '/history', now: () => 1000,
    fetcher: async (url) => {
      requests.push(url);
      if (url.startsWith('https://first')) return new Response('blocked', { status: 503 });
      return Response.json({ data: { list: [{ issueNumber: '20261008100050005', number: 7 }] } });
    },
  });
  assert.equal(result.host, 'https://second.invalid');
  assert.equal(result.payload.data.list[0].issueNumber, '20261008100050005');
  assert.deepEqual(result.failures, [{ host: 'https://first.invalid', reason: 'HTTP 503' }]);
  assert.equal(requests.length, 2);
});

test('history source deadline aborts a hung response body', async () => {
  await assert.rejects(fetchJsonWithFailover({
    hosts: ['https://hung.invalid'], path: '/history', timeoutMs: 5,
    fetcher: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
  }), /all history sources failed/);
});
