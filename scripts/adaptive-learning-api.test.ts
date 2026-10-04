import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import {
  ADAPTIVE_LEARNING_URL, ADAPTIVE_STALE_AFTER_MS,
  parseAdaptiveSnapshot, isAdaptiveSnapshotStale, startAdaptiveLearningPolling,
  type AdaptiveApiState,
} from '../src/services/adaptiveLearningApi.ts';

const NOW = Date.parse('2026-10-04T14:44:12.549Z');
function snapshot(checkpoint = NOW) {
  return {
    success: true, version: 'phone-v1', signalLabels: ['Test 3', 'Test 7', 'Test 9'],
    finalDecision: 'Small', status: 'ready', checkpointAt: new Date(checkpoint).toISOString(),
    activePrediction: {
      period: '20261004100051769', decision: 'Big', probBig: 100, probSmall: 0,
      signalsAvailable: 2, weights: [0.76, 0.23, 0.01],
    },
    signals: { period: '20261004100051769', t3pred: null, t7pred: 'Big', t9pred: 'Big' },
    latestEvaluation: {
      period: '20261004100051767', t3pred: null, t7pred: 'Small', t9pred: 'Big',
      adaptiveDecision: 'Small', t4pred: 'Small', actual: 'Small', isHit: true,
      probBig: 12, probSmall: 88, weights: [0.78, 0.19, 0.03], signalsAvailable: 2,
    },
    totalPredictions: 5225, totalHits: 2621, totalMisses: 2604, accuracyPct: 50,
    currentHitStreak: 2, currentMissStreak: 0, longestHitStreak: 10, longestMissStreak: 9,
    weights: [0.76, 0.23, 0.01], dominantSignalIndex: 0,
    last20: { hits: 11, total: 20 }, last50: { hits: 24, total: 50 },
    last100: { hits: 45, total: 100 }, last250: { hits: 124, total: 250 },
    lastSignalAgreement: { bigVotes: 1, smallVotes: 1, total: 2, majority: null },
  };
}

test('maps the compact server response verbatim and excludes any full history', () => {
  const source = snapshot();
  assert.deepEqual(parseAdaptiveSnapshot(source), source);
  const withoutIndex: Record<string, unknown> = { ...source, history: Array(5000).fill(source.latestEvaluation) };
  delete withoutIndex.dominantSignalIndex;
  assert.deepEqual(parseAdaptiveSnapshot(withoutIndex), source);
  const empty = { ...source, activePrediction: null, signals: null, latestEvaluation: null, finalDecision: null };
  assert.equal(parseAdaptiveSnapshot(empty).activePrediction, null);
});

test('rejects missing fields, unsafe numbers, wrong signal layouts and malformed nested results', () => {
  const invalid = [
    null, [], {}, { success: false, status: 'initializing' },
    { ...snapshot(), status: 'error' }, { ...snapshot(), weights: [0.5, 0.5] },
    { ...snapshot(), weights: [1, Infinity, 0] }, { ...snapshot(), totalHits: -1 },
    { ...snapshot(), accuracyPct: NaN }, { ...snapshot(), checkpointAt: 'invalid' },
    { ...snapshot(), signalLabels: ['Test 2', 'Test 6', 'Test 9'] },
    { ...snapshot(), activePrediction: { ...snapshot().activePrediction, probBig: '100' } },
    { ...snapshot(), activePrediction: { ...snapshot().activePrediction, probBig: 40 } },
    { ...snapshot(), signals: { ...snapshot().signals, t7pred: 'BIG' } },
    { ...snapshot(), signals: { ...snapshot().signals, period: 'another-period' } },
    { ...snapshot(), latestEvaluation: { ...snapshot().latestEvaluation, actual: 'invalid' } },
    { ...snapshot(), last20: { hits: 25, total: 20 } },
    { ...snapshot(), lastSignalAgreement: { bigVotes: 3, smallVotes: 2, total: 5, majority: 'Big' } },
  ];
  for (const input of invalid) assert.throws(() => parseAdaptiveSnapshot(input));
  for (const key of Object.keys(snapshot())) {
    if (key === 'dominantSignalIndex') continue;
    const missing: Record<string, unknown> = { ...snapshot() };
    delete missing[key];
    assert.throws(() => parseAdaptiveSnapshot(missing), `Missing field: ${key}`);
  }
});

test('freshness uses checkpoint time, including frozen responses and clock skew', () => {
  const parsed = parseAdaptiveSnapshot(snapshot());
  assert.equal(isAdaptiveSnapshotStale(parsed, NOW + ADAPTIVE_STALE_AFTER_MS), false);
  assert.equal(isAdaptiveSnapshotStale(parsed, NOW + ADAPTIVE_STALE_AFTER_MS + 1), true);
  assert.equal(isAdaptiveSnapshotStale(parsed, NOW - 30_001), true);
});

