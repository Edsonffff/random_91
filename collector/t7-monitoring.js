/** Pure T7 parsing and stream-diagnostic helpers. No adaptive-learning imports. */

export function normalizeT7Entry(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const periodId = String(raw.issue ?? '').trim();
  const size = String(raw.size ?? '').trim().toUpperCase();
  if (!periodId || (size !== 'BIG' && size !== 'SMALL')) return null;

  const num = (value) => {
    const number = typeof value === 'string' ? Number(value) : value;
    return typeof number === 'number' && Number.isFinite(number) ? number : null;
  };
  const bool = (value) => (typeof value === 'boolean' ? value : null);
  const iso = (value) => (num(value) !== null ? new Date(num(value)).toISOString() : null);
  const str = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

  return {
    period_id: periodId,
    signal: size,
    confidence: num(raw.confidence),
    color: str(raw.color) ? str(raw.color).toUpperCase() : null,
    status: str(raw.status) ? str(raw.status).toLowerCase() : null,
    source: str(raw.source),
    algorithm_version: num(raw.algorithmVersion),
    guard_applied: bool(raw.guardApplied),
    actual_number: num(raw.actualNumber),
    actual_color: str(raw.actualColor),
    size_hit: bool(raw.sizeHit),
    color_hit: bool(raw.colorHit),
    settled_at: iso(raw.settledAt),
    prediction_created_at: iso(raw.createdAt),
  };
}

export function isFinalizedT7Entry(entry) {
  return Boolean(entry && ['BIG', 'SMALL'].includes(entry.signal)
    && ['win', 'loss'].includes(entry.status)
    && entry.actual_number !== null && entry.actual_number !== undefined
    && entry.settled_at);
}

export function compareT7Periods(left, right) {
  try {
    const a = BigInt(left);
    const b = BigInt(right);
    return a < b ? -1 : a > b ? 1 : 0;
  } catch {
    return String(left).localeCompare(String(right));
  }
}

function nextT7Period(period) {
  const match = String(period ?? '').match(/^(\d{8})10005(\d{4})$/);
  if (!match) return String(BigInt(period) + 1n);
  const sequence = Number(match[2]);
  if (sequence < 2880) return String(BigInt(period) + 1n);
  const date = new Date(`${match[1].slice(0, 4)}-${match[1].slice(4, 6)}-${match[1].slice(6, 8)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return `${date.toISOString().slice(0, 10).replaceAll('-', '')}100050001`;
}

/** Report gaps observed inside the provider's own returned history sequence. */
export function detectT7StreamGaps(entries, observedAt = new Date().toISOString()) {
  const periods = [...new Set(entries.map((entry) => entry?.period_id).filter(Boolean))]
    .sort(compareT7Periods);
  const gaps = [];
  for (let index = 0; index < periods.length - 1; index++) {
    const fromPeriod = periods[index];
    const toPeriod = periods[index + 1];
    let candidate = nextT7Period(fromPeriod);
    let examined = 0;
    while (compareT7Periods(candidate, toPeriod) < 0 && examined < 2000) {
      gaps.push({
        period: candidate,
        type: 'missing_t7',
        firstDetectedAt: observedAt,
        lastDetectedAt: observedAt,
        evidence: { fromPeriod, toPeriod, source: 'provider_history_sequence' },
        resolved: false,
      });
      candidate = nextT7Period(candidate);
      examined++;
    }
    if (examined >= 2000 && compareT7Periods(candidate, toPeriod) < 0) {
      gaps.push({
        period: `${fromPeriod}..${toPeriod}`,
        type: 'missing_t7',
        firstDetectedAt: observedAt,
        lastDetectedAt: observedAt,
        evidence: { fromPeriod, toPeriod, source: 'provider_history_sequence', truncated: true },
        resolved: false,
      });
    }
  }
  return gaps;
}

export class T7Diagnostics {
  constructor() {
    this.pending = new Map();
    this.gaps = new Map();
  }

  seedPending(row, now = new Date().toISOString()) {
    if (!row?.period_id || row.status !== 'pending') return;
    const period = String(row.period_id);
    const current = this.pending.get(period);
    this.pending.set(period, {
      period,
      signal: row.signal ?? null,
      predictionCreatedAt: row.prediction_created_at ?? null,
      firstSeenAt: current?.firstSeenAt ?? row.stored_at ?? now,
      lastSeenAt: current?.lastSeenAt ?? row.stored_at ?? now,
      state: current?.state ?? 'pending',
      providerWindowOldestPeriod: current?.providerWindowOldestPeriod ?? null,
      providerWindowNewestPeriod: current?.providerWindowNewestPeriod ?? null,
    });
  }

  observeEntry(entry, observedAt = new Date().toISOString()) {
    if (!entry?.period_id) return;
    const period = String(entry.period_id);
    const gap = this.gaps.get(period);
    if (gap) {
      gap.resolved = true;
      gap.lastDetectedAt = observedAt;
      gap.evidence = { ...gap.evidence, resolvedBy: 'provider_history_entry', resolvedAt: observedAt };
    }
    if (isFinalizedT7Entry(entry)) {
      const pending = this.pending.get(period);
      if (pending) {
        pending.state = 'resolved';
        pending.lastSeenAt = observedAt;
      }
      return;
    }
    if (entry.status !== 'pending') return;
    const existing = this.pending.get(period);
    this.pending.set(period, {
      period,
      signal: entry.signal ?? existing?.signal ?? null,
      predictionCreatedAt: existing?.predictionCreatedAt ?? entry.prediction_created_at ?? null,
      firstSeenAt: existing?.firstSeenAt ?? observedAt,
      lastSeenAt: observedAt,
      state: 'pending',
      providerWindowOldestPeriod: existing?.providerWindowOldestPeriod ?? null,
      providerWindowNewestPeriod: existing?.providerWindowNewestPeriod ?? null,
    });
  }

  observeHistory(entries, observedAt = new Date().toISOString()) {
    const resolvedPeriods = [];
    for (const entry of entries) {
      const existing = this.gaps.get(entry?.period_id);
      this.observeEntry(entry, observedAt);
      if (existing && this.gaps.get(entry?.period_id)?.resolved) resolvedPeriods.push(String(entry.period_id));
    }
    const gaps = detectT7StreamGaps(entries, observedAt);
    for (const gap of gaps) {
      const existing = this.gaps.get(gap.period);
      this.gaps.set(gap.period, existing ? {
        ...existing,
        lastDetectedAt: observedAt,
        evidence: { ...existing.evidence, ...gap.evidence },
      } : gap);
    }
    return { gaps, resolvedPeriods };
  }

  expirePending(oldestPeriod, newestPeriod, observedAt = new Date().toISOString()) {
    const expired = [];
    if (!oldestPeriod) return expired;
    for (const pending of this.pending.values()) {
      if (pending.state !== 'pending' || compareT7Periods(pending.period, oldestPeriod) >= 0) continue;
      pending.state = 'provider_window_expired';
      pending.lastSeenAt = pending.lastSeenAt ?? observedAt;
      pending.providerWindowOldestPeriod = oldestPeriod;
      pending.providerWindowNewestPeriod = newestPeriod ?? null;
      expired.push(pending);
    }
    return expired;
  }

  status() {
    const pending = [...this.pending.values()].filter((entry) => entry.state === 'pending');
    const expiredPending = [...this.pending.values()].filter((entry) => entry.state === 'provider_window_expired');
    const gaps = [...this.gaps.values()].filter((gap) => !gap.resolved);
    return { pending, expiredPending, gaps };
  }
}
