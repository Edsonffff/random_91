/**
 * Read-only pending-T7 investigation. Run from the repository root:
 * node --env-file=.env --env-file=collector/.env collector/diagnose-pending-t7.mjs
 * Optional: --status-url=http://localhost:9000/api/adaptive-learning/current
 *
 * No runtime/engine is instantiated. All database requests are SELECTs;
 * the transport rejects any method other than GET/HEAD.
 */
import { createClient } from '@supabase/supabase-js';
import { browserHistoryRecord, BASELINE_CHECKPOINT_KEY } from './adaptive-learning-store.js';
import { finalizedT7, nextPeriod } from './adaptive-runtime.js';
import { normalizeT7Entry, compareT7Periods } from './t7-monitoring.js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');

const readOnlyFetch = (input, options = {}) => {
  const method = String(options.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (!['GET', 'HEAD'].includes(method)) throw new Error(`Diagnostic refused non-read-only request: ${method}`);
  return fetch(input, { ...options, signal: options.signal ?? AbortSignal.timeout(30_000) });
};
const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: 'public' },
  global: { fetch: readOnlyFetch },
});

function checked(result, operation) {
  if (result.error) throw new Error(`${operation}: ${result.error.message}`);
  return result.data;
}

// Keyset pagination avoids silently truncating the tail at PostgREST's limit.
async function selectRange(table, column, after, cutoff, game = false) {
  const rows = [];
  let cursor = after;
  for (;;) {
    let query = client.from(table).select('*').gt(column, cursor).lte(column, cutoff)
      .order(column, { ascending: true }).limit(1000);
    if (game) query = query.eq('game_code', 'WinGo_30S');
    const page = checked(await query, `Read ${table}`);
    if (!page.length) break;
    rows.push(...page);
    cursor = String(page.at(-1)[column]);
  }
  let countQuery = client.from(table).select(column, { head: true, count: 'exact' })
    .gt(column, after).lte(column, cutoff);
  if (game) countQuery = countQuery.eq('game_code', 'WinGo_30S');
  const count = await countQuery;
  checked(count, `Count ${table}`);
  if (count.count !== rows.length) throw new Error(`${table} changed during capture or pagination was incomplete; rerun the diagnostic.`);
  return rows;
}

function readinessReasons(history, t7) {
  if (!history) return ['history_missing'];
  if (!t7) return ['t7_row_missing'];
  const reasons = [];
  if (t7.period_id !== history.issue_number) reasons.push('period_id_mismatch');
  if (!['BIG', 'SMALL'].includes(t7.signal)) reasons.push('invalid_signal');
  if (!['win', 'loss'].includes(t7.status)) reasons.push('status_not_final');
  if (!t7.settled_at) reasons.push('settled_at_missing');
  if (t7.actual_number == null) reasons.push('actual_number_missing');
  else if (t7.actual_number !== browserHistoryRecord(history).winningNumber) reasons.push('actual_number_mismatch');
  return reasons;
}

const startedAt = new Date().toISOString();
const checkpoint = checked(await client.from('wingo_adaptive_checkpoints').select('game_code,state,updated_at')
  .eq('game_code', BASELINE_CHECKPOINT_KEY).single(), 'Read active baseline checkpoint');
const cursor = checkpoint.state?.period;
if (!cursor) throw new Error('Active checkpoint has no evaluated cursor.');
const newest = checked(await client.from('real_wingo_30s_history').select('issue_number')
  .eq('game_code', 'WinGo_30S').order('issue_number', { ascending: false }).limit(1), 'Read history cutoff');
const cutoff = newest[0]?.issue_number;
if (!cutoff) throw new Error('No history cutoff available.');
const [historyRows, signalRows] = await Promise.all([
  selectRange('real_wingo_30s_history', 'issue_number', cursor, cutoff, true),
  selectRange('wingo_t7_signals', 'period_id', cursor, cutoff),
]);
const signals = new Map(signalRows.map((row) => [row.period_id, row]));
const checkpointSignals = new Map(checkpoint.state?.runtime?.t7Signals ?? []);
const pending = historyRows.filter((history) => !finalizedT7(signals.get(history.issue_number), browserHistoryRecord(history)));
const historyGaps = [];
let predecessor = cursor;
for (const history of historyRows) {
  const expected = nextPeriod(predecessor);
  if (history.issue_number !== expected) historyGaps.push({ after: predecessor, expectedNext: expected, nextStored: history.issue_number });
  predecessor = history.issue_number;
}

