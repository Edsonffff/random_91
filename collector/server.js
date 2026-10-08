import http from 'http';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { startAdaptiveWorker } from './adaptive-learning-worker.js';
import { AdaptiveCoordinator } from './adaptive-coordinator.js';
import {
  compareT7Periods,
  normalizeT7Entry,
  T7Diagnostics,
} from './t7-monitoring.js';
import { T7IngestionLedger } from './t7-ingestion.js';
import { startVerifiedMaxLossWorker } from './verified-max-loss-worker.js';
import { RetryableSerialQueue } from './serial-persistence-queue.js';
import {
  compareHistoryPeriods,
  createDeadline,
  detectHistoryGaps,
  fetchJsonWithFailover,
  HistorySpool,
} from './history-spool.js';

// Load local environment variables if present
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '30000', 10);
const RETRY_DELAY_MS = parseInt(process.env.RETRY_DELAY_MS || '10000', 10);
const HISTORY_REQUEST_TIMEOUT_MS = parseInt(process.env.HISTORY_REQUEST_TIMEOUT_MS || '15000', 10);
const HISTORY_SUPABASE_TIMEOUT_MS = parseInt(process.env.HISTORY_SUPABASE_TIMEOUT_MS || '15000', 10);
const HISTORY_SPOOL_DIR = process.env.HISTORY_SPOOL_DIR || `${process.cwd()}/.history-spool`;
const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = '0.0.0.0';

// ─── Test 7 prediction source: https://bdgtharu.com/api.php ─────────────────
// This REPLACES the old WingoAI source (https://server.wingoaibot.com/signals/current).
// The request is made HERE, server-side. The React frontend never contacts this
// host — it only reads what this collector stores in Supabase.
// BDGTharu uses an unauthenticated GET request.
const T7_API_BASE_URL = 'https://bdgtharu.com/api.php';
const T7_SIGNAL_TABLE = 'wingo_t7_signals';

// Timeout for a single T7 request. The polling cadence (5s) stays
// separate: a slow upstream simply makes a cycle overrun, it does not stack.
const T7_REQUEST_TIMEOUT_MS = 15000;
const T7_POLL_AUDIT_TABLE = 'wingo_t7_poll_audit';
const T7_PENDING_DIAGNOSTICS_TABLE = 'wingo_t7_pending_diagnostics';
const T7_GAP_DIAGNOSTICS_TABLE = 'wingo_t7_gap_diagnostics';
const T7_AUDIT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const T7_AUDIT_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const OFFICIAL_WINGO_HISTORY_PATH = '/WinGo/WinGo_30S/GetHistoryIssuePage.json';
const OFFICIAL_WINGO_HISTORY_URL = 'https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json';
const OFFICIAL_WINGO_HISTORY_HOSTS = [
  OFFICIAL_WINGO_HISTORY_URL.replace(OFFICIAL_WINGO_HISTORY_PATH, ''),
  'https://draw.ar-lottery02.com',
  'https://draw.ar-lottery03.com',
];

let adaptiveWorker;
let adaptiveCoordinator;
let adaptiveRetryTimer;
let verifiedMaxLossWorker;
let adaptiveCurrent = { success: false, status: 'initializing' };

function notifyAdaptive(period) {
  if (!running || !adaptiveCoordinator) return;
  if (t7PersistenceQueue?.status().pendingCount > 0) return;
  adaptiveCoordinator.onSettledPeriod({ period }).catch((error) => {
    adaptiveCurrent = { success: false, status: 'error', error: 'Adaptive runtime unavailable; retrying.', checkpointStatus: 'pending_retry',
      latestEvaluatedPeriod: adaptiveCurrent.latestEvaluatedPeriod ?? null, checkpointAt: adaptiveCurrent.checkpointAt ?? null };
    logError(`[ADAPTIVE] status=retrying detail=${error.message}`);
  });
}

function getTimestamp() {
  return new Date().toISOString();
}

function log(message) {
  console.log(`[${getTimestamp()}] ${message}`);
}

