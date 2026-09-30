import http from 'http';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load local environment variables if present
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '30000', 10);
const RETRY_DELAY_MS = parseInt(process.env.RETRY_DELAY_MS || '10000', 10);
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : null;

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
 * Fetch the current WingoAI signal.
 * Returns null if the API is unavailable, the token is not set, or signalReady is false.
 * The token is NEVER logged, stored in Supabase, or sent to the frontend.
 */
async function fetchWingoAISignal() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
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

    if (!response.ok) {
      logError(`WingoAI API returned HTTP ${response.status} — skipping signal for this cycle`);
      return null;
    }

    const data = await response.json();

    // Only use signal when signalReady === true and signal is BIG or SMALL
    if (
      data?.signalReady !== true ||
      (data?.signal !== 'BIG' && data?.signal !== 'SMALL') ||
      !data?.periodId
    ) {
      log(`WingoAI signal not ready or invalid (signalReady=${data?.signalReady}, signal=${data?.signal}) — skipping`);
      return null;
    }

    return {
      period_id: String(data.periodId).trim(),
      signal: data.signal,          // 'BIG' or 'SMALL'
      confidence: typeof data.confidence === 'number' ? data.confidence : null,
      fetched_at: new Date().toISOString(),
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const msg = err instanceof Error ? err.message : String(err);
    logError(`WingoAI API request failed: ${msg} — skipping signal for this cycle`);
    return null;
  }
}

let wingoSignalsTableMissing = false;

/**
 * Upsert a WingoAI signal row into public.wingo_t7_signals (if table exists).
 * Conflict target is period_id — so the same period will update (never duplicate).
 */
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
  } else {
    log(`WingoAI signal stored (period: ${signalRow.period_id}, signal: ${signalRow.signal}, confidence: ${signalRow.confidence ?? 'N/A'}%)`);
  }
}

/**
 * Batch-upsert multiple WingoAI signal rows (more efficient than one-by-one).
 */
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
 * Backfill historical WingoAI signals from /history/30sec on startup.
 *
 * Investigation findings (2026-09-30):
 *  - Empirically verified: live signal for period 20260930100051896 (BIG) matched
 *    history row pred (BIG) exactly once the period settled (number: 3, result: SMALL).
 *  - The `prediction` field is confirmed to be a genuine pre-settlement prediction.
 *  - All 500 records are from today (the rolling 500-period window the API keeps)
 *  - Period strings are 17-digit and match real_wingo_30s_history.issue_number exactly
 *  - confidence is not returned by /history — stored as null for historical rows
 *
 * This is safe to call on every restart: upsert is idempotent on period_id.
 */
async function backfillWingoAIHistory(supabaseClient) {
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
      const timeoutId = setTimeout(() => controller.abort(), 15000);
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

    // Build upsert batch — skip entries with null prediction
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
        confidence: null,   // /history endpoint does not return confidence
        fetched_at: new Date().toISOString(),
      });
    }

    if (batch.length > 0) {
      const { stored, errors } = await storeWingoAISignalBatch(supabaseClient, batch);
      totalStored += stored;
      if (errors > 0) {
        logError(`Backfill page ${page}: ${errors} rows failed to upsert`);
      }
    }

    log(`WingoAI backfill page ${page}: fetched=${rows.length}, stored=${batch.length}, skipped=${rows.length - batch.length}`);

    // Check if there are more pages
    const totalRecords = typeof data?.totalRecords === 'number' ? data.totalRecords : 0;
    const totalPages = Math.ceil(totalRecords / PAGE_SIZE);
    if (page >= totalPages || rows.length < PAGE_SIZE) break;
    page++;

    // Small delay between pages to avoid rate-limiting
    await sleep(500);
  }

  log(`WingoAI historical backfill complete: fetched=${totalFetched}, stored=${totalStored}, skipped=${totalSkipped}`);
}

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

// Load all existing issue numbers from Supabase to prevent duplicate inserts and preserve all 1,042+ records
async function loadExistingPeriods(supabaseClient) {
  const known = new Set();
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
        known.add(issue);
        if (!newestPeriod) {
          newestPeriod = issue;
        }
      }
    }

    if (data.length < BATCH_SIZE) break;
    from += data.length;
  }

  return { known, totalRows: totalRows || known.size, newestPeriod };
}

async function startCollector() {
  log('=== WinGo 30S Standalone Backend Collector Starting ===');

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    logError('CRITICAL: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable is missing.');
    logError('Please provide these in collector/.env or your deployment environment settings.');
    // Keep process alive to allow user to supply env without crashing the container immediately
    while (running && (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)) {
      await sleep(10000);
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

  log(`Connecting to Supabase at: ${process.env.SUPABASE_URL.replace(/https?:\/\//, '').split('.')[0]}...`);
  const { known: knownPeriods, totalRows, newestPeriod } = await loadExistingPeriods(supabaseClient);
  log(`Initialized. Preserved ${totalRows} existing records in Supabase. Newest period: ${newestPeriod || 'None'}`);

  // Backfill historical WingoAI signals (non-fatal, runs once on startup)
  try {
    await backfillWingoAIHistory(supabaseClient);
  } catch (backfillErr) {
    const backfillMsg = backfillErr instanceof Error ? backfillErr.message : String(backfillErr);
    logError(`Historical WingoAI backfill error (non-fatal): ${backfillMsg}`);
  }

  log(`Starting 24/7 continuous polling loop (interval: ${POLL_INTERVAL_MS / 1000}s)...`);

  // Optional HTTP health-check server for platforms like Render/Railway Web Services
  const portToListen = PORT || 8080;
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && (req.url === '/reset' || req.url === '/api/reset')) {
      const previousCount = knownPeriods.size;
      knownPeriods.clear();
      log(`[Collector Reset] In-memory known periods cleared (${previousCount} -> 0). Collector continuing 24/7 polling.`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, previousCount, active: true }));
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'running',
        service: 'wingo-collector',
        totalKnownPeriods: knownPeriods.size,
        lastCheck: getTimestamp(),
      })
    );
  });

  server.on('error', (err) => {
    // Port in use or permission error — log warning, collector keeps running
    logError(`Collector HTTP server warning: ${err.message}`);
  });

  server.listen(portToListen, () => {
    log(`Health-check & reset HTTP server listening on port ${portToListen}`);
  });

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
          const size = num >= 5 ? 'Big' : 'Small';
          log(`New result → inserted (Period: ${issueNumber}, Number: ${num}, Size: ${size})`);
        }
      }

      // ── WingoAI Signal fetch (non-fatal — errors here never stop WinGo collection) ──
      // Fetch AFTER processing results so the signal is associated with the NEXT period
      // that is about to be drawn, not the one already settled.
      try {
        const wingoSignal = await fetchWingoAISignal();
        if (wingoSignal) {
          await storeWingoAISignal(supabaseClient, wingoSignal);
        }
      } catch (signalErr) {
        const signalMsg = signalErr instanceof Error ? signalErr.message : String(signalErr);
        logError(`WingoAI signal cycle error (non-fatal): ${signalMsg}`);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logError(`API request failed: ${errMsg} → retrying`);
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

startCollector().catch((err) => {
  logError(`Fatal collector error: ${err.message}`);
  process.exit(1);
});
