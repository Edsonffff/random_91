import http from 'http';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load local environment variables if present
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '30000', 10);
const RETRY_DELAY_MS = parseInt(process.env.RETRY_DELAY_MS || '10000', 10);
const PORT = parseInt(process.env.PORT || '10000', 10);
const HOST = '0.0.0.0';

// WingoAI signal API — token is ONLY stored here on the backend, never in frontend
const WINGOAI_API_TOKEN = process.env.WINGOAI_API_TOKEN || '';
const WINGOAI_SIGNAL_URL = 'https://server.wingoaibot.com/signals/current?room=30sec&type=standard';
const OFFICIAL_WINGO_HISTORY_URL = 'https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json';

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
 * Timing & Cache state for WingoAI signals
 */
const WINGOAI_POLL_INTERVAL_MS = 5000;
let isWingoAIPolling = false;
const knownWingoAIPeriods = new Set();
const inMemoryT7Signals = new Map();
let latestWingoAITiming = null;

let wingoSignalsTableMissing = false;

async function storeWingoAISignal(supabaseClient, signalRow) {
  if (wingoSignalsTableMissing) return;
  const { error } = await supabaseClient
    .from('wingo_t7_signals')
    .upsert([signalRow], { onConflict: 'period_id' });

  if (error) {
    if (error.code === 'PGRST205' || error.code === '42P01' || /schema cache|does not exist/i.test(error.message)) {
      wingoSignalsTableMissing = true;
      log('Optional table wingo_t7_signals does not exist in Supabase — skipping storing signals in database.');
      return;
    }
    logError(`Failed to store WingoAI signal for period ${signalRow.period_id}: ${error.message}`);
  }
}

/**
 * Dedicated WingoAI signal worker function.
 * Implements non-overlapping 5s fast polling, strict logging, and deduplication.
 */
