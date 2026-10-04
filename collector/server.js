import http from 'http';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { startAdaptiveWorker } from './adaptive-learning-worker.js';

// Load local environment variables if present
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '30000', 10);
const RETRY_DELAY_MS = parseInt(process.env.RETRY_DELAY_MS || '10000', 10);
const PORT = parseInt(process.env.PORT || '10000', 10);
const HOST = '0.0.0.0';

// ─── Test 7 prediction source: https://bdgtharu.com/api.php ─────────────────
// This REPLACES the old WingoAI source (https://server.wingoaibot.com/signals/current).
// The request is made HERE, server-side. The React frontend never contacts this
// host — it only reads what this collector stores in Supabase.
// BDGTharu uses an unauthenticated GET request.
const T7_API_BASE_URL = 'https://bdgtharu.com/api.php';

// Timeout for a single T7 request. The polling cadence (5s) stays
// separate: a slow upstream simply makes a cycle overrun, it does not stack.
const T7_REQUEST_TIMEOUT_MS = 15000;
const OFFICIAL_WINGO_HISTORY_URL = 'https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json';

let adaptiveWorker;
let adaptiveCurrent = { success: false, status: 'initializing' };

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
const knownT7Periods = new Set();
const inMemoryT7Signals = new Map();
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

/**
 * Map one bdgtharu.com prediction/history entry onto a wingo_t7_signals row.
 * Returns null when the entry is unusable (missing issue or non BIG/SMALL size),
 * which is how an empty/garbled prediction is tolerated without crashing.
 *
 * The upstream `size`/`color`/`confidence`/`status` are recorded EXACTLY as
 * returned. No prediction is ever derived, recomputed or invented here.
 */
function normalizeT7Entry(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const periodId = String(raw.issue ?? '').trim();
  const size = String(raw.size ?? '').trim().toUpperCase();
  if (!periodId || (size !== 'BIG' && size !== 'SMALL')) return null;

  const num = (v) => {
    const n = typeof v === 'string' ? Number(v) : v;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  };
  const bool = (v) => (typeof v === 'boolean' ? v : null);
  // Upstream timestamps are epoch milliseconds.
  const iso = (v) => (num(v) !== null ? new Date(num(v)).toISOString() : null);
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

  return {
    period_id: periodId,
    signal: size,
    confidence: num(raw.confidence),
    color: str(raw.color) ? str(raw.color).toUpperCase() : null,
    status: str(raw.status) ? str(raw.status).toLowerCase() : null,
    source: str(raw.source),
    algorithm_version: num(raw.algorithmVersion),
    guard_applied: bool(raw.guardApplied),
    // The ACTUAL outcome — never conflated with the prediction above.
    actual_number: num(raw.actualNumber),
    actual_color: str(raw.actualColor),
    size_hit: bool(raw.sizeHit),
    color_hit: bool(raw.colorHit),
    settled_at: iso(raw.settledAt),
    prediction_created_at: iso(raw.createdAt),
  };
}

