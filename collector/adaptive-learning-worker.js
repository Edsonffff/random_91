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

/** Commit only the ready chronological prefix; the rest stays behind the history cursor. */
export function settleReadyHistory(engine, records, { quiet = false } = {}) {
  let processedCount = 0;
  for (const record of records) {
    if (!engine.t7Signals.has(record.issueNumber)) {
      return { processedCount, pendingPeriod: record.issueNumber };
    }
    if (engine.settle(record, { quiet })) processedCount++;
  }
  return { processedCount, pendingPeriod: null };
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
        let replayedCount = 0;
        // Reconstruct the committed prefix exactly, including legitimate historical
        // no-signal rows. Never gate or bypass checkpoint integrity verification.
        for (const record of batch.records) {
          if (verified) break;
          candidate.settle(record, { quiet: true });
          replayedCount++;
          if (checkpoint?.period === record.issueNumber) {
            candidate.verifyRecovery(checkpoint);
            verified = true;
          }
        }
        if (!verified) throw new InputRevisionError('Checkpoint period is missing from Supabase history.');
        settleReadyHistory(candidate, batch.records.slice(replayedCount), { quiet: true });
        engine = candidate;
        signalsThrough = storedSignals.through;
        dirty = true;
        log(`recovery complete rows=${engine.history.length} latest=${engine.lastProcessedPeriod} checkpoint=${checkpoint ? 'verified' : 'first bootstrap'}`);
      }
      // Retry a failed durable write before admitting any further input.
      if (dirty) await persist();
      const batch = await store.historyAfter(engine.lastProcessedPeriod);
      store.assertCoverage(engine, batch);
      // Exact pending-period reads also catch commits older than the delta cursor.
      const storedSignals = await store.signalsSince(signalsThrough, batch.records.map((record) => record.issueNumber));
      engine.setSignals(storedSignals.signals);
      const { processedCount, pendingPeriod } = settleReadyHistory(engine, batch.records);
      if (processedCount) dirty = true;
      signalsThrough = storedSignals.through;
      // Save settlements even if the independent schedule service is unavailable.
      if (dirty) await persist();
      if (pendingPeriod) {
        // Predicting beyond held settlements would use incomplete weights/T3 position.
        // Waiting is retryable input readiness, not an integrity failure.
        parentPort.postMessage({ type: 'state', body: {
          success: false, status: 'waiting_for_t7', pendingPeriod, checkpointAt,
          error: `Waiting for stored T7 input at ${pendingPeriod}.`,
        } });
      } else {
        const changed = engine.predict(await currentIssue());
        if (changed) { dirty = true; await persist(); }
        parentPort.postMessage({ type: 'state', body: persistedBody });
      }
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