async function fetchAndProcessWingoAISignal(supabaseClient) {
  if (isWingoAIPolling) return;
  isWingoAIPolling = true;

  try {
    const startTime = Date.now();
    log('[WINGOAI] Request started');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const headers = { 'Accept': 'application/json' };
    if (WINGOAI_API_TOKEN) {
      headers['Authorization'] = `Bearer ${WINGOAI_API_TOKEN}`;
    }

    const response = await fetch(WINGOAI_SIGNAL_URL, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const responseTime = Date.now() - startTime;
    log('[WINGOAI] Response received');
    log(`[WINGOAI] Response time: ${responseTime} ms`);

    if (!response.ok) {
      logError(`[WINGOAI] API returned HTTP ${response.status}`);
      return;
    }

    const data = await response.json();
    if (
      data?.signalReady !== true ||
      (data?.signal !== 'BIG' && data?.signal !== 'SMALL') ||
      !data?.periodId
    ) {
      return;
    }

    const periodId = String(data.periodId).trim();
    const signal = data.signal;
    const confidence = typeof data.confidence === 'number' ? data.confidence : null;
    const luckyNumber = typeof data.luckyNumber === 'number' ? data.luckyNumber : null;
    const fetchedAt = new Date().toISOString();

    log(`[WINGOAI] periodId: ${periodId}`);
    log(`[WINGOAI] signal: ${signal}`);
    log(`[T7] signal received at: ${fetchedAt} (period: ${periodId}, signal: ${signal})`);

    const signalRecord = {
      period_id: periodId,
      signal,
      confidence,
      lucky_number: luckyNumber,
      fetched_at: fetchedAt,
      stored_at: fetchedAt,
      api_response_ms: responseTime,
    };

    // Store in in-memory cache
    inMemoryT7Signals.set(periodId, signalRecord);
    log(`[T7] inMemoryT7Signals updated at: ${new Date().toISOString()}`);

    if (inMemoryT7Signals.size > 500) {
      const keys = Array.from(inMemoryT7Signals.keys());
      for (let i = 0; i < keys.length - 500; i++) {
        inMemoryT7Signals.delete(keys[i]);
      }
    }

    latestWingoAITiming = {
      fetched_at: fetchedAt,
      period_id: periodId,
      api_response_ms: responseTime,
      signal,
      stored_at: fetchedAt,
    };

    // Deduplicate Supabase writes: Only insert if not already written
    if (!knownWingoAIPeriods.has(periodId)) {
      const storeStart = Date.now();
      await storeWingoAISignal(supabaseClient, {
        period_id: periodId,
        signal,
        confidence,
        fetched_at: fetchedAt,
      });
      knownWingoAIPeriods.add(periodId);
      const storeElapsed = Date.now() - storeStart;
      const storedAt = new Date().toISOString();
      if (latestWingoAITiming) {
        latestWingoAITiming.stored_at = storedAt;
      }
      log(`[WINGOAI] Supabase storage completed (took ${storeElapsed} ms)`);
      log(`[T7] signal stored at: ${storedAt}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError(`[WINGOAI] Cycle error: ${msg}`);
  } finally {
    isWingoAIPolling = false;
  }
}

async function startWingoAIPolling(supabaseClient) {
  log(`[WINGOAI] Starting dedicated fast polling worker (interval: ${WINGOAI_POLL_INTERVAL_MS / 1000}s)...`);
  while (running) {
    try {
      await fetchAndProcessWingoAISignal(supabaseClient);
    } catch (err) {
      logError(`[WINGOAI] Polling worker unhandled error: ${err.message}`);
    }
    if (running) {
      await sleep(WINGOAI_POLL_INTERVAL_MS);
    }
  }
  log('[WINGOAI] Polling worker stopped.');
}

async function storeWingoAISignalBatch(supabaseClient, rows) {
  if (wingoSignalsTableMissing || rows.length === 0) return { stored: 0, errors: 0 };
  const { error } = await supabaseClient
    .from('wingo_t7_signals')
    .upsert(rows, { onConflict: 'period_id' });
  if (error) {
    if (error.code === 'PGRST205' || error.code === '42P01' || /schema cache|does not exist/i.test(error.message)) {
      wingoSignalsTableMissing = true;
      log('Optional table wingo_t7_signals does not exist in Supabase — skipping batch storing signals in database.');
      return { stored: 0, errors: 0 };
    }
    logError(`Batch upsert of ${rows.length} WingoAI signals failed: ${error.message}`);
    return { stored: 0, errors: rows.length };
  }
  return { stored: rows.length, errors: 0 };
}

/**
 * Backfill historical WingoAI signals from /history/30sec in background.
 * Runs non-blocking; never delays port binding or health checks.
 */
async function backfillWingoAIHistory(supabaseClient) {
  if (wingoSignalsTableMissing) return;
  log('Starting WingoAI historical backfill from /history/30sec...');

  const HISTORY_URL = 'https://server.wingoaibot.com/history/30sec';
  const PAGE_SIZE = 100;
  let page = 1;
  let totalFetched = 0;
  let totalStored = 0;
  let totalSkipped = 0;

  const headers = { 'Accept': 'application/json' };
  if (WINGOAI_API_TOKEN) {
    headers['Authorization'] = `Bearer ${WINGOAI_API_TOKEN}`;
  }

  while (true) {
    const url = `${HISTORY_URL}?page=${page}&limit=${PAGE_SIZE}`;
    let data;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const resp = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!resp.ok) {
        logError(`WingoAI history page ${page} returned HTTP ${resp.status} — stopping backfill`);
        break;
      }
      data = await resp.json();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(`WingoAI history page ${page} fetch failed: ${msg} — stopping backfill`);
      break;
    }

    const rows = Array.isArray(data?.rows) ? data.rows : [];
    if (rows.length === 0) break;

    totalFetched += rows.length;

    const batch = [];
    for (const row of rows) {
      if (!row.period || !row.prediction) {
        totalSkipped++;
        continue;
      }
      const signal = String(row.prediction).toUpperCase();
      if (signal !== 'BIG' && signal !== 'SMALL') {
        totalSkipped++;
        continue;
      }
      batch.push({
        period_id: String(row.period).trim(),
        signal,
        confidence: null,
        fetched_at: new Date().toISOString(),
      });
    }

    if (batch.length > 0) {
      const { stored, errors } = await storeWingoAISignalBatch(supabaseClient, batch);
      totalStored += stored;
      if (errors > 0 && wingoSignalsTableMissing) {
        break;
      }
    }

    log(`WingoAI backfill page ${page}: fetched=${rows.length}, stored=${batch.length}, skipped=${rows.length - batch.length}`);

    const totalRecords = typeof data?.totalRecords === 'number' ? data.totalRecords : 0;
    const totalPages = Math.ceil(totalRecords / PAGE_SIZE);
    if (page >= totalPages || rows.length < PAGE_SIZE) break;
    page++;

    await sleep(300);
  }

  log(`WingoAI historical backfill complete: fetched=${totalFetched}, stored=${totalStored}, skipped=${totalSkipped}`);
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
});

process.on('SIGTERM', () => {
  log('Received SIGTERM. Shutting down gracefully...');
  running = false;
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

  // POST /reset or /api/reset — resets in-memory knownPeriods tracker immediately
  if (req.method === 'POST' && (urlPath === '/reset' || urlPath === '/api/reset')) {
    const previousCount = knownPeriods.size;
    knownPeriods.clear();
    knownWingoAIPeriods.clear();
    inMemoryT7Signals.clear();
    log(`[Collector Reset] In-memory known periods cleared (${previousCount} -> 0). Collector continuing 24/7 polling.`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify({
        success: true,
        message: 'Collector in-memory known periods and WingoAI signals cleared successfully',
        previousCount,
        currentCount: 0,
        active: isPollingActive,
        timestamp: getTimestamp(),
      })
    );
  }

  // GET /api/real/t7-signals or /t7-signals — fast in-memory served with latency telemetry
  if (urlPath === '/api/real/t7-signals' || urlPath === '/t7-signals') {
    const reqReceivedAt = new Date().toISOString();
    log(`[T7] /api/real/t7-signals request received at: ${reqReceivedAt}`);

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');

    const list = Array.from(inMemoryT7Signals.values()).sort((a, b) => b.period_id.localeCompare(a.period_id));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    log(`[T7] /api/real/t7-signals response sent at: ${new Date().toISOString()}`);
    return res.end(
      JSON.stringify({
        success: true,
        count: list.length,
        signals: list,
        timing: latestWingoAITiming,
      })
    );
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
        wingoAiLastPeriod: latestWingoAITiming?.period_id || null,
        wingoAiLatencyMs: latestWingoAITiming?.api_response_ms || null,
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

  // Query current Supabase periods strictly from the CURRENT database
  const { totalRows, newestPeriod } = await loadExistingPeriods(supabaseClient);
  log(`Initialized. Preserved ${totalRows} existing records in Supabase. Newest period: ${newestPeriod || 'None'}`);

  // Background non-blocking historical WingoAI backfill (does not delay polling loop)
  backfillWingoAIHistory(supabaseClient).catch((backfillErr) => {
    const backfillMsg = backfillErr instanceof Error ? backfillErr.message : String(backfillErr);
    log(`Historical WingoAI backfill notice: ${backfillMsg}`);
  });

  // Dedicated background fast 5-second WingoAI polling worker
  startWingoAIPolling(supabaseClient).catch((wErr) => {
    const wMsg = wErr instanceof Error ? wErr.message : String(wErr);
    logError(`[WINGOAI] Background poller error: ${wMsg}`);
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