function logError(message) {
  console.error(`[${getTimestamp()}] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Result color classification matching official game logic
function parseOfficialColors(rawColor, num) {
  if (rawColor) {
    const parts = rawColor.split(',').map((c) => c.trim().toLowerCase());
    const valid = parts.filter((c) => ['red', 'green', 'violet'].includes(c));
    if (valid.length > 0) return valid;
  }
  if (num === 0) return ['red', 'violet'];
  if (num === 5) return ['green', 'violet'];
  return num % 2 === 0 ? ['red'] : ['green'];
}

// Format record matching public.real_wingo_30s_history schema
function formatRecordForSupabase(item, serviceTime, timeType = 'iso') {
  const issue = String(item.issueNumber || '').trim();
  const rawNum = item.number;
  const num = typeof rawNum === 'number' ? rawNum : parseInt(String(rawNum ?? ''), 10);
  const colors = parseOfficialColors(item.color, num);
  const colorStr = colors.join(',');
  const completedAt = serviceTime ? new Date(serviceTime).toISOString() : new Date().toISOString();

  return {
    game_code: 'WinGo_30S',
    issue_number: issue,
    number: isNaN(num) ? 0 : num,
    color: colorStr,
    premium: String(item.premium ?? num),
    sum: typeof item.sum === 'number' ? item.sum : 0,
    source: 'COMPLETED REAL HISTORY',
    source_time:
      timeType === 'millis'
        ? Date.parse(completedAt) || Date.now()
        : completedAt,
  };
}

/**
 * Timing & dedup state for Test 7 (bdgtharu.com) predictions.
 */
const T7_POLL_INTERVAL_MS = 5000;
let isT7Polling = false;
let t7PollingRunning = false;
let lastT7PollStartedAt = null;
let lastT7PollCompletedAt = null;
let lastT7PollStatus = 'initializing';
let lastPendingT7Observation = null;
let lastT7PollError = null;
let t7CurrentProviderPeriod = null;
let t7WindowOldestPeriod = null;
let t7WindowNewestPeriod = null;
let t7HistoryCount = 0;
let lastT7AuditPrunedAt = 0;
let t7AuditSchemaWarned = false;
let t7DiagnosticsSchemaWarned = false;
const knownT7Periods = new Set();
const inMemoryT7Signals = new Map();
const t7Diagnostics = new T7Diagnostics();
let latestT7Timing = null;
// Flipped once if the bdgtharu column migration has not been applied yet, so the
// actionable hint is logged a single time instead of on every poll.
let t7SchemaWarned = false;
let t7WriteSchemaWarned = false;

// Columns added by supabase/migrations/20261002_wingo_t7_signals_bdgtharu.sql
const T7_EXTRA_COLUMNS = [
  'color',
  'status',
  'source',
  'algorithm_version',
  'guard_applied',
  'actual_number',
  'actual_color',
  'size_hit',
  'color_hit',
  'settled_at',
  'prediction_created_at',
];

async function storeT7Signal(supabaseClient, signalRow) {
  // `upsert ... onConflict: 'period_id'` makes a duplicate row impossible even
  // if the in-memory dedup set is stale, because period_id is the primary key.
  const { error } = await supabaseClient
    .from('wingo_t7_signals')
    .upsert([signalRow], { onConflict: 'period_id' });

  if (error) {
    isDbConnected = false;
    const missingColumn =
      error.code === '42703' ||
      /column .* does not exist/i.test(error.message) ||
      /Could not find the '.*' column/i.test(error.message);

    if (missingColumn) {
      // Log the cause once, not once per row per poll.
      if (!t7WriteSchemaWarned) {
        t7WriteSchemaWarned = true;
        logError(
          '[T7] Supabase is missing the bdgtharu columns, so nothing is being stored. Apply ' +
            'supabase/migrations/20261002_wingo_t7_signals_bdgtharu.sql once. ' +
            'Polling continues and will start persisting immediately after.'
        );
      }
    } else {
      logError(`Failed to store T7 prediction for period ${signalRow.period_id}: ${error.message}`);
    }
    return false;
  }
  isDbConnected = true;
  return true;
}

function warnT7DiagnosticsSchema(error) {
  if (!t7DiagnosticsSchemaWarned) {
    t7DiagnosticsSchemaWarned = true;
    logError(`[T7] Diagnostic tables unavailable: ${error.message}`);
  }
}

async function saveT7PendingDiagnostic(supabaseClient, diagnostic) {
  if (!diagnostic?.period) return;
  try {
    const { error } = await supabaseClient.from(T7_PENDING_DIAGNOSTICS_TABLE).upsert([{
      period_id: diagnostic.period,
      signal: diagnostic.signal,
      prediction_created_at: diagnostic.predictionCreatedAt,
      first_seen_at: diagnostic.firstSeenAt,
      last_seen_at: diagnostic.lastSeenAt,
      state: diagnostic.state,
      provider_window_oldest_period: diagnostic.providerWindowOldestPeriod,
      provider_window_newest_period: diagnostic.providerWindowNewestPeriod,
      evidence: { source: 't7_stream' },
      updated_at: new Date().toISOString(),
    }], { onConflict: 'period_id' });
    if (error) warnT7DiagnosticsSchema(error);
  } catch (error) {
    warnT7DiagnosticsSchema(error);
  }
}

async function saveT7GapDiagnostic(supabaseClient, diagnostic) {
  if (!diagnostic?.period) return;
  try {
    const { error } = await supabaseClient.from(T7_GAP_DIAGNOSTICS_TABLE).upsert([{
      period: diagnostic.period,
      type: diagnostic.type,
      first_detected_at: diagnostic.firstDetectedAt,
      last_detected_at: diagnostic.lastDetectedAt,
      evidence: diagnostic.evidence,
      resolved: diagnostic.resolved,
      updated_at: new Date().toISOString(),
    }], { onConflict: 'period' });
    if (error) warnT7DiagnosticsSchema(error);
  } catch (error) {
    warnT7DiagnosticsSchema(error);
  }
}

async function loadT7Diagnostics(supabaseClient) {
  const [pendingResult, gapsResult] = await Promise.all([
    supabaseClient.from(T7_PENDING_DIAGNOSTICS_TABLE).select('*'),
    supabaseClient.from(T7_GAP_DIAGNOSTICS_TABLE).select('*'),
  ]);
  if (pendingResult.error || gapsResult.error) {
    warnT7DiagnosticsSchema(pendingResult.error || gapsResult.error);
    return;
  }
  for (const row of pendingResult.data || []) {
    t7Diagnostics.pending.set(String(row.period_id), {
      period: String(row.period_id),
      signal: row.signal ?? null,
      predictionCreatedAt: row.prediction_created_at ?? null,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      state: row.state,
      providerWindowOldestPeriod: row.provider_window_oldest_period ?? null,
      providerWindowNewestPeriod: row.provider_window_newest_period ?? null,
    });
  }
  for (const row of gapsResult.data || []) {
    t7Diagnostics.gaps.set(String(row.period), {
      period: String(row.period),
      type: row.type,
      firstDetectedAt: row.first_detected_at,
      lastDetectedAt: row.last_detected_at,
      evidence: row.evidence || {},
      resolved: Boolean(row.resolved),
    });
  }
}

async function observeT7Entry(supabaseClient, entry, observedAt = new Date().toISOString()) {
  t7Diagnostics.observeEntry(entry, observedAt);
  const diagnostic = t7Diagnostics.pending.get(String(entry.period_id));
  if (diagnostic) await saveT7PendingDiagnostic(supabaseClient, diagnostic);
  const gap = t7Diagnostics.gaps.get(String(entry.period_id));
  if (gap) await saveT7GapDiagnostic(supabaseClient, gap);
}

async function observeT7History(supabaseClient, entries, observedAt = new Date().toISOString()) {
  const result = t7Diagnostics.observeHistory(entries, observedAt);
  for (const gap of result.gaps) await saveT7GapDiagnostic(supabaseClient, t7Diagnostics.gaps.get(gap.period));
  for (const period of result.resolvedPeriods) await saveT7GapDiagnostic(supabaseClient, t7Diagnostics.gaps.get(period));
  return result;
}

async function expireT7Pending(supabaseClient, oldestPeriod, newestPeriod, observedAt = new Date().toISOString()) {
  for (const diagnostic of t7Diagnostics.expirePending(oldestPeriod, newestPeriod, observedAt)) {
    await saveT7PendingDiagnostic(supabaseClient, diagnostic);
  }
}

async function recordT7PollAudit(supabaseClient, audit) {
  const { error } = await supabaseClient.from(T7_POLL_AUDIT_TABLE).insert([audit]);
  if (error) {
    if (!t7AuditSchemaWarned) {
      t7AuditSchemaWarned = true;
      logError(`[T7] Poll audit unavailable: ${error.message}`);
    }
    return;
  }
  const now = Date.now();
  if (now - lastT7AuditPrunedAt < T7_AUDIT_PRUNE_INTERVAL_MS) return;
  lastT7AuditPrunedAt = now;
  const cutoff = new Date(now - T7_AUDIT_RETENTION_MS).toISOString();
  const { error: pruneError } = await supabaseClient
    .from(T7_POLL_AUDIT_TABLE)
    .delete()
    .lt('created_at', cutoff);
  if (pruneError) logError(`[T7] Poll audit retention cleanup failed: ${pruneError.message}`);
}

function t7WindowPeriods(entries) {
  const periods = [...new Set(entries.map((entry) => entry?.period_id).filter(Boolean))]
    .sort(compareT7Periods);
  return {
    oldest: periods[0] ?? null,
    newest: periods.at(-1) ?? null,
  };
}

async function supabaseResultWithDeadline(query, label, timeoutMs = HISTORY_SUPABASE_TIMEOUT_MS) {
  const deadline = createDeadline(timeoutMs, label);
  try {
    const result = await query.abortSignal(deadline.signal);
    if (result.error) throw new Error(`${label}: ${result.error.message}`);
    return result;
  } catch (error) {
    if (deadline.signal.aborted) throw new Error(`${label}: timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    deadline.clear();
  }
}

