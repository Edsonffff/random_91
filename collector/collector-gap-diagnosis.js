/** Diagnostic-only arithmetic and evidence summaries. No ingestion or algorithms. */
export const REPRESENTATIVE_GAPS = Object.freeze([
  { id: 'A', before: '20261002100052301', after: '20261002100052348' },
  { id: 'B', before: '20261004100051639', after: '20261004100051709' },
  { id: 'C', before: '20261004100052128', after: '20261004100052436' },
  { id: 'D', before: '20261007100052312', after: '20261008100050021' },
]);
const DAY_MS = 86_400_000;
const ROUNDS_PER_DAY = 2880;
export const ROUND_SECONDS = 30;

function periodParts(period) {
  const match = String(period).match(/^(\d{4})(\d{2})(\d{2})10005(\d{4})$/);
  if (!match) throw new Error(`Unsupported WinGo 30S period: ${period}`);
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const midnight = Date.parse(`${date}T00:00:00.000Z`);
  const sequence = Number(match[4]);
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== date
    || sequence < 1 || sequence > ROUNDS_PER_DAY) throw new Error(`Invalid WinGo 30S period: ${period}`);
  return { midnight, sequence };
}

export function periodOrdinal(period) {
  const { midnight, sequence } = periodParts(period);
  return midnight / DAY_MS * ROUNDS_PER_DAY + sequence - 1;
}

export function periodAtOrdinal(ordinal) {
  const day = Math.floor(ordinal / ROUNDS_PER_DAY);
  const sequence = ordinal - day * ROUNDS_PER_DAY + 1;
  return `${new Date(day * DAY_MS).toISOString().slice(0, 10).replaceAll('-', '')}10005${String(sequence).padStart(4, '0')}`;
}

export function scheduledSettlement(period) {
  const { midnight, sequence } = periodParts(period);
  return new Date(midnight + sequence * ROUND_SECONDS * 1000).toISOString();
}

export function describeGap(gap, windowSize = null) {
  const firstOrdinal = periodOrdinal(gap.before) + 1;
  const missingCount = periodOrdinal(gap.after) - firstOrdinal;
  if (missingCount < 0) throw new Error('Gap boundaries are reversed.');
  const missingPeriods = Array.from({ length: missingCount }, (_, index) => periodAtOrdinal(firstOrdinal + index));
  return {
    ...gap,
    firstMissing: missingPeriods[0] ?? null,
    lastMissing: missingPeriods.at(-1) ?? null,
    missingCount,
    missingPeriodDurationSeconds: missingCount * ROUND_SECONDS,
    missingPeriods,
    windowOverflowModel: windowSize > 0 ? {
      assumedConsecutiveWindowSize: windowSize,
      assumedNewPeriodsBetweenSuccessfulCaptures: missingCount + windowSize,
      inferredSuccessToSuccessSeconds: (missingCount + windowSize) * ROUND_SECONDS,
      assumedRecoveryWindow: {
        oldest: gap.after,
        newest: periodAtOrdinal(periodOrdinal(gap.after) + windowSize - 1),
      },
      caveat: 'Conditional model, not an observed outage: assumes prior capture ended at before, a complete consecutive window was next ingested, no deletions, and no independent writer.',
    } : null,
  };
}

export function windowLoss(newPeriodsWithoutCapture, windowSize) {
  if (!Number.isSafeInteger(newPeriodsWithoutCapture) || newPeriodsWithoutCapture < 0
    || !Number.isSafeInteger(windowSize) || windowSize < 0) throw new Error('Expected non-negative integer counts.');
  return {
    newPeriodsWithoutCapture,
    windowSize,
    stillInReturnedWindow: Math.min(newPeriodsWithoutCapture, windowSize),
    permanentlyMissedWithoutArchive: Math.max(0, newPeriodsWithoutCapture - windowSize),
  };
}

export function outageLossBounds(outageSeconds, windowSize) {
  if (!Number.isFinite(outageSeconds) || outageSeconds < 0) throw new Error('Expected non-negative finite duration.');
  return {
    outageSeconds,
    minimum: windowLoss(Math.floor(outageSeconds / ROUND_SECONDS), windowSize),
    maximum: windowLoss(Math.ceil(outageSeconds / ROUND_SECONDS), windowSize),
    assumptions: 'Consecutive fixed-size source window; outage is measured between successful captures, includes scheduling/startup/processing delays, and fetched rows persist successfully afterward.',
  };
}