async function storeT7Signal(supabaseClient, signalRow) {
  // `upsert ... onConflict: 'period_id'` makes a duplicate row impossible even
  // if the in-memory dedup set is stale, because period_id is the primary key.
  const { error } = await supabaseClient
    .from('wingo_t7_signals')
    .upsert([signalRow], { onConflict: 'period_id' });

  if (error) {
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
  return true;
}

/**
 * Persist a single bdgtharu entry.
 *  · unknown issue        -> insert (new prediction, or backfill from history[])
 *  · known, still pending -> left alone (no duplicate write, original capture
 *                            timestamps preserved)
 *  · pending -> settled   -> updated with the upstream settlement
 */
async function handleT7Entry(supabaseClient, entry, responseTime, origin) {
  const existing = inMemoryT7Signals.get(entry.period_id);

  if (!existing) {
    const storedAt = new Date().toISOString();
    // For a fresh prediction prediction_created_at is ~now, so fetched_at stays
    // an accurate capture time. For backfilled history it is the true age.
    const fetchedAt = entry.prediction_created_at || storedAt;

    const signalRecord = {
      ...entry,
      fetched_at: fetchedAt,
      stored_at: storedAt,
    };

    const storedOk = await storeT7Signal(supabaseClient, signalRecord);
    if (!storedOk) return;

    knownT7Periods.add(entry.period_id);
    inMemoryT7Signals.set(entry.period_id, {
      ...signalRecord,
      wingoai_response_ms: responseTime,
      collector_latency_ms: Math.max(0, Date.parse(storedAt) - Date.parse(fetchedAt)),
    });

    if (origin === 'prediction') {
      latestT7Timing = {
        fetched_at: fetchedAt,
        period_id: entry.period_id,
        wingoai_response_ms: responseTime,
        api_response_ms: responseTime,
        signal: entry.signal,
        stored_at: storedAt,
        collector_latency_ms: Math.max(0, Date.parse(storedAt) - Date.parse(fetchedAt)),
      };
    }

    log(
      `[T7 SUPABASE]\nissue=${entry.period_id}\nNEW -> inserted (${origin}, status=${entry.status ?? 'n/a'})`
    );
    return;
  }

  const existingStatus = existing.status ?? null;
  const nextStatus = entry.status ?? null;
  const isSettledNow = nextStatus !== null && nextStatus !== 'pending';
  const wasPending = existingStatus === null || existingStatus === 'pending';

  // Settle a pending record, or refresh it if status changed. A settled record
  // is never overwritten by a pending one.
  const shouldUpdate = (wasPending && isSettledNow) || nextStatus !== existingStatus;
  if (!shouldUpdate) return;

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
    prediction_created_at: entry.prediction_created_at,
    // fetched_at must be sent on EVERY upsert: this column is NOT NULL with no
    // DEFAULT, and PostgREST evaluates the INSERT branch before conflict
    // handling, so omitting it fails even for a pure update. We write the
    // EXISTING value back, which preserves the original capture time exactly.
    fetched_at: existing.fetched_at || entry.prediction_created_at || storedAt,
    stored_at: storedAt,
  };

  const storedOk = await storeT7Signal(supabaseClient, settleRow);
  if (!storedOk) return;

  inMemoryT7Signals.set(entry.period_id, { ...existing, ...settleRow });

  log(
    `[T7 SUPABASE]\nissue=${entry.period_id}\nUPDATED ${existingStatus ?? 'pending'} -> ${nextStatus}` +
      `\nactual_number=${entry.actual_number ?? 'n/a'} actual_color=${entry.actual_color ?? 'n/a'}` +
      `\nsizeHit=${entry.size_hit} colorHit=${entry.color_hit}`
  );
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
    log(`[T7] HTTP ${response.status} ${response.statusText || ''}`.trimEnd() + ` in ${responseTime} ms`);

    if (!response.ok) {
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
      logError(
        `[T7] Malformed JSON in response (${jsonErr instanceof Error ? jsonErr.message : String(jsonErr)})`
      );
      return;
    }

    const prediction = normalizeT7Entry(data?.prediction);
    if (!prediction) {
      log('[T7] Empty or unusable prediction in response — skipped (nothing stored)');
      return;
    }

    log('[T7] Prediction received');
    log(`[T7] Issue: ${prediction.period_id}`);
    log(`[T7] Size: ${prediction.signal}`);
    log(`[T7] Color: ${prediction.color ?? 'n/a'}`);
    log(`[T7] Confidence: ${prediction.confidence ?? 'n/a'}`);
    log(`[T7] Status: ${prediction.status ?? 'n/a'}`);

    // 1. The live prediction. A new one is recognised purely by issue change.
    await handleT7Entry(supabaseClient, prediction, responseTime, 'prediction');

    // 2. history[] — backfills older issues and settles rows still pending.
    const history = Array.isArray(data?.history) ? data.history : [];
    for (const raw of history) {
      const entry = normalizeT7Entry(raw);
      if (!entry) continue;
      await handleT7Entry(supabaseClient, entry, responseTime, 'history');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError(`[T7] Cycle error: ${msg}`);
  } finally {
    isT7Polling = false;
  }
}

