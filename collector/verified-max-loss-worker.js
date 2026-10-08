import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createClient } from '@supabase/supabase-js';
import { AdaptiveLearningStore } from './adaptive-learning-store.js';
import { calculateVerifiedMaxLoss } from './verified-max-loss.js';

/** Lazy refresh independent of collector polling; HTTP always serves a compact cached value. */
export function startVerifiedMaxLossWorker({ url, key, logError = () => {} }) {
  const worker = new Worker(new URL('./verified-max-loss-worker.js', import.meta.url), { workerData: { url, key } });
  let value = null;
  let busy = false;
  let lastRefresh = 0;
  let stopped = false;
  worker.on('message', (message) => {
    if (message.type === 'snapshot') {
      const next = message.value;
      // Keep the last complete independent snapshot while a later refresh is
      // rebuilding; do not move coverage/counters backwards on progress frames.
      if (value?.calculationStatus === 'ready' && next.calculationStatus === 'calculating') return;
      if (value) {
        for (const name of ['test3', 'test7', 'test9']) {
          if (next[name] < value[name]) {
            next.tests[name].recordStartPeriod = value.tests[name].recordStartPeriod;
            next.tests[name].recordEndPeriod = value.tests[name].recordEndPeriod;
          }
          next[name] = Math.max(value[name], next[name]);
          next.tests[name].longestLossStreak = next[name];
        }
      }
      value = next;
    } else if (message.type === 'error') {
      logError(`[MAX LOSS] ${message.error}`);
      if (value) value = { ...value, refreshError: message.error };
    } else if (message.type === 'complete') { busy = false; }
  });
  worker.on('error', (error) => { busy = false; stopped = true; logError(`[MAX LOSS] worker error: ${error.message}`); });
  worker.on('exit', () => { stopped = true; busy = false; });
  return {
    current: () => value,
    refresh: () => {
      if (stopped || busy || Date.now() - lastRefresh < 30_000) return;
      busy = true;
      lastRefresh = Date.now();
      worker.postMessage({ type: 'refresh' });
    },
    terminate: () => worker.terminate(),
  };
}

if (!isMainThread) {
  // This worker calls only the store's read methods. It never creates an
  // Adaptive runtime or invokes saveCheckpoint/saveBaselineCheckpoint.
  const client = createClient(workerData.url, workerData.key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, options = {}) => {
      const method = String(options.method ?? 'GET').toUpperCase();
      if (!['GET', 'HEAD'].includes(method)) throw new Error(`Max Loss worker refused database write: ${method}`);
      return fetch(input, { ...options, signal: options.signal ?? AbortSignal.timeout(30_000) });
    } },
  });
  const store = new AdaptiveLearningStore(client);
  const cplCache = new Map();
  let busy = false;
  parentPort.on('message', async (message) => {
    if (message.type !== 'refresh' || busy) return;
    busy = true;
    try {
      const saved = await store.loadBaselineCheckpointRecord();
      const baselineId = saved?.state.baseline?.baselineId ?? null;
      const start = saved?.state.baseline?.baselineStartPeriod ?? null;
      const [batch, stored] = await Promise.all([store.historyFrom(start), store.signalsSince(null)]);
      if (batch.records.length !== batch.count) throw new Error('Max Loss history coverage changed during read; retrying.');
      const signals = stored.signals.filter((signal) => !start || signal.period_id >= start);
      // Recompute the already verified prefix first so its known records are
      // available promptly while the independent historical calculation runs.
      if (saved?.state.period) {
        const prefix = batch.records.filter((record) => record.issueNumber <= saved.state.period);
        const known = await calculateVerifiedMaxLoss(prefix, signals, { baselineId, scopeStartPeriod: start, yieldEvery: 0, cplCache });
        parentPort.postMessage({ type: 'snapshot', value: { ...known, coverage: 'partial',
          calculationStatus: 'calculating', coverageReasons: [...known.coverageReasons, 'calculating'] } });
      }
      const value = await calculateVerifiedMaxLoss(batch.records, signals, {
        baselineId, scopeStartPeriod: start ?? batch.records[0]?.issueNumber ?? null, cplCache,
        onProgress: (progress) => parentPort.postMessage({ type: 'snapshot', value: progress }),
      });
      parentPort.postMessage({ type: 'snapshot', value });
    } catch (error) {
      parentPort.postMessage({ type: 'error', error: error.message });
    } finally {
      busy = false;
      parentPort.postMessage({ type: 'complete' });
    }
  });
}