test('polls only the compact GET, never overlaps requests, and discards completion after unmount', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: NOW });
  const states: AdaptiveApiState[] = [];
  const requests: Array<{ url: string; options?: RequestInit }> = [];
  const pending: Array<(response: Response) => void> = [];
  const fetcher = ((url: string, options?: RequestInit) => {
    requests.push({ url, options });
    return new Promise<Response>((resolve) => pending.push(resolve));
  }) as typeof fetch;
  const stop = startAdaptiveLearningPolling((state) => states.push(state), { fetcher });
  t.after(stop);
  assert.equal(states[0].status, 'loading');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, ADAPTIVE_LEARNING_URL);
  assert.equal(requests[0].options?.method, 'GET');
  assert.equal(requests[0].options?.credentials, 'omit');
  assert.deepEqual(requests[0].options?.headers, { Accept: 'application/json' });
  t.mock.timers.tick(2000);
  assert.equal(requests.length, 1);
  pending.shift()!(Response.json(snapshot()));
  await setImmediate();
  assert.equal(states.at(-1)?.status, 'ready');
  t.mock.timers.tick(4999);
  assert.equal(requests.length, 1);
  t.mock.timers.tick(1);
  assert.equal(requests.length, 2);
  // Even a transport ignoring abort cannot start overlapping retries.
  t.mock.timers.tick(15_000);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].options?.signal?.aborted, true);
  stop();
  const notifications = states.length;
  pending.shift()!(Response.json(snapshot(NOW + 20_000)));
  await setImmediate();
  t.mock.timers.tick(60_000);
  assert.equal(states.length, notifications);
  assert.equal(requests.length, 2);
});

test('aborts timed-out fetches, reports errors and recovers on the next poll', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: NOW });
  const states: AdaptiveApiState[] = [];
  let requests = 0;
  const fetcher = ((_url: string, options: RequestInit) => {
    requests++;
    if (requests > 1) return Promise.resolve(Response.json(snapshot()));
    return new Promise<Response>((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  }) as typeof fetch;
  const stop = startAdaptiveLearningPolling((state) => states.push(state), { fetcher });
  t.after(stop);
  t.mock.timers.tick(4000);
  await setImmediate();
  assert.equal(states.at(-1)?.status, 'error');
  assert.match(states.at(-1)?.error ?? '', /timed out/);
  t.mock.timers.tick(5000);
  await setImmediate();
  assert.equal(requests, 2);
  assert.equal(states.at(-1)?.status, 'ready');
  assert.equal(states.at(-1)?.error, null);
});

test('keeps last good stats on HTTP/malformed/network errors, rejects older checkpoints and marks stalled data stale', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: NOW });
  const states: AdaptiveApiState[] = [];
  const responses: Array<Response | Error> = [
    Response.json(snapshot()), new Response('Unavailable', { status: 503 }),
    new Response('<html>Bad gateway</html>'), Response.json({ ...snapshot(), weights: null }),
    new TypeError('Failed to fetch'), Response.json(snapshot(NOW - 10_000)),
    Response.json(snapshot()),
  ];
  const fetcher = (async () => {
    const next = responses.shift() ?? Response.json(snapshot());
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  const stop = startAdaptiveLearningPolling((state) => states.push(state), { fetcher });
  t.after(stop);
  await setImmediate();
  const good = states.at(-1)!.data;
  for (const message of [/HTTP 503/, /invalid JSON/, /Malformed/, /Failed to fetch/, /checkpoint moved backwards/]) {
    t.mock.timers.tick(5000);
    await setImmediate();
    assert.equal(states.at(-1)?.status, 'error');
    assert.match(states.at(-1)?.error ?? '', message);
    assert.equal(states.at(-1)?.data, good);
  }
  t.mock.timers.tick(5000);
  await setImmediate();
  assert.equal(states.at(-1)?.status, 'ready');
  t.mock.timers.tick(ADAPTIVE_STALE_AFTER_MS);
  await setImmediate();
  assert.equal(states.at(-1)?.stale, true);
  assert.equal(states.at(-1)?.status, 'stale');
});

test('unmount aborts the current request and prevents all subsequent callbacks/retries', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: NOW });
  const states: AdaptiveApiState[] = [];
  let signal: AbortSignal;
  let requests = 0;
  const fetcher = ((_url: string, options: RequestInit) => {
    requests++;
    signal = options.signal!;
    return new Promise<Response>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  }) as typeof fetch;
  const stop = startAdaptiveLearningPolling((state) => states.push(state), { fetcher });
  stop();
  await setImmediate();
  t.mock.timers.tick(100_000);
  assert.equal(signal!.aborted, true);
  assert.equal(requests, 1);
  assert.equal(states.length, 1);
});