let provider;
try {
  const response = await readOnlyFetch(`https://bdgtharu.com/api.php?_=${Date.now()}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  const entries = [body.prediction, ...(Array.isArray(body.history) ? body.history : [])]
    .map(normalizeT7Entry).filter(Boolean);
  const periods = [...new Set(entries.map((entry) => entry.period_id))].sort(compareT7Periods);
  provider = {
    capturedAt: new Date().toISOString(),
    currentPrediction: body.prediction?.issue ?? null,
    historyCount: Array.isArray(body.history) ? body.history.length : null,
    oldestReturnedPeriod: periods[0] ?? null,
    newestReturnedPeriod: periods.at(-1) ?? null,
    historicalBackfillSupported: false,
    matches: entries.filter((entry) => pending.some((history) => history.issue_number === entry.period_id)),
  };
} catch (error) {
  provider = { error: error.message, historicalBackfillSupported: false };
}

const pendingPeriods = pending.map((history) => history.issue_number);
const diagnosticRows = pendingPeriods.length ? await client.from('wingo_t7_pending_diagnostics').select('*')
  .in('period_id', pendingPeriods) : { data: [], error: null };
const diagnostics = new Map((diagnosticRows.data ?? []).map((row) => [row.period_id, row]));
const results = pending.map((history) => {
  const period = history.issue_number;
  const t7 = signals.get(period) ?? null;
  const cached = checkpointSignals.get(period) ?? null;
  return {
    period,
    historyExists: true,
    history: { number: history.number, created_at: history.created_at, source_time: history.source_time },
    t7Exists: Boolean(t7),
    // Preserve the complete durable row, including all timestamps/settled fields.
    t7,
    eligibleForAdaptiveEvaluation: finalizedT7(t7, browserHistoryRecord(history)),
    ineligibleReasons: readinessReasons(history, t7),
    checkpointCachedT7: cached,
    checkpointCachedT7Eligible: cached ? finalizedT7(cached, browserHistoryRecord(history)) : false,
    operationalDiagnostic: diagnostics.get(period) ?? null,
    presentInCurrentProviderResponse: provider.matches?.some((entry) => entry.period_id === period) ?? null,
    outsideCurrentProviderWindow: provider.oldestReturnedPeriod
      ? compareT7Periods(period, provider.oldestReturnedPeriod) < 0 : null,
  };
});

const statusArg = process.argv.slice(2).find((arg) => arg.startsWith('--status-url='));
let liveStatus = null;
if (statusArg) {
  try {
    const response = await readOnlyFetch(statusArg.slice('--status-url='.length));
    liveStatus = { httpStatus: response.status, body: await response.json() };
  } catch (error) {
    liveStatus = { error: error.message };
  }
}
const afterCheckpoint = checked(await client.from('wingo_adaptive_checkpoints').select('state,updated_at')
  .eq('game_code', BASELINE_CHECKPOINT_KEY).single(), 'Recheck active checkpoint');
if (JSON.stringify(afterCheckpoint.state) !== JSON.stringify(checkpoint.state)
  || afterCheckpoint.updated_at !== checkpoint.updated_at) {
  throw new Error('Checkpoint changed during diagnostic; rerun against the new cursor.');
}

console.log(JSON.stringify({
  readOnly: true,
  startedAt,
  completedAt: new Date().toISOString(),
  checkpointUnchangedDuringDiagnostic: true,
  checkpoint: {
    key: checkpoint.game_code,
    baselineId: checkpoint.state.baseline?.baselineId,
    baselineStartPeriod: checkpoint.state.baseline?.baselineStartPeriod,
    baselineReason: checkpoint.state.baseline?.reason,
    latestEvaluatedPeriod: cursor,
    updatedAt: checkpoint.updated_at,
  },
  capture: {
    historyCutoff: cutoff,
    historyRowsAfterCursor: historyRows.length,
    t7RowsAfterCursor: signalRows.length,
    locallyFinalizedHistoryRows: historyRows.length - results.length,
    pendingT7Count: results.length,
    oldestPendingT7: results[0]?.period ?? null,
    matchesReportedSeven: results.length === 7,
    note: 'Pending count is reconstructed from durable inputs; the live runtime uses its cached T7 map for this count.',
    historyGaps,
  },
  liveStatus,
  provider,
  diagnosticTableError: diagnosticRows.error?.message ?? null,
  pending: results,
}, null, 2));