export function summarizeWindow(periods) {
  const unique = [...new Set(periods.filter(Boolean).map(String))].sort();
  let consecutive = unique.length > 0;
  try {
    for (let index = 1; index < unique.length; index++) {
      if (periodOrdinal(unique[index]) !== periodOrdinal(unique[index - 1]) + 1) consecutive = false;
    }
  } catch { consecutive = false; }
  return { uniquePeriodCount: unique.length, oldest: unique[0] ?? null, newest: unique.at(-1) ?? null, consecutive };
}

function timestampRange(values) {
  const valid = values.filter((value) => typeof value === 'string' && Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return { earliest: valid[0] ?? null, latest: valid.at(-1) ?? null };
}

export function summarizeGapEvidence(gap, historyRows, t7Rows) {
  const missing = new Set(gap.missingPeriods);
  const foundHistory = historyRows.filter((row) => missing.has(String(row.issue_number)));
  const signals = t7Rows.filter((row) => missing.has(String(row.period_id)));
  const boundary = (period) => historyRows.find((row) => String(row.issue_number) === period) ?? null;
  const startMs = Date.parse(scheduledSettlement(gap.before));
  const endMs = Date.parse(scheduledSettlement(gap.after));
  const storedDuringGap = signals.filter((row) => {
    const stored = Date.parse(row.created_at ?? row.stored_at);
    return stored > startMs && stored < endMs;
  });
  return {
    missingHistoryStillAbsent: foundHistory.length === 0,
    historyRowsFoundInsideReportedGap: foundHistory.map((row) => row.issue_number),
    before: boundary(gap.before),
    after: boundary(gap.after),
    t7InsideHistoryGap: {
      storedCount: signals.length,
      absentCount: gap.missingCount - new Set(signals.map((row) => row.period_id)).size,
      rowCreationTimes: timestampRange(signals.map((row) => row.created_at)),
      latestWriteTimes: timestampRange(signals.map((row) => row.stored_at)),
      rowsCreatedDuringScheduledGap: storedDuringGap.length,
      inference: storedDuringGap.length
        ? 'T7 rows were being created during the history gap. This argues against a continuous outage of every project writer; it does not identify which process/device wrote them.'
        : 'No contemporaneous T7 row creation found. Phone/process/network downtime and source/persistence failure remain observationally compatible.',
    },
  };
}

export function summarizePollAudits(rows) {
  const sorted = [...rows].sort((a, b) => Date.parse(a.poll_started_at) - Date.parse(b.poll_started_at));
  const errorCounts = {};
  let largestPollStartGapSeconds = null;
  for (let index = 0; index < sorted.length; index++) {
    if (sorted[index].error_message) {
      const message = String(sorted[index].error_message).slice(0, 200);
      errorCounts[message] = (errorCounts[message] ?? 0) + 1;
    }
    if (index) {
      const seconds = (Date.parse(sorted[index].poll_started_at) - Date.parse(sorted[index - 1].poll_started_at)) / 1000;
      largestPollStartGapSeconds = Math.max(largestPollStartGapSeconds ?? 0, seconds);
    }
  }
  return {
    rows: rows.length,
    firstPoll: sorted[0]?.poll_started_at ?? null,
    lastPoll: sorted.at(-1)?.poll_started_at ?? null,
    responseOkCount: rows.filter((row) => row.response_ok).length,
    errorCounts,
    largestPollStartGapSeconds,
    caveat: 'These are T7 poll metadata, not official draw-history HTTP/write logs. Missing audit rows alone cannot prove the process stopped; audit writes can also fail.',
  };
}

/** Instrumented GET/HEAD-only transport shared by upstream and Supabase reads. */
export function createReadOnlyTransport(fetcher = fetch) {
  const operations = { requestCount: 0, methods: {}, refusedWrites: 0 };
  const readOnlyFetch = async (input, options = {}) => {
    const requestMethod = input instanceof Request ? input.method : 'GET';
    const method = String(options.method ?? requestMethod).toUpperCase();
    if (!['GET', 'HEAD'].includes(method) || options.body != null || (input instanceof Request && input.body !== null)) {
      operations.refusedWrites++;
      throw new Error(`Root-cause diagnostic refused non-read request: ${method}`);
    }
    operations.requestCount++;
    operations.methods[method] = (operations.methods[method] ?? 0) + 1;
    return fetcher(input, { ...options, method, signal: options.signal ?? AbortSignal.timeout(30_000) });
  };
  return { readOnlyFetch, operations };
}
