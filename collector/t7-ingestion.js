import { isFinalizedT7Entry } from './t7-monitoring.js';

// PostgreSQL TIMESTAMPTZ and Date.toISOString() serialize UTC differently.
// Compare valid instants without rewriting the stored timestamp representation.
export function sameInstant(left, right) {
  if (left == null || right == null) return left === right;
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs === rightMs;
}

function earliestTimestamp(...values) {
  return values.filter(Boolean).sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null;
}

/**
 * Exact-entry T7 persistence. This class has no dependency on adaptive
 * learning and never derives a T7 value from another table.
 */
export class T7IngestionLedger {
  constructor({ cache, loadExisting, persist, observe, onStored = () => {}, log = () => {}, logError = () => {} }) {
    this.cache = cache;
    this.loadExisting = loadExisting;
    this.persist = persist;
    this.observe = observe;
    this.onStored = onStored;
    this.log = log;
    this.logError = logError;
  }

  async ingest(entry, responseTime, origin) {
    this.log(`[T7] period=${entry.period_id} status=received origin=${origin}`);
    const observedAt = new Date().toISOString();
    let existing = this.cache.get(entry.period_id);
    if (!existing) {
      existing = await this.loadExisting(entry.period_id);
      if (existing) this.cache.set(entry.period_id, existing);
    }

    if (!existing) {
      const storedAt = new Date().toISOString();
      const fetchedAt = entry.prediction_created_at || storedAt;
      const signalRecord = { ...entry, fetched_at: fetchedAt, stored_at: storedAt };
      await this.persist(signalRecord);
      this.cache.set(entry.period_id, {
        ...signalRecord,
        wingoai_response_ms: responseTime,
        collector_latency_ms: Math.max(0, Date.parse(storedAt) - Date.parse(fetchedAt)),
      });
      await this.observe(entry, observedAt);
      await this.onStored({ entry, origin, operation: 'inserted' });
      return;
    }

    const existingStatus = existing.status ?? null;
    const nextStatus = entry.status ?? null;
    const isSettledNow = nextStatus !== null && nextStatus !== 'pending';
    const wasPending = existingStatus === null || existingStatus === 'pending';
    const existingIsFinalized = isFinalizedT7Entry(existing);
    const incomingIsFinalized = isFinalizedT7Entry(entry);
    const finalizedValueChanged = existingIsFinalized && incomingIsFinalized && (
      existing.signal !== entry.signal
      || existing.status !== entry.status
      || Number(existing.actual_number) !== Number(entry.actual_number)
      || !sameInstant(existing.settled_at, entry.settled_at)
      || (existing.source ?? null) !== (entry.source ?? null)
    );
    if (finalizedValueChanged) {
      this.logError(`[RECOVERY] T7 immutable conflict period=${entry.period_id}`);
      throw new Error(`T7 finalized input conflict at ${entry.period_id}; recovery required.`);
    }
    if (existingIsFinalized && !incomingIsFinalized) return;
    if (wasPending && nextStatus !== null && nextStatus !== 'pending' && !incomingIsFinalized) {
      await this.observe(entry, observedAt);
      return;
    }
    if (!wasPending && nextStatus === 'pending') return;

    const fieldsChanged = Object.keys(entry).some((field) => {
      if (field === 'settled_at' || field === 'prediction_created_at') {
        return !sameInstant(entry[field] ?? null, existing[field] ?? null);
      }
      return JSON.stringify(entry[field] ?? null) !== JSON.stringify(existing[field] ?? null);
    });
    const shouldUpdate = (wasPending && isSettledNow) || nextStatus !== existingStatus || fieldsChanged;
    if (!shouldUpdate) {
      await this.observe(entry, observedAt);
      return;
    }

    const storedAt = new Date().toISOString();
    const settleRow = {
      period_id: entry.period_id,
      signal: entry.signal,
      confidence: entry.confidence,
      color: entry.color,
      status: entry.status,
      source: entry.source,
      algorithm_version: entry.algorithm_version,
      guard_applied: entry.guard_applied,
      actual_number: entry.actual_number,
      actual_color: entry.actual_color,
      size_hit: entry.size_hit,
      color_hit: entry.color_hit,
      settled_at: entry.settled_at,
      prediction_created_at: earliestTimestamp(existing.prediction_created_at, entry.prediction_created_at),
      fetched_at: existing.fetched_at || entry.prediction_created_at || storedAt,
      stored_at: storedAt,
    };
    await this.persist(settleRow);
    this.cache.set(entry.period_id, { ...existing, ...settleRow });
    await this.observe(entry, observedAt);
    await this.onStored({ entry, origin, operation: 'updated', previousStatus: existingStatus });
  }
}