async function supabaseWithDeadline(query, label, timeoutMs = HISTORY_SUPABASE_TIMEOUT_MS) {
  return (await supabaseResultWithDeadline(query, label, timeoutMs)).data;
}

async function fetchOfficialHistoryWindow() {
  const sourceResponse = await fetchJsonWithFailover({
    hosts: OFFICIAL_WINGO_HISTORY_HOSTS,
    path: OFFICIAL_WINGO_HISTORY_PATH,
    timeoutMs: HISTORY_REQUEST_TIMEOUT_MS,
  });
  for (const failure of sourceResponse.failures) {
    logError(`[HISTORY] source failed host=${failure.host} reason=${failure.reason}; failover continued`);
  }
  if (historySourceHost && historySourceHost !== sourceResponse.host) {
    log(`[HISTORY] source failover ${historySourceHost} -> ${sourceResponse.host}`);
  }
  historySourceHost = sourceResponse.host;
  return sourceResponse;
}

function validHistoryItem(item) {
  const issueNumber = String(item?.issueNumber ?? '').trim();
  const rawNum = item?.number;
  const number = typeof rawNum === 'number' ? rawNum : parseInt(String(rawNum ?? ''), 10);
  if (!issueNumber || !Number.isInteger(number) || number < 0 || number > 9) return null;
  return { item, issueNumber };
}

async function persistHistorySpoolEntry(supabaseClient, spoolEntry) {
  const records = Array.isArray(spoolEntry.records) ? spoolEntry.records : [spoolEntry.record];
  for (const originalRecord of records) {
    const period = originalRecord.issue_number;
    if (knownPeriods.has(period)) continue;
    let recordPayload = { ...originalRecord };
    if (timeType === 'millis' && typeof recordPayload.source_time === 'string') {
      recordPayload.source_time = Date.parse(recordPayload.source_time) || Date.now();
    }
    let insertError = null;
    try {
      await supabaseWithDeadline(
        supabaseClient.from('real_wingo_30s_history').upsert([recordPayload], {
          onConflict: 'game_code,issue_number', ignoreDuplicates: true,
        }),
        `Persist history ${period}`,
      );
    } catch (error) {
      insertError = error;
    }

    if (insertError && /22007|22P02|invalid input syntax|date\/time field/i.test(insertError.message) && timeType === 'iso') {
      timeType = 'millis';
      recordPayload = { ...recordPayload, source_time: Date.parse(recordPayload.source_time) || Date.now() };
      await supabaseWithDeadline(
        supabaseClient.from('real_wingo_30s_history').upsert([recordPayload], {
          onConflict: 'game_code,issue_number', ignoreDuplicates: true,
        }),
        `Persist history ${period} retry`,
      );
      insertError = null;
    }
    if (insertError) throw insertError;

    knownPeriods.add(period);
    if (!historyNewestPersistedPeriod || compareHistoryPeriods(period, historyNewestPersistedPeriod) > 0) {
      historyNewestPersistedPeriod = period;
    }
    lastInsertedPeriod = period;
    log(`[HISTORY] period=${period} status=persisted`);
  }
  await historySpool.acknowledge(spoolEntry);
  historySpoolStatus = await historySpool.status();
  log(`[HISTORY] batch=${spoolEntry.spool_key} status=acknowledged pending_spool=${historySpoolStatus.pendingCount}`);
}

async function drainHistorySpool(supabaseClient, reason = 'poll') {
  const pending = await historySpool.listPending();
  if (!pending.length) return { pendingCount: 0, persisted: 0 };
  log(`[HISTORY] spool drain reason=${reason} pending=${pending.length}`);
  let persisted = 0;
  for (const entry of pending) {
    try {
      await persistHistorySpoolEntry(supabaseClient, entry);
      persisted++;
    } catch (error) {
      const retryCount = historySpool.recordRetry(entry.spool_key);
      historySpoolLastError = error.message;
      const periods = Array.isArray(entry.records) ? entry.records.map((record) => record.issue_number).join(',') : entry.record.issue_number;
      logError(`[HISTORY] persistence retry periods=${periods} retry=${retryCount} pending_spool=${pending.length} error=${error.message}`);
      break;
    }
  }
  const status = await historySpool.status();
  historySpoolStatus = status;
  log(`[HISTORY] spool status pending=${status.pendingCount} oldest_pending_age_ms=${status.oldestPendingAgeMs ?? 'none'} retry_count=${status.retryCount}`);
  return { pendingCount: status.pendingCount, persisted };
}

async function spoolHistoryResponse(sourceResponse) {
  const list = sourceResponse.payload?.data?.list;
  const valid = Array.isArray(list) ? list.map(validHistoryItem).filter(Boolean) : [];
  const periods = valid.map(({ issueNumber }) => issueNumber);
  const gaps = detectHistoryGaps(historyNewestPersistedPeriod, periods);
  for (const gap of gaps) {
    const alreadyReported = historyContinuityGaps.some((existing) => existing.after === gap.after && existing.observedNext === gap.observedNext);
    if (!alreadyReported) {
      historyContinuityGaps.push({ ...gap, detectedAt: getTimestamp(), source: sourceResponse.host });
      log(`[HISTORY] continuity gap detected after=${gap.after} expected_next=${gap.expectedNext} observed_next=${gap.observedNext} source=${sourceResponse.host}`);
    }
  }
  const chronological = [...valid].sort((left, right) => compareHistoryPeriods(left.issueNumber, right.issueNumber));
  const records = chronological.map(({ item }) => formatRecordForSupabase(item, sourceResponse.payload.serviceTime, timeType));
  const newRecords = records.filter((record) => !knownPeriods.has(record.issue_number));
  let spooled = 0;
  if (newRecords.length) {
    const result = await historySpool.enqueueBatch(records, {
      sourceUrl: `${sourceResponse.host}${OFFICIAL_WINGO_HISTORY_PATH}`,
      upstreamItems: chronological.map(({ item }) => item),
      serviceTime: sourceResponse.payload.serviceTime ?? null,
    });
    spooled = result.created ? newRecords.length : 0;
    historySpoolStatus = await historySpool.status();
    log(`[HISTORY] batch=${result.key} status=spooled records=${records.length} new_records=${newRecords.length} pending_spool=${historySpoolStatus.pendingCount}`);
  }
  log(`[HISTORY] fetched host=${sourceResponse.host} response_ms=${sourceResponse.responseTimeMs} records=${valid.length} spooled=${spooled}`);
  return { validCount: valid.length, spooled };
}

