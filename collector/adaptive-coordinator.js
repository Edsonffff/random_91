/** One owner for durable collector writes and Adaptive requests, including retries. */
export class AdaptiveCoordinator {
  constructor(runtime, { onState = () => {} } = {}) {
    this.runtime = runtime;
    this.onState = onState;
    this.tail = Promise.resolve();
    this.flight = null;
    this.blockedSources = new Set();
    this.body = { success: false, status: 'initializing' };
    this.changedPeriods = new Set();
    this.pendingWrites = new Map();
    this.recoveryPromise = null;
  }

  serialize(operation) {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => {});
    return result;
  }

  // The entire upstream response/batch is persisted before releasing this lock.
  ingest(operation, source = 'collector') {
    return this.serialize(async () => {
      const pending = this.pendingWrites.get(source) ?? [];
      pending.push(operation);
      this.pendingWrites.set(source, pending);
      return this.retryWrites(source);
    });
  }

  async retryWrites(source) {
    const pending = this.pendingWrites.get(source);
    let result;
    try {
      while (pending?.length) {
        result = await pending[0]();
        pending.shift();
      }
      this.pendingWrites.delete(source);
      this.blockedSources.delete(source);
      return result;
    } catch (error) {
      this.blockedSources.add(source);
      throw error;
    }
  }

  onSettledPeriod({ period, periods = [] } = {}) {
    if (period) this.changedPeriods.add(period);
    for (const changed of periods) this.changedPeriods.add(changed);
    if (this.flight) return this.flight;
    const prepare = () => this.serialize(async () => {
      // Retain failed batches, even if upstream stops returning those periods.
      // Retry under the same lock without requiring another upstream response.
      for (const source of this.pendingWrites.keys()) {
        try { await this.retryWrites(source); } catch { /* Keep the input barrier. */ }
      }
      const changed = [...this.changedPeriods];
      for (const period of changed) this.changedPeriods.delete(period);
      const body = this.blockedSources.size
        ? { success: false, status: 'error', error: 'Collector persistence awaits retry.',
          latestEvaluatedPeriod: this.body.latestEvaluatedPeriod ?? null,
          checkpointAt: this.body.checkpointAt ?? null, checkpointStatus: 'ingestion_pending_retry' }
        : await this.runtime.advance({ periods: changed });
      if (this.blockedSources.size || body.status === 'recovering' || body.recoveryId
        || !['ready', 'waiting_for_t7', 'waiting_for_history'].includes(body.status)) {
        for (const period of changed) this.changedPeriods.add(period);
      }
      this.body = body;
      this.onState(body);
      return body;
    });
    this.flight = prepare().then(async (body) => {
      if (body.status !== 'recovering' || !this.runtime.runRecovery) return body;
      // Replay uses a private snapshot; collector writes can continue here.
      this.recoveryPromise ??= this.runtime.runRecovery();
      try {
        body = await this.recoveryPromise;
        if (body.status === 'recovering') body = await this.serialize(() => this.runtime.commitRecovery());
        this.body = body;
        this.onState(body);
        // New arrivals are admitted only after checkpoint + atomic promotion.
        if (body.status === 'ready') return prepare();
        return body;
      } finally { this.recoveryPromise = null; }
    }).finally(() => { this.flight = null; });
    return this.flight;
  }
}
