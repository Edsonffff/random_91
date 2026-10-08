/** Pure reporting helpers for the read-only historical recovery audit. */

export const HISTORY_GAP = Object.freeze({
  lastAvailablePeriod: '20261002100052301',
  firstMissingPeriod: '20261002100052302',
  lastMissingPeriod: '20261002100052347',
  nextAvailablePeriod: '20261002100052348',
});

export const UNRESOLVED_T7_PERIODS = Object.freeze([
  '20261002100052220',
  '20261002100052221',
  '20261003100052220',
  '20261003100052221',
  '20261005100052220',
  '20261005100052221',
  '20261005100052819',
]);

export const OFFICIAL_HISTORY_HOSTS = Object.freeze([
  'https://draw.ar-lottery02.com',
  'https://draw.ar-lottery03.com',
  'https://draw.ar-lottery01.com',
]);

export const OFFICIAL_HISTORY_PATH = '/WinGo/WinGo_30S/GetHistoryIssuePage.json';
export const BDGTHARU_URL = 'https://bdgtharu.com/api.php';

export function periodRange(first, last) {
  const periods = [];
  for (let period = BigInt(first); period <= BigInt(last); period += 1n) periods.push(String(period));
  return periods;
}

export function normalizeHistoryRow(row) {
  if (!row || typeof row !== 'object') return null;
  const period = String(row.issue_number ?? row.issueNumber ?? '').trim();
  const rawNumber = row.number ?? row.winning_number ?? row.winningNumber;
  const number = typeof rawNumber === 'number' ? rawNumber : Number(rawNumber);
  if (!period || !Number.isInteger(number) || number < 0 || number > 9) return null;
  return {
    period,
    winningNumber: number,
    size: number >= 5 ? 'Big' : 'Small',
    sourceTime: row.source_time ?? row.completed_at ?? row.created_at ?? null,
  };
}

export function normalizeOfficialHistoryPayload(payload) {
  const list = payload?.data?.list;
  if (!Array.isArray(list)) return [];
  return list.map(normalizeHistoryRow).filter(Boolean);
}

export function normalizeT7Row(row) {
  if (!row || typeof row !== 'object') return null;
  const period = String(row.period_id ?? row.issue ?? '').trim();
  const signal = String(row.signal ?? row.size ?? '').trim().toUpperCase();
  if (!period) return null;
  return {
    period,
    signal: signal === 'BIG' || signal === 'SMALL' ? signal : null,
    status: row.status ?? null,
    actualNumber: row.actual_number ?? row.actualNumber ?? null,
    settledAt: row.settled_at ?? row.settledAt ?? null,
    source: row.source ?? null,
    predictionCreatedAt: row.prediction_created_at ?? row.createdAt ?? null,
    raw: row,
  };
}

export function normalizeBdgTharuPayload(payload) {
  const rawEntries = [payload?.prediction, ...(Array.isArray(payload?.history) ? payload.history : [])];
  const entries = rawEntries.map(normalizeT7Row).filter(Boolean);
  return [...new Map(entries.map((entry) => [entry.period, entry])).values()];
}

function sourceLabel(source, period) {
  return { source, period };
}

export function buildHistoryPeriodReports(periods, sourceMatches = new Map(), repositoryMatches = new Map()) {
  return periods.map((period) => {
    const matches = sourceMatches.get(period) ?? [];
    const repository = repositoryMatches.get(period) ?? [];
    const authoritative = matches.filter((match) => match.authoritative);
    return {
      period,
      recoverable: authoritative.length > 0,
      exactValue: authoritative[0]?.value ?? null,
      sources: matches,
      repositoryMatches: repository,
      authorityStatus: authoritative.length ? 'authoritative_source_available' : 'no_authoritative_source',
      verificationStatus: authoritative.length ? 'source_value_available_for_cross-check' : 'not_verifiable',
      projectLogicVerification: authoritative.length ? 'number_and_big_small_derivation_can_be_checked' : 'no_value_to_verify',
    };
  });
}

export function buildT7PeriodReports(periods, storedRows = new Map(), sourceMatches = new Map(), repositoryMatches = new Map()) {
  return periods.map((period) => {
    const stored = storedRows.get(period) ?? null;
    const signal = stored?.signal ?? null;
    const matches = sourceMatches.get(period) ?? [];
    const providerMatch = matches.find((match) => match.authoritative && match.independentlyVerifiable && match.signal);
    const predictionExists = signal === 'BIG' || signal === 'SMALL';
    const recoverable = predictionExists || Boolean(providerMatch);
    const completeFinalizedRecovery = matches.some((match) => match.authoritative && match.finalized);
    return {
      period,
      predictionExists,
      prediction: signal ?? providerMatch?.signal ?? null,
      currentStoredStatus: stored?.status ?? 'row_missing',
      storedRow: stored?.raw ?? null,
      possibleAuthoritativeRecoverySources: matches,
      recoverable,
      completeFinalizedRecovery,
      deterministic: recoverable,
      independentlyVerified: Boolean(providerMatch),
      verificationStatus: providerMatch
        ? 'provider_entry_matches_stored_or_missing_prediction'
        : predictionExists
          ? 'stored_capture_only; provider_historical_entry_not_available'
          : 'no_authoritative_prediction_source',
      projectLogicVerification: recoverable
        ? 'signal_shape_can_be_checked; T7_provider_prediction_cannot_be_rederived_by_project_algorithms'
        : 'not_available',
      safeToRepair: false,
      repositoryMatches: repositoryMatches.get(period) ?? [],
    };
  });
}

export function summarizeReports(reports) {
  return {
    total: reports.length,
    recoverableCount: reports.filter((report) => report.recoverable).length,
    unrecoverableCount: reports.filter((report) => !report.recoverable).length,
    recoverablePeriods: reports.filter((report) => report.recoverable).map((report) => report.period),
    unrecoverablePeriods: reports.filter((report) => !report.recoverable).map((report) => report.period),
  };
}

export function sourceMatch(source, value, options = {}) {
  return {
    ...sourceLabel(source, options.period),
    value: value ?? null,
    signal: options.signal ?? null,
    finalized: Boolean(options.finalized),
    authoritative: Boolean(options.authoritative),
    independentlyVerifiable: Boolean(options.independentlyVerifiable),
    note: options.note ?? null,
  };
}
