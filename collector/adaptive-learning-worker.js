import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { AdaptiveLearningStore, createAdaptiveClient } from './adaptive-learning-store.js';
import { AdaptivePeriodRuntime } from './adaptive-period-runtime.js';
export { isLateT7Checkpoint, recoverLateT7Checkpoint } from './adaptive-recovery.js';

/** Retained compatibility helper for historical parity tests. Live readiness is stricter. */
export function settleReadyHistory(engine, records, { quiet = false } = {}) {
  let processedCount = 0;
  for (const record of records) {
    if (!engine.t7Signals.has(record.issueNumber)) return { processedCount, pendingPeriod: record.issueNumber };
    if (engine.settle(record, { quiet })) processedCount++;
  }
  return { processedCount, pendingPeriod: null };
}

// Worker threads share one Node process. There is no independent polling here.
export function startAdaptiveWorker({ url, key, log, logError }) {
  const worker = new Worker(new URL('./adaptive-learning-worker.js', import.meta.url), { workerData: { url, key } });
  const requests = new Map();
  let sequence = 0;
  let failure;
  function fail(error) {
    failure = error;
    for (const { reject } of requests.values()) reject(error);
    requests.clear();
  }
  worker.on('message', (message) => {
    if (message.type === 'response') {
      requests.get(message.id)?.resolve(message.body);
      requests.delete(message.id);
    } else log(message.message);
  });
  worker.on('error', (error) => { logError(`[ADAPTIVE] status=worker_failed detail=${error.message}`); fail(error); });
  worker.on('exit', (code) => fail(new Error(`Adaptive worker stopped (${code}).`)));
  function request(type, inputs) {
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      requests.set(id, { resolve, reject });
      worker.postMessage({ type, id, inputs });
    });
  }
  return {
    advance: (inputs) => request('advance', inputs),
    runRecovery: () => request('runRecovery'),
    commitRecovery: () => request('commitRecovery'),
    terminate: () => worker.terminate(),
  };
}

async function currentIssue() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(`https://draw.ar-lottery01.com/WinGo/WinGo_30S.json?ts=${Date.now()}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json, text/plain, */*', 'User-Agent': 'Mozilla/5.0' },
    });
    if (!response.ok) throw new Error(`Schedule HTTP ${response.status}`);
    const schedule = await response.json();
    const period = String(schedule.current?.issueNumber || '').trim();
    if (!period) throw new Error('Schedule has no current issue.');
    return period;
  } finally { clearTimeout(timeout); }
}

if (!isMainThread) {
  const log = (message) => parentPort.postMessage({ type: 'log', message });
  log('[ADAPTIVE] worker started');
  const runtime = new AdaptivePeriodRuntime(new AdaptiveLearningStore(createAdaptiveClient(workerData.url, workerData.key)), { currentIssue, log });
  let tail = Promise.resolve();
  parentPort.on('message', (message) => {
    if (!['advance', 'runRecovery', 'commitRecovery'].includes(message.type)) return;
    tail = tail.then(async () => {
      try {
        const body = message.type === 'advance' ? await runtime.advance(message.inputs) : await runtime[message.type]();
        parentPort.postMessage({ type: 'response', id: message.id, body });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        parentPort.postMessage({ type: 'log', message: `[ADAPTIVE] request=${message.type} failed detail=${detail}` });
        parentPort.postMessage({ type: 'response', id: message.id, body: {
          success: false, status: 'error', adaptiveState: 'recovery_failed',
          error: detail, checkpointStatus: 'error', databaseConnected: false,
        } });
      }
    });
  });
}