function t7StatusBody() {
  const diagnostics = t7Diagnostics.status();
  return {
    success: true,
    pollingRunning: t7PollingRunning,
    lastPollStartedAt: lastT7PollStartedAt,
    lastPollCompletedAt: lastT7PollCompletedAt,
    lastPollStatus: lastT7PollStatus,
    currentProviderPeriod: t7CurrentProviderPeriod,
    providerWindowOldestPeriod: t7WindowOldestPeriod,
    providerWindowNewestPeriod: t7WindowNewestPeriod,
    historyCount: t7HistoryCount,
    historicalBackfillSupported: false,
    pendingCount: diagnostics.pending.length,
    pending: diagnostics.pending.map((entry) => ({
      period: entry.period,
      signal: entry.signal,
      predictionCreatedAt: entry.predictionCreatedAt,
      lastSeenAt: entry.lastSeenAt,
      state: entry.state,
    })),
    gaps: diagnostics.gaps,
    expiredPending: diagnostics.expiredPending,
    lastError: lastT7PollError,
  };
}

const t7Ledger = new T7IngestionLedger({
  cache: inMemoryT7Signals,
  loadExisting: async (period) => {
    const { data, error } = await currentT7Client.from('wingo_t7_signals').select('*').eq('period_id', period).limit(1);
    if (error) {
      isDbConnected = false;
      throw new Error(`Read T7 before upsert: ${error.message}`);
    }
    return data?.[0] ?? null;
  },
  persist: async (row) => {
    const storedOk = await storeT7Signal(currentT7Client, row);
    if (!storedOk) throw new Error(`T7 persistence awaits retry at ${row.period_id}`);
  },
  observe: (entry, observedAt) => observeT7Entry(currentT7Client, entry, observedAt),
  onStored: async ({ entry, origin, operation, previousStatus }) => {
    knownT7Periods.add(entry.period_id);
    notifyAdaptive(entry.period_id);
    if (operation === 'inserted') {
      log(`[T7 SUPABASE]\nissue=${entry.period_id}\nNEW -> inserted (${origin}, status=${entry.status ?? 'n/a'})`);
    } else {
      log(`[T7 SUPABASE]\nissue=${entry.period_id}\nUPDATED ${previousStatus ?? 'pending'} -> ${entry.status}` +
        `\nactual_number=${entry.actual_number ?? 'n/a'} actual_color=${entry.actual_color ?? 'n/a'}` +
        `\nsizeHit=${entry.size_hit} colorHit=${entry.color_hit}`);
    }
  },
  log,
  logError: (message) => logError(message),
});

const t7PersistenceQueue = new RetryableSerialQueue({
  onError: (error) => logError(`[T7] persistence queue blocked; retrying exact batch: ${error.message}`),
});

let currentT7Client = null;

async function handleT7Entry(supabaseClient, entry, responseTime, origin) {
  currentT7Client = supabaseClient;
  await t7Ledger.ingest(entry, responseTime, origin);
  const stored = inMemoryT7Signals.get(entry.period_id);
  if (origin === 'prediction' && stored) {
    latestT7Timing = {
      fetched_at: stored.fetched_at,
      period_id: entry.period_id,
      wingoai_response_ms: responseTime,
      api_response_ms: responseTime,
      signal: stored.signal,
      stored_at: stored.stored_at,
      collector_latency_ms: stored.collector_latency_ms ?? 0,
    };
  }
}

/**
 * Test 7 worker: fetch https://bdgtharu.com/api.php?_=<cache-buster>, store the
 * prediction, backfill history[], and settle pending rows. Tolerates timeout,
 * HTTP errors, malformed JSON, an empty prediction and network failure without
 * ever throwing out of the polling loop.
 */