async function loadExistingT7Signals(supabaseClient) {
  const baseSelect = 'period_id, signal, confidence, fetched_at, stored_at';
  const fullSelect = `${baseSelect}, ${T7_EXTRA_COLUMNS.join(', ')}`;

  let data = null;
  let error = null;

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

  if (Array.isArray(data)) {
    for (const row of data) {
      if (!row.period_id) continue;
      const pid = String(row.period_id).trim();
      knownT7Periods.add(pid);
      inMemoryT7Signals.set(pid, {
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
      });
    }
    log(`Preloaded ${data.length} existing Test 7 signals from public.wingo_t7_signals into collector memory.`);
  }
}

async function startT7Polling(supabaseClient) {
  log(`[T7] Starting prediction worker against ${T7_API_BASE_URL} (interval: ${T7_POLL_INTERVAL_MS / 1000}s)...`);
  while (running) {
    try {
      await fetchAndProcessT7Prediction(supabaseClient);
    } catch (err) {
      logError(`[T7] Polling worker unhandled error: ${err.message}`);
    }
    if (running) {
      await sleep(T7_POLL_INTERVAL_MS);
    }
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
let running = true;
let isFetching = false;
let timeType = 'iso';

process.on('SIGINT', () => {
  log('Received SIGINT. Shutting down gracefully...');
  running = false;
  adaptiveWorker?.terminate();
});

process.on('SIGTERM', () => {
  log('Received SIGTERM. Shutting down gracefully...');
  running = false;
  adaptiveWorker?.terminate();
});

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

  // Lightweight snapshot; computation and Supabase access run in the worker.
  if (req.method === 'GET' && urlPath === '/api/adaptive-learning/current') {
    res.writeHead(adaptiveCurrent.success ? 200 : 503, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    return res.end(JSON.stringify(adaptiveCurrent));
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
        dbConnected: isDbConnected,
        pollingActive: isPollingActive,
        totalKnownPeriods: knownPeriods.size,
        wingoAiLastPeriod: latestT7Timing?.period_id || null,
        wingoAiLatencyMs: latestT7Timing?.api_response_ms || null,
        lastCycleStatus,
        lastFetchTime,
        lastInsertedPeriod,
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
  startCollector().catch((err) => {
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
    const { data, count, error } = await supabaseClient
      .from('real_wingo_30s_history')
      .select('issue_number', { count: from === 0 ? 'exact' : undefined })
      .eq('game_code', 'WinGo_30S')
      .order('issue_number', { ascending: false })
      .range(from, from + BATCH_SIZE - 1);

    if (error) {
      logError(`Failed to load existing periods from Supabase: ${error.message}`);
      break;
    }

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

  isDbConnected = true;
  log(`Connecting to Supabase at: ${process.env.SUPABASE_URL.replace(/https?:\/\//, '').split('.')[0]}...`);

  try {
    adaptiveWorker = startAdaptiveWorker({
      url: process.env.SUPABASE_URL,
      key: process.env.SUPABASE_SERVICE_ROLE_KEY,
      onState: (body) => { adaptiveCurrent = body; },
      log,
      logError,
    });
  } catch (error) {
    adaptiveCurrent = { success: false, status: 'error', error: 'Adaptive worker could not start.' };
    logError(`[Adaptive] worker startup failed: ${error.message}`);
  }

  // Query current Supabase periods strictly from the CURRENT database
  const { totalRows, newestPeriod } = await loadExistingPeriods(supabaseClient);
  log(`Initialized. Preserved ${totalRows} existing records in Supabase. Newest period: ${newestPeriod || 'None'}`);

  // Preload existing Test 7 signals from public.wingo_t7_signals into collector memory
  await loadExistingT7Signals(supabaseClient);

  // Dedicated background 5-second Test 7 prediction worker (bdgtharu.com)
  startT7Polling(supabaseClient).catch((wErr) => {
    const wMsg = wErr instanceof Error ? wErr.message : String(wErr);
    logError(`[T7] Background poller error: ${wMsg}`);
  });

  log(`Starting 24/7 continuous polling loop (interval: ${POLL_INTERVAL_MS / 1000}s)...`);
  isPollingActive = true;
  lastCycleStatus = 'active';

  while (running) {
    if (isFetching) {
      await sleep(1000);
      continue;
    }

    isFetching = true;
    let nextDelay = POLL_INTERVAL_MS;

    try {
      // If knownPeriods has entries, verify Supabase was not reset to 0
      if (knownPeriods.size > 0) {
        try {
          const { count: currentDbCount, error: checkErr } = await supabaseClient
            .from('real_wingo_30s_history')
            .select('issue_number', { count: 'exact', head: true });
          if (!checkErr && currentDbCount === 0) {
            log(`[Database Reset Detected] Supabase history table is empty. Cleared ${knownPeriods.size} cached periods from memory.`);
            knownPeriods.clear();
          }
        } catch {
          // Non-fatal check
        }
      }

      // If knownT7Periods has entries, verify Supabase wingo_t7_signals was not reset to 0
      if (knownT7Periods.size > 0) {
        try {
          const { count: currentT7Count, error: t7CheckErr } = await supabaseClient
            .from('wingo_t7_signals')
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

      log('Fetch started');
      lastFetchTime = getTimestamp();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(`${OFFICIAL_WINGO_HISTORY_URL}?ts=${Date.now()}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      log('API response received');

      const payload = await response.json();
      const list = payload?.data?.list;

      if (!Array.isArray(list) || list.length === 0) {
        throw new Error('API returned empty or invalid records list');
      }

      // Process chronologically (oldest to newest among fetched batch)
      const batchChronological = [...list].reverse();

      for (const item of batchChronological) {
        const issueNumber = String(item.issueNumber || '').trim();
        const rawNum = item.number;
        const num = typeof rawNum === 'number' ? rawNum : parseInt(String(rawNum ?? ''), 10);

        if (!issueNumber || isNaN(num) || num < 0 || num > 9) {
          continue;
        }

        log(`Period detected: ${issueNumber}`);

        if (knownPeriods.has(issueNumber)) {
          log(`Period ${issueNumber} already exists → skipped`);
          continue;
        }

        // New result! Insert into Supabase
        let recordPayload = formatRecordForSupabase(item, payload.serviceTime, timeType);

        let { error: insertError } = await supabaseClient
          .from('real_wingo_30s_history')
          .upsert([recordPayload], { onConflict: 'game_code,issue_number' });

        // Handle possible column source_time type format differences (millis vs ISO)
        if (
          insertError &&
          (insertError.code === '22007' || insertError.code === '22P02') &&
          timeType === 'iso'
        ) {
          timeType = 'millis';
          recordPayload = formatRecordForSupabase(item, payload.serviceTime, 'millis');
          const retryRes = await supabaseClient
            .from('real_wingo_30s_history')
            .upsert([recordPayload], { onConflict: 'game_code,issue_number' });
          insertError = retryRes.error;
        }

        if (insertError) {
          logError(`Database insertion failure for Period ${issueNumber}: ${insertError.message}`);
        } else {
          knownPeriods.add(issueNumber);
          lastInsertedPeriod = issueNumber;
          const size = num >= 5 ? 'Big' : 'Small';
          log(`New result → inserted (Period: ${issueNumber}, Number: ${num}, Size: ${size})`);
        }
      }

      lastCycleStatus = 'healthy';
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
