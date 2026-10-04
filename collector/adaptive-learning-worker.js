import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { AdaptiveLearningEngine, InputRevisionError } from './adaptive-learning.js';
import { AdaptiveLearningStore, createAdaptiveClient } from './adaptive-learning-store.js';

/** CPU-heavy startup and CPL-1 fitting stay off the collector/T7 event loop. */
export function startAdaptiveWorker({ url, key, onState, log, logError }) {
  const worker = new Worker(new URL('./adaptive-learning-worker.js', import.meta.url), { workerData: { url, key } });
  let failed = false;
  worker.on('message', (message) => {
    if (message.type === 'state') {
      failed = message.body.success === false;
      onState(message.body);
    }
    else if (message.type === 'error') logError(`[Adaptive] ${message.message}`);
    else log(`[Adaptive] ${message.message}`);
  });
  worker.on('error', (error) => {
    failed = true;
    logError(`[Adaptive] worker error: ${error.message}`);
    onState({ success: false, status: 'error', error: 'Adaptive worker failed.' });
  });
  worker.on('exit', (code) => {
    if (!failed) onState({ success: false, status: 'stopped', error: `Adaptive worker stopped (${code}).` });
  });
  return worker;
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
  } finally {
    clearTimeout(timeout);
  }
}

async function run() {
  const log = (message) => parentPort.postMessage({ type: 'log', message });
  const store = new AdaptiveLearningStore(createAdaptiveClient(workerData.url, workerData.key));
  let engine;
  let signalsThrough;
  let dirty = false;
  let lastError;
  let lastErrorAt = 0;
  let checkpointAt;
  let persistedBody;

  async function persist() {
    await store.saveCheckpoint(engine.checkpoint());
    checkpointAt = new Date().toISOString();
    dirty = false;
    persistedBody = { ...engine.current(), status: 'ready', checkpointAt };
    log(`checkpoint persisted period=${engine.lastProcessedPeriod} predictions=${engine.history.length}`);
  }

  while (true) {
    try {
      if (!engine) {
        log('startup/recovery: loading Supabase history, stored T7 signals and checkpoint');
        const checkpoint = await store.loadCheckpoint();
        const [batch, storedSignals] = await Promise.all([store.historyAfter(), store.signalsSince()]);
        const candidate = new AdaptiveLearningEngine({ log });
        store.assertCoverage(candidate, batch);
        candidate.setSignals(storedSignals.signals);
        let verified = !checkpoint;
        if (checkpoint && checkpoint.period === null) { candidate.verifyRecovery(checkpoint); verified = true; }
        for (const record of batch.records) {
          candidate.settle(record, { quiet: true });
          if (checkpoint?.period === record.issueNumber) {
            candidate.verifyRecovery(checkpoint);
            verified = true;
          }
        }
        if (!verified) throw new InputRevisionError('Checkpoint period is missing from Supabase history.');
        engine = candidate;
        signalsThrough = storedSignals.through;
        dirty = true;
        log(`recovery complete rows=${engine.history.length} latest=${engine.lastProcessedPeriod} checkpoint=${checkpoint ? 'verified' : 'first bootstrap'}`);
      }
      // Retry a failed durable write before admitting any further input.
      if (dirty) await persist();
      const [batch, storedSignals] = await Promise.all([store.historyAfter(engine.lastProcessedPeriod), store.signalsSince(signalsThrough)]);
      store.assertCoverage(engine, batch);
      engine.setSignals(storedSignals.signals);
      for (const record of batch.records) {
        engine.settle(record);
        dirty = true;
      }
      signalsThrough = storedSignals.through;
      // Save settlements even if the independent schedule service is unavailable.
      if (dirty) await persist();
      const changed = engine.predict(await currentIssue());
      if (changed) { dirty = true; await persist(); }
      parentPort.postMessage({ type: 'state', body: persistedBody });
      if (lastError) log('recovered after transient error');
      lastError = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== lastError || Date.now() - lastErrorAt >= 60_000) {
        parentPort.postMessage({ type: 'error', message });
        lastErrorAt = Date.now();
      }
      lastError = message;
      parentPort.postMessage({ type: 'state', body: { success: false, status: 'error', error: message, checkpointAt } });
      // An input/recovery mismatch requires inspection, never silent algorithm adjustment.
      if (error instanceof InputRevisionError) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

if (!isMainThread) {
  run().catch((error) => {
    parentPort.postMessage({ type: 'error', message: error.message });
    process.exitCode = 1;
  });
}