async function fetchAndProcessT7Prediction(supabaseClient) {
  if (isT7Polling) return;
  isT7Polling = true;
  const pollStartedAt = getTimestamp();
  lastT7PollStartedAt = pollStartedAt;
  lastT7PollStatus = 'requesting';
  let responseTimeMs = null;
  let predictionPeriod = null;
  let historyCount = 0;
  let oldestHistoryPeriod = null;
  let newestHistoryPeriod = null;
  let responseOk = false;
  let errorMessage = null;

  try {
    const startTime = Date.now();
    // The trailing parameter is cache-busting ONLY.
    const requestUrl = `${T7_API_BASE_URL}?_=${Date.now()}`;
    log(`[T7] API request -> ${T7_API_BASE_URL}?_=<cache-buster>`);

    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, T7_REQUEST_TIMEOUT_MS);

    const headers = { Accept: 'application/json' };

    let response;
    try {
      response = await fetch(requestUrl, { method: 'GET', headers, signal: controller.signal });
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      const elapsedMs = Date.now() - startTime;
      const errName = fetchErr instanceof Error ? fetchErr.name : 'UnknownError';
      const errMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      const cause = fetchErr instanceof Error ? fetchErr.cause : undefined;
      const causeMsg =
        cause instanceof Error ? `${cause.name}: ${cause.message}` : cause ? String(cause) : 'none';

      const failureKind = timedOut
        ? 'timeout/abort'
        : errName === 'AbortError'
        ? 'aborted'
        : 'network/unreachable';

      errorMessage = `${failureKind}: ${errMsg}`;
      lastT7PollError = errorMessage;

      logError(
        `[T7] API request FAILED kind=${failureKind}\n` +
          `url=${T7_API_BASE_URL}?_=<cache-buster>\n` +
          `elapsed_ms=${elapsedMs}\ntimeout_ms=${T7_REQUEST_TIMEOUT_MS}\n` +
          `http_status=none (no response headers received)\n` +
          `error=${errName}: ${errMsg}\ncause=${causeMsg}`
      );
      return;
    }
    clearTimeout(timeoutId);

    const responseTime = Date.now() - startTime;
    responseTimeMs = responseTime;
    log(`[T7] HTTP ${response.status} ${response.statusText || ''}`.trimEnd() + ` in ${responseTime} ms`);

    if (!response.ok) {
      lastT7PollStatus = `http_${response.status}`;
      errorMessage = `HTTP ${response.status} ${response.statusText || ''}`.trim();
      lastT7PollError = errorMessage;
      const bodySnippet = await response
        .text()
        .then((t) => t.replace(/\s+/g, ' ').slice(0, 300))
        .catch(() => '<body unreadable>');
      logError(
        `[T7] API returned HTTP ${response.status}\n` +
          `status_text=${response.statusText || 'none'}\nresponse_ms=${responseTime}\nbody=${bodySnippet}`
      );
      return;
    }

    let data;
    try {
      data = await response.json();
    } catch (jsonErr) {
      errorMessage = `Malformed JSON: ${jsonErr instanceof Error ? jsonErr.message : String(jsonErr)}`;
      lastT7PollError = errorMessage;
      logError(
        `[T7] Malformed JSON in response (${jsonErr instanceof Error ? jsonErr.message : String(jsonErr)})`
      );
      return;
    }
    if (!running) return;

    const rawHistory = data?.history;
    const malformedHistory = rawHistory !== undefined && !Array.isArray(rawHistory);
    const prediction = normalizeT7Entry(data?.prediction);
    const responseHistory = Array.isArray(rawHistory) ? rawHistory.map(normalizeT7Entry).filter(Boolean) : [];
    const responseEntries = [prediction, ...responseHistory].filter(Boolean);
    responseOk = !malformedHistory
      && !(data?.prediction !== undefined && !prediction)
      && responseEntries.length > 0;
    predictionPeriod = prediction?.period_id ?? null;
    historyCount = Array.isArray(rawHistory) ? rawHistory.length : 0;
    ({ oldest: oldestHistoryPeriod, newest: newestHistoryPeriod } = t7WindowPeriods(responseHistory.length ? responseHistory : responseEntries));
    t7CurrentProviderPeriod = predictionPeriod;
    t7WindowOldestPeriod = oldestHistoryPeriod;
    t7WindowNewestPeriod = newestHistoryPeriod;
    t7HistoryCount = historyCount;
    const pendingPeriod = adaptiveCurrent.status === 'waiting_for_t7' ? adaptiveCurrent.pendingPeriod : null;
    const observedAt = getTimestamp();
    await observeT7History(supabaseClient, responseHistory, observedAt);
    await expireT7Pending(supabaseClient, oldestHistoryPeriod, newestHistoryPeriod, observedAt);
    if (pendingPeriod) {
      const pendingInResponse = responseEntries.some((entry) => entry.period_id === pendingPeriod);
      lastPendingT7Observation = {
        period: pendingPeriod,
        available: pendingInResponse,
        checkedAt: getTimestamp(),
      };
      if (!pendingInResponse) {
        log(`[T7] pending_period=${pendingPeriod} status=not_in_upstream_response; waiting for source backfill`);
      }
    }

    if (prediction) {
      log('[T7] Prediction received');
      log(`[T7] Issue: ${prediction.period_id}`);
      log(`[T7] Size: ${prediction.signal}`);
      log(`[T7] Color: ${prediction.color ?? 'n/a'}`);
      log(`[T7] Confidence: ${prediction.confidence ?? 'n/a'}`);
      log(`[T7] Status: ${prediction.status ?? 'n/a'}`);
    } else {
      log('[T7] No usable prediction entry; processing history entries independently');
    }

    if (malformedHistory) {
      errorMessage = 'Malformed history: expected an array.';
      lastT7PollError = errorMessage;
      lastT7PollStatus = 'malformed_history';
    } else if (data?.prediction !== undefined && !prediction) {
      errorMessage = 'Malformed prediction entry.';
      lastT7PollError = errorMessage;
      lastT7PollStatus = 'malformed_prediction';
    } else if (!prediction && responseHistory.length === 0) {
      errorMessage = 'Response contained no usable prediction or history entries.';
      lastT7PollError = errorMessage;
      lastT7PollStatus = 'empty_response';
    }

    // T7 persistence is serialized independently. Adaptive is notified only
    // after this exact response batch is durably persisted.
    if (responseEntries.length) {
      await t7PersistenceQueue.enqueue(async () => {
        for (const entry of responseEntries) {
          await handleT7Entry(supabaseClient, entry, responseTime, entry === prediction ? 'prediction' : 'history');
        }
      });
    }
    if (pendingPeriod && responseEntries.some((entry) => entry.period_id === pendingPeriod)) {
      const persisted = inMemoryT7Signals.get(pendingPeriod);
      log(`[T7] pending_period=${pendingPeriod} status=persisted signal=${persisted?.signal ?? 'none'} status=${persisted?.status ?? 'none'} actual_number=${persisted?.actual_number ?? 'none'}`);
    }
    if (!errorMessage) {
      lastT7PollStatus = 'healthy';
      lastT7PollError = null;
    }
    if (t7PersistenceQueue.status().pendingCount === 0) notifyAdaptive();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errorMessage = msg;
    lastT7PollError = msg;
    lastT7PollStatus = 'error';
    logError(`[T7] Cycle error: ${msg}`);
  } finally {
    lastT7PollCompletedAt = getTimestamp();
    try {
      await recordT7PollAudit(supabaseClient, {
        poll_started_at: pollStartedAt,
        poll_completed_at: lastT7PollCompletedAt,
        response_time_ms: responseTimeMs,
        prediction_period: predictionPeriod,
        history_count: historyCount,
        oldest_history_period: oldestHistoryPeriod,
        newest_history_period: newestHistoryPeriod,
        response_ok: responseOk,
        error_message: errorMessage,
      });
    } catch (auditError) {
      logError(`[T7] Poll audit cycle failed: ${auditError.message}`);
    }
    isT7Polling = false;
  }
}

async function loadExistingT7Signals(supabaseClient) {
  const baseSelect = 'period_id, signal, confidence, fetched_at, stored_at';
  const fullSelect = `${baseSelect}, ${T7_EXTRA_COLUMNS.join(', ')}`;

  let data = null;
  let error = null;
  let fullColumnsAvailable = true;

  try {
    ({ data, error } = await supabaseClient
      .from('wingo_t7_signals')
      .select(fullSelect)
      .order('period_id', { ascending: false })
      .limit(500));
  } catch (err) {
    error = err;
  }

  // Graceful degradation: if the bdgtharu columns have not been added yet, fall
  // back to the legacy column set so the collector still boots and serves.
  if (error) {
    fullColumnsAvailable = false;
    if (!t7SchemaWarned) {
      t7SchemaWarned = true;
      logError(
        `[T7] Full column select failed (${error.message}). Falling back to legacy columns. ` +
          'Apply supabase/migrations/20261002_wingo_t7_signals_bdgtharu.sql to persist the new fields.'
      );
    }
    ({ data, error } = await supabaseClient
      .from('wingo_t7_signals')
      .select(baseSelect)
      .order('period_id', { ascending: false })
      .limit(500));
  }

  if (error) {
    logError(`Failed to preload existing T7 signals: ${error.message}`);
    return;
  }

  const remember = (row) => {
    if (!row?.period_id) return;
    const pid = String(row.period_id).trim();
    knownT7Periods.add(pid);
    const normalized = {
      period_id: pid,
      signal: row.signal,
      confidence: row.confidence !== null ? Number(row.confidence) : null,
      fetched_at: row.fetched_at,
      stored_at: row.stored_at,
      color: row.color ?? null,
      status: row.status ?? null,
      source: row.source ?? null,
      algorithm_version: row.algorithm_version ?? null,
      guard_applied: row.guard_applied ?? null,
      actual_number: row.actual_number ?? null,
      actual_color: row.actual_color ?? null,
      size_hit: row.size_hit ?? null,
      color_hit: row.color_hit ?? null,
      settled_at: row.settled_at ?? null,
      prediction_created_at: row.prediction_created_at ?? null,
    };
    inMemoryT7Signals.set(pid, normalized);
    t7Diagnostics.seedPending(normalized);
  };

  if (Array.isArray(data)) data.forEach(remember);

  // The normal cache remains bounded, but every unresolved pending row is
  // loaded independently so an old pending period cannot disappear from
  // operational diagnostics merely because it left the recent cache window.
  if (!error && fullColumnsAvailable) {
    for (let from = 0; ; from += 1000) {
      const { data: pendingRows, error: pendingError } = await supabaseClient
        .from('wingo_t7_signals')
        .select(fullSelect)
        .eq('status', 'pending')
        .order('period_id', { ascending: true })
        .range(from, from + 999);
      if (pendingError) {
        logError(`Failed to preload pending T7 diagnostics: ${pendingError.message}`);
        break;
      }
      if (!pendingRows?.length) break;
      pendingRows.forEach(remember);
      if (pendingRows.length < 1000) break;
    }
  }

  log(`Preloaded ${data?.length ?? 0} recent plus unresolved pending Test 7 signals from public.wingo_t7_signals.`);
}

async function startT7Polling(supabaseClient) {
  log(`[T7] Starting prediction worker against ${T7_API_BASE_URL} (interval: ${T7_POLL_INTERVAL_MS / 1000}s)...`);
  t7PollingRunning = true;
  try {
    while (running) {
      try {
        await fetchAndProcessT7Prediction(supabaseClient);
      } catch (err) {
        lastT7PollStatus = 'error';
        lastT7PollError = err instanceof Error ? err.message : String(err);
        logError(`[T7] Polling worker unhandled error: ${lastT7PollError}`);
      }
      if (running) {
        await sleep(T7_POLL_INTERVAL_MS);
      }
    }
  } finally {
    t7PollingRunning = false;
  }
  log('[T7] Polling worker stopped.');
}

// ─── COLLECTOR & HEALTH SERVER STATE ──────────────────────────────────────────
let knownPeriods = new Set();
let isDbConnected = false;
let isPollingActive = false;
let lastCycleStatus = 'initializing';
let lastFetchTime = null;
let lastInsertedPeriod = null;
let historyNewestPersistedPeriod = null;
let historySpool;
let historySpoolStatus = { pendingCount: 0, oldestPendingAgeMs: null, retryCount: 0 };
let historyContinuityGaps = [];
let historySpoolLastError = null;
let historySourceHost = null;
let running = true;
let isFetching = false;
let timeType = 'iso';
let collectorPromise = null;

// T7 reset detection belongs to the T7 pipeline; history polling never reads
// the T7 table. Kept as a named false hook only to preserve the old branch's
// diagnostics during deployment diff review.
function historyOwnsT7ResetCheck() { return false; }

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`Received ${signal}. Draining the coordinated pipeline...`);
  running = false;
  clearInterval(adaptiveRetryTimer);
  await adaptiveCoordinator?.flight;
  await adaptiveCoordinator?.tail;
  await adaptiveWorker?.terminate();
  await verifiedMaxLossWorker?.terminate();
  await collectorPromise?.catch(() => {});
  healthServer.close(() => process.exit(0));
  healthServer.closeIdleConnections?.();
}
process.on('SIGINT', () => { shutdown('SIGINT').catch((error) => { logError(error.message); process.exitCode = 1; }); });
process.on('SIGTERM', () => { shutdown('SIGTERM').catch((error) => { logError(error.message); process.exitCode = 1; }); });

// ─── STEP 1: START HTTP HEALTH SERVER IMMEDIATELY (Render Requirement) ────────
// Render requires the HTTP port to open immediately on 0.0.0.0:PORT and return 200 OK.
// It must NEVER wait for Supabase or external APIs before listening.
const healthServer = http.createServer((req, res) => {
  const urlPath = (req.url || '').split('?')[0];

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // POST /reset or /api/reset or /api/real/reset or /real/reset — resets in-memory knownPeriods and T7 signals
  if (req.method === 'POST' && (urlPath === '/reset' || urlPath === '/api/reset' || urlPath === '/api/real/reset' || urlPath === '/real/reset')) {
    const previousCount = knownPeriods.size;
    const previousT7Count = knownT7Periods.size;
    knownPeriods.clear();
    knownT7Periods.clear();
    inMemoryT7Signals.clear();
    latestT7Timing = null;
    log(`[Collector Reset] In-memory known periods cleared (${previousCount} -> 0) and T7 signals cleared (${previousT7Count} -> 0). Collector continuing 24/7 polling.`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify({
        success: true,
        message: 'All data reset successfully',
        previousCount,
        previousT7Count,
        currentCount: 0,
        active: isPollingActive,
        timestamp: getTimestamp(),
      })
    );
  }

  if (req.method === 'GET' && urlPath === '/api/t7/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(t7StatusBody()));
  }

  // GET /api/real/t7-signals or /t7-signals — fast in-memory served with latency telemetry
  if (urlPath === '/api/real/t7-signals' || urlPath === '/t7-signals') {
    const requestStarted = new Date().toISOString();
    const tReqStart = Date.now();

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');

    const list = Array.from(inMemoryT7Signals.values()).sort((a, b) => b.period_id.localeCompare(a.period_id));
    const latest = list[0] || null;

    const responseGenerated = new Date().toISOString();
    const apiLatencyMs = Date.now() - tReqStart;

    // Diagnostic logging matching requirement
    log(`[T7 API]\nrequest_started=${requestStarted}\nlatest_period=${latest?.period_id || 'none'}\nlatest_fetched_at=${latest?.fetched_at || 'none'}\nlatest_stored_at=${latest?.stored_at || 'none'}\nresponse_generated=${responseGenerated}\napi_latency_ms=${apiLatencyMs}`);

    const collectorLatency = latest?.collector_latency_ms ?? (latest?.stored_at && latest?.fetched_at ? Math.max(0, Date.parse(latest.stored_at) - Date.parse(latest.fetched_at)) : 0);

    const timingData = {
      latest_period: latest?.period_id || null,
      latest_fetched_at: latest?.fetched_at || null,
      latest_stored_at: latest?.stored_at || null,
      collector_latency_ms: collectorLatency,
      api_response_ms: latestT7Timing?.api_response_ms ?? latest?.wingoai_response_ms ?? collectorLatency,
      api_latency_ms: apiLatencyMs,
      request_started: requestStarted,
      response_generated: responseGenerated,
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify({
        success: true,
        count: list.length,
        signals: list,
        timing: timingData,
      })
    );
  }

  // Lightweight snapshot; waiting is input readiness, not an HTTP outage.
  if (req.method === 'GET' && urlPath === '/api/adaptive-learning/current') {
    verifiedMaxLossWorker?.refresh();
    const waiting = ['waiting_for_t7', 'waiting_for_history'].includes(adaptiveCurrent.status);
    res.writeHead(adaptiveCurrent.success || waiting ? 200 : 503, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    return res.end(JSON.stringify({ ...adaptiveCurrent, maxLoss: verifiedMaxLossWorker?.current() ?? null }));
  }

  // GET /health, /api/health, /, /ping — fast, non-blocking 200 OK
  if (urlPath === '/health' || urlPath === '/api/health' || urlPath === '/' || urlPath === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify({
        status: 'ok',
        health: 'healthy',
        service: 'wingo-collector',
        uptime: Math.round(process.uptime()),
        port: PORT,
        host: HOST,
        dbConnected: isDbConnected && adaptiveCurrent.databaseConnected !== false,
        pollingActive: isPollingActive,
        totalKnownPeriods: knownPeriods.size,
        wingoAiLastPeriod: latestT7Timing?.period_id || null,
        wingoAiLatencyMs: latestT7Timing?.api_response_ms || null,
        lastCycleStatus,
        lastFetchTime,
        lastInsertedPeriod,
        serverRunning: running,
        collectorStatus: lastCycleStatus,
        t7PollingActive: isT7Polling,
        t7PollingRunning,
        t7LastPollStartedAt: lastT7PollStartedAt,
        t7LastPollCompletedAt: lastT7PollCompletedAt,
        t7LastPollStatus: lastT7PollStatus,
        pendingT7Observation: lastPendingT7Observation,
        t7PollIntervalMs: T7_POLL_INTERVAL_MS,
        t7CurrentProviderPeriod: t7CurrentProviderPeriod,
        t7ProviderWindowOldestPeriod: t7WindowOldestPeriod,
        t7ProviderWindowNewestPeriod: t7WindowNewestPeriod,
        t7HistoryCount: t7HistoryCount,
        t7PendingCount: t7Diagnostics.status().pending.length,
        t7GapCount: t7Diagnostics.status().gaps.length,
        t7ExpiredPendingCount: t7Diagnostics.status().expiredPending.length,
        t7HistoricalBackfillSupported: false,
        t7LastError: lastT7PollError,
        historyPollIntervalMs: POLL_INTERVAL_MS,
        historySourceHost,
        historyNewestPersistedPeriod,
        historySpoolPendingCount: historySpoolStatus.pendingCount,
        historySpoolOldestPendingAgeMs: historySpoolStatus.oldestPendingAgeMs,
        historySpoolRetryCount: historySpoolStatus.retryCount,
        historySpoolLastError,
        historyContinuityGapCount: historyContinuityGaps.length,
        historyContinuityGaps: historyContinuityGaps.slice(-10),
        historyHistoricalBackfillSupported: false,
        adaptiveStatus: adaptiveCurrent.status,
        adaptiveState: adaptiveCurrent.adaptiveState ?? 'normal',
        recoveryId: adaptiveCurrent.recoveryId ?? null,
        recoveryHighWater: adaptiveCurrent.recoveryHighWater ?? null,
        observedHighWater: adaptiveCurrent.observedHighWater ?? null,
        earliestAffectedPeriod: adaptiveCurrent.earliestAffectedPeriod ?? null,
        replayCursor: adaptiveCurrent.replayCursor ?? null,
        replayProcessed: adaptiveCurrent.replayProcessed ?? 0,
        replayTotal: adaptiveCurrent.replayTotal ?? 0,
        replayHighWater: adaptiveCurrent.replayHighWater ?? null,
        recoveryPhase: adaptiveCurrent.recoveryPhase ?? adaptiveCurrent.adaptiveState ?? 'normal',
        lastCollectedPeriod: lastInsertedPeriod,
        lastEvaluatedPeriod: adaptiveCurrent.latestEvaluatedPeriod ?? null,
        checkpointStatus: adaptiveCurrent.checkpointStatus ?? 'loading',
        checkpointAt: adaptiveCurrent.checkpointAt ?? null,
        waiting_for_t7: adaptiveCurrent.status === 'waiting_for_t7',
        pendingPeriod: adaptiveCurrent.pendingPeriod ?? null,
        baselineId: adaptiveCurrent.baselineId ?? null,
        baselineStartPeriod: adaptiveCurrent.baselineStartPeriod ?? null,
        baselineReason: adaptiveCurrent.baselineReason ?? null,
        baselinePendingAfter: adaptiveCurrent.baselinePendingAfter ?? null,
        baselinePeriodsIncluded: adaptiveCurrent.baselinePeriodsIncluded ?? 0,
        adaptiveCursor: adaptiveCurrent.adaptiveCursor ?? adaptiveCurrent.latestEvaluatedPeriod ?? null,
        pendingT7Count: adaptiveCurrent.pendingT7Count ?? 0,
        oldestPendingT7: adaptiveCurrent.oldestPendingT7 ?? adaptiveCurrent.pendingPeriod ?? null,
        t7Coverage: adaptiveCurrent.t7Coverage ?? 'unknown',
        adaptiveBlocked: adaptiveCurrent.adaptiveBlocked ?? adaptiveCurrent.status !== 'ready',
        timestamp: getTimestamp(),
      })
    );
  }

  // Default fallback 200 OK for any other probe path
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      status: 'ok',
      service: 'wingo-collector',
      timestamp: getTimestamp(),
    })
  );
});

healthServer.on('error', (err) => {
  logError(`HTTP health server error: ${err.message}`);
});

healthServer.listen(PORT, HOST, () => {
  log(`Health-check HTTP server listening immediately on ${HOST}:${PORT}`);
  log(`Render health endpoint active at http://${HOST}:${PORT}/health (HTTP 200)`);

  // Start background collector only AFTER the HTTP port is officially open & listening
  collectorPromise = startCollector();
  collectorPromise.catch((err) => {
    logError(`Fatal collector background error: ${err.message}`);
  });
});

// ─── STEP 2: LOAD EXISTING PERIODS STRICTLY FROM CURRENT SUPABASE TABLE ───────
async function loadExistingPeriods(supabaseClient) {
  knownPeriods.clear();
  let from = 0;
  const BATCH_SIZE = 1000;
  let totalRows = 0;
  let newestPeriod = null;

  while (true) {
    let result;
    try {
      const query = supabaseClient
        .from('real_wingo_30s_history')
        .select('issue_number', { count: from === 0 ? 'exact' : undefined })
        .eq('game_code', 'WinGo_30S')
        .order('issue_number', { ascending: false })
        .range(from, from + BATCH_SIZE - 1);
      const deadline = createDeadline(HISTORY_SUPABASE_TIMEOUT_MS, 'Load existing history');
      try { result = await query.abortSignal(deadline.signal); }
      finally { deadline.clear(); }
    } catch (error) {
      isDbConnected = false;
      logError(`Failed to load existing periods from Supabase: ${error.message}`);
      break;
    }
    const { data, count, error } = result;
    if (error) {
      isDbConnected = false;
      logError(`Failed to load existing periods from Supabase: ${error.message}`);
      break;
    }
    isDbConnected = true;

    if (from === 0 && typeof count === 'number') {
      totalRows = count;
    }

    if (!data || data.length === 0) break;

    for (const row of data) {
      if (row.issue_number) {
        const issue = String(row.issue_number).trim();
        knownPeriods.add(issue);
        if (!newestPeriod) {
          newestPeriod = issue;
          historyNewestPersistedPeriod = issue;
        }
      }
    }

    if (data.length < BATCH_SIZE) break;
    from += data.length;
  }

  return { totalRows: typeof totalRows === 'number' ? totalRows : knownPeriods.size, newestPeriod };
}

// ─── STEP 3: INITIALIZE SUPABASE & RUN 24/7 POLLING LOOP ──────────────────────
async function startCollector() {
  log('=== WinGo 30S Standalone Backend Collector Starting ===');

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    logError('CRITICAL: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable is missing.');
    logError('Please provide these in collector/.env or your deployment environment settings.');
    while (running && (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)) {
      await sleep(5000);
    }
    if (!running) return;
  }

  const supabaseClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );

  isDbConnected = false;
  log(`Connecting to Supabase at: ${process.env.SUPABASE_URL.replace(/https?:\/\//, '').split('.')[0]}...`);
  historySpool = await new HistorySpool(HISTORY_SPOOL_DIR).initialize();
  const initialSpoolStatus = await historySpool.status();
  historySpoolStatus = initialSpoolStatus;
  log(`[HISTORY] durable spool initialized pending=${initialSpoolStatus.pendingCount} oldest_pending_age_ms=${initialSpoolStatus.oldestPendingAgeMs ?? 'none'}`);

  try {
    verifiedMaxLossWorker = startVerifiedMaxLossWorker({
      url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, logError,
    });
    verifiedMaxLossWorker.refresh();
  } catch (error) {
    logError(`[MAX LOSS] Independent metric startup failed: ${error.message}`);
  }

  try {
    const launchWorker = () => startAdaptiveWorker({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, log, logError });
    const workerRequest = async (method, inputs) => {
      try {
        adaptiveWorker ??= launchWorker();
        return await adaptiveWorker[method](inputs);
      }
      catch (error) {
        await adaptiveWorker?.terminate();
        adaptiveWorker = null;
        throw error;
      }
    };
    adaptiveCoordinator = new AdaptiveCoordinator({
      advance: (inputs) => workerRequest('advance', inputs),
      runRecovery: () => workerRequest('runRecovery'),
      commitRecovery: () => workerRequest('commitRecovery'),
    }, { onState: (body) => { adaptiveCurrent = body; } });
  } catch (error) {
    adaptiveCurrent = { success: false, status: 'error', error: 'Adaptive worker could not start.' };
    logError(`[Adaptive] worker startup failed: ${error.message}`);
  }

  // Query current Supabase periods strictly from the CURRENT database
  const { totalRows, newestPeriod } = await loadExistingPeriods(supabaseClient);
  lastInsertedPeriod = newestPeriod;
  log(`Initialized. Preserved ${totalRows} existing records in Supabase. Newest period: ${newestPeriod || 'None'}`);

  // Preload existing Test 7 signals from public.wingo_t7_signals into collector memory
  await loadExistingT7Signals(supabaseClient);
  await loadT7Diagnostics(supabaseClient);
  // Retry readiness/checkpoint/network recovery at the existing 5s cadence.
  // The worker has no timer; server.js owns every evaluation request.
  adaptiveRetryTimer = setInterval(() => {
    t7PersistenceQueue.retry();
    notifyAdaptive();
  }, T7_POLL_INTERVAL_MS);
  notifyAdaptive();

  // Dedicated background 5-second Test 7 prediction worker (bdgtharu.com)
  startT7Polling(supabaseClient).catch((wErr) => {
    const wMsg = wErr instanceof Error ? wErr.message : String(wErr);
    logError(`[T7] Background poller error: ${wMsg}`);
  });

  log(`Starting 24/7 continuous polling loop (interval: ${POLL_INTERVAL_MS / 1000}s)...`);
  isPollingActive = true;
  lastCycleStatus = 'active';
  let startupRecoveryComplete = false;

  while (running) {
    if (isFetching) {
      await sleep(1000);
      continue;
    }

    isFetching = true;
    let nextDelay = POLL_INTERVAL_MS;

    try {
      if (!startupRecoveryComplete) {
        const recovered = await drainHistorySpool(supabaseClient, 'startup');
        if (recovered.pendingCount > 0) {
          lastCycleStatus = 'spool_recovery_pending';
          nextDelay = RETRY_DELAY_MS;
          await sleep(nextDelay);
          continue;
        }
        startupRecoveryComplete = true;
        log('[HISTORY] startup spool recovery complete; normal polling may begin');
      } else {
        await drainHistorySpool(supabaseClient, 'pre_fetch');
      }

      // If knownPeriods has entries, verify Supabase was not reset to 0
      if (knownPeriods.size > 0) {
        try {
          const checkResult = await supabaseResultWithDeadline(supabaseClient
            .from('real_wingo_30s_history')
            .select('issue_number', { count: 'exact', head: true }), 'Check history persistence');
          if (checkResult.count === 0) {
            log(`[Database Reset Detected] Supabase history table is empty. Cleared ${knownPeriods.size} cached periods from memory.`);
            knownPeriods.clear();
          }
        } catch {
          // Non-fatal check
        }
      }

      // If knownT7Periods has entries, verify Supabase wingo_t7_signals was not reset to 0
      if (historyOwnsT7ResetCheck() && knownT7Periods.size > 0) {
        try {
          const { count: currentT7Count, error: t7CheckErr } = await supabaseClient
            .from(T7_SIGNAL_TABLE)
            .select('period_id', { count: 'exact', head: true });
          if (!t7CheckErr && currentT7Count === 0) {
            log(`[Database Reset Detected] Supabase wingo_t7_signals table is empty. Cleared ${knownT7Periods.size} cached T7 periods.`);
            knownT7Periods.clear();
            inMemoryT7Signals.clear();
            latestT7Timing = null;
          }
        } catch {
          // Non-fatal check
        }
      }

      log('[HISTORY] fetch started');
      lastFetchTime = getTimestamp();
      const sourceResponse = await fetchOfficialHistoryWindow();

      const result = await spoolHistoryResponse(sourceResponse);
      await drainHistorySpool(supabaseClient, 'post_fetch');
      const spoolStatus = await historySpool.status();
      isDbConnected = spoolStatus.pendingCount === 0;
      notifyAdaptive();
      log(`[HISTORY] cycle complete fetched=${result.validCount} spooled=${result.spooled} pending_spool=${spoolStatus.pendingCount}`);

      lastCycleStatus = spoolStatus.pendingCount === 0 ? 'healthy' : 'spool_pending_retry';
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logError(`API request failed: ${errMsg} → retrying`);
      lastCycleStatus = `error: ${errMsg}`;
      nextDelay = RETRY_DELAY_MS;
    } finally {
      isFetching = false;
    }

    if (running) {
      await sleep(nextDelay);
    }
  }

  log('WinGo 30S Collector stopped.');
}
