import express from 'express';
import cors from 'cors';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Path preservation middleware for serverless/reverse-proxy environments
app.use((req, _res, next) => {
  const forwardedUrl = req.headers['x-forwarded-url'] as string | undefined;
  const matchedPath = (req.headers['x-vercel-matched-path'] || req.headers['x-matched-path']) as string | undefined;
  const originalPath = forwardedUrl || matchedPath || (req.headers['x-original-url'] as string | undefined) || (req.headers['x-rewrite-url'] as string | undefined);

  if (originalPath && (req.url === '/api' || req.url === '/api/index' || req.url === '/api/')) {
    req.url = originalPath;
  }
  next();
});

export interface TestRecord {
  id: string;
  gameCode: string;
  periodNumber: string;
  winningNumber: number;
  size: 'Big' | 'Small';
  colors: ('red' | 'green' | 'violet')[];
  environment: 'test';
  createdAt: string;
  status: 'TEST';
  replaced?: boolean;
}

// Seed memory database matching section 22
let testResults: TestRecord[] = [
  {
    id: 'seed-373',
    gameCode: 'WinGo_30S',
    periodNumber: '20260928100050373',
    winningNumber: 0,
    size: 'Small',
    colors: ['red', 'violet'],
    environment: 'test',
    createdAt: new Date(Date.now() - 15000).toISOString(),
    status: 'TEST',
  },
  {
    id: 'seed-372',
    gameCode: 'WinGo_30S',
    periodNumber: '20260928100050372',
    winningNumber: 7,
    size: 'Big',
    colors: ['green'],
    environment: 'test',
    createdAt: new Date(Date.now() - 45000).toISOString(),
    status: 'TEST',
  },
  {
    id: 'seed-371',
    gameCode: 'WinGo_30S',
    periodNumber: '20260928100050371',
    winningNumber: 4,
    size: 'Small',
    colors: ['red'],
    environment: 'test',
    createdAt: new Date(Date.now() - 75000).toISOString(),
    status: 'TEST',
  },
  {
    id: 'seed-370',
    gameCode: 'WinGo_30S',
    periodNumber: '20260928100050370',
    winningNumber: 7,
    size: 'Big',
    colors: ['green'],
    environment: 'test',
    createdAt: new Date(Date.now() - 105000).toISOString(),
    status: 'TEST',
  },
  {
    id: 'seed-369',
    gameCode: 'WinGo_30S',
    periodNumber: '20260928100050369',
    winningNumber: 9,
    size: 'Big',
    colors: ['green'],
    environment: 'test',
    createdAt: new Date(Date.now() - 135000).toISOString(),
    status: 'TEST',
  },
  {
    id: 'seed-368',
    gameCode: 'WinGo_30S',
    periodNumber: '20260928100050368',
    winningNumber: 5,
    size: 'Big',
    colors: ['green', 'violet'],
    environment: 'test',
    createdAt: new Date(Date.now() - 165000).toISOString(),
    status: 'TEST',
  },
  {
    id: 'seed-367',
    gameCode: 'WinGo_30S',
    periodNumber: '20260928100050367',
    winningNumber: 4,
    size: 'Small',
    colors: ['red'],
    environment: 'test',
    createdAt: new Date(Date.now() - 195000).toISOString(),
    status: 'TEST',
  },
  {
    id: 'seed-366',
    gameCode: 'WinGo_30S',
    periodNumber: '20260928100050366',
    winningNumber: 6,
    size: 'Big',
    colors: ['red'],
    environment: 'test',
    createdAt: new Date(Date.now() - 225000).toISOString(),
    status: 'TEST',
  },
  {
    id: 'seed-365',
    gameCode: 'WinGo_30S',
    periodNumber: '20260928100050365',
    winningNumber: 5,
    size: 'Big',
    colors: ['green', 'violet'],
    environment: 'test',
    createdAt: new Date(Date.now() - 255000).toISOString(),
    status: 'TEST',
  },
];

// Calculation rule logic
function calculateResult(num: number): { size: 'Big' | 'Small'; colors: ('red' | 'green' | 'violet')[] } {
  const size: 'Big' | 'Small' = num >= 5 ? 'Big' : 'Small';
  let colors: ('red' | 'green' | 'violet')[];
  if (num === 0) colors = ['red', 'violet'];
  else if (num === 5) colors = ['green', 'violet'];
  else if (num % 2 === 0) colors = ['red'];
  else colors = ['green'];
  return { size, colors };
}

// ==========================================
// 5.1 Bearer Token Authentication (Mock)
// POST /api/merchant/token
// ==========================================
app.post('/api/merchant/token', (req, res) => {
  const { login, device_name } = req.body;
  res.json({
    status: 'success',
    token_type: 'Bearer',
    access_token: 'mock_sanctum_token_' + Buffer.from(login || 'dev').toString('hex'),
    device_name: device_name || 'backend-service',
    message: 'Mock Sanctum token issued for sandbox testing',
  });
});

// ==========================================
// 5.2 Set Custom Winning Number Override
// POST /merchant/api/set_merchant_custom_result.php
// Also supports standard /api/test/results
// ==========================================
const handleCustomResult = (req: express.Request, res: express.Response) => {
  const gameCode = req.body.game_code || req.body.gameCode || 'WinGo_30S';
  const periodNumber = req.body.period_number || req.body.periodNumber;
  const rawNum = req.body.winning_number !== undefined ? req.body.winning_number : req.body.winningNumber;
  const allowReplace = req.body.allowReplace === true || req.body.allow_replace === '1' || req.body.allowReplace === 'true';

  const winningNumber = Number(rawNum);

  if (isNaN(winningNumber) || winningNumber < 0 || winningNumber > 9) {
    return res.status(400).json({
      status: 'error',
      code: 400,
      message: 'winning_number must be an integer between 0 and 9',
    });
  }

  if (!periodNumber || !/^\d+$/.test(String(periodNumber).trim())) {
    return res.status(400).json({
      status: 'error',
      code: 400,
      message: 'period_number must be a non-empty numeric sequence',
    });
  }

  const existingIdx = testResults.findIndex(
    (r) => r.gameCode === gameCode && r.periodNumber === String(periodNumber).trim()
  );

  if (existingIdx !== -1 && !allowReplace) {
    return res.status(409).json({
      status: 'error',
      code: 409,
      message: `Period ${periodNumber} already has an active result. Set allow_replace=true to overwrite.`,
    });
  }

  // Server-side deterministic calculation
  const { size, colors } = calculateResult(winningNumber);

  const record: TestRecord = {
    id: existingIdx !== -1 ? testResults[existingIdx].id : 'tr_' + Math.random().toString(36).substring(2, 9),
    gameCode,
    periodNumber: String(periodNumber).trim(),
    winningNumber,
    size,
    colors,
    environment: 'test',
    createdAt: new Date().toISOString(),
    status: 'TEST',
    replaced: existingIdx !== -1,
  };

  if (existingIdx !== -1) {
    testResults[existingIdx] = record;
  } else {
    testResults.unshift(record);
  }

  res.status(201).json({
    status: 'success',
    code: 200,
    message: 'Winning number set successfully in test sandbox',
    data: {
      game_code: record.gameCode,
      period_number: record.periodNumber,
      winning_number: record.winningNumber,
      size: record.size,
      colors: record.colors,
      is_test_override: true,
      timestamp: record.createdAt,
    },
  });
};

app.post('/merchant/api/set_merchant_custom_result.php', handleCustomResult);
app.post('/api/test/results', handleCustomResult);

// ==========================================
// 5.3 Fetch Active Custom Results
// GET /merchant/api/get_merchant_custom_results.php
// Also supports GET /api/test/results
// ==========================================
const handleGetResults = (req: express.Request, res: express.Response) => {
  const game = (req.query.game as string) || (req.query.game_code as string) || (req.query.gameCode as string);
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;

  let results = [...testResults];
  if (game) {
    results = results.filter((r) => r.gameCode === game);
  }

  results.sort((a, b) => {
    try {
      const diff = BigInt(b.periodNumber) - BigInt(a.periodNumber);
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    } catch {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
  });

  if (limit && limit > 0) {
    results = results.slice(0, limit);
  }

  res.json({
    status: 'success',
    code: 200,
    count: results.length,
    results: results.map((r) => ({
      id: r.id,
      game_code: r.gameCode,
      period_number: r.periodNumber,
      winning_number: r.winningNumber,
      size: r.size,
      colors: r.colors,
      status: r.status,
      created_at: r.createdAt,
    })),
  });
};

app.get('/merchant/api/get_merchant_custom_results.php', handleGetResults);
app.get('/api/test/results', handleGetResults);

// GET /api/test/current-period
app.get('/api/test/current-period', (req, res) => {
  const gameCode = (req.query.gameCode as string) || (req.query.game_code as string) || 'WinGo_30S';
  const filtered = testResults.filter((r) => r.gameCode === gameCode);

  let nextPeriodNumber = '20260928100050374';
  if (filtered.length > 0) {
    try {
      const maxVal = filtered.reduce((max, r) => {
        const val = BigInt(r.periodNumber);
        return val > max ? val : max;
      }, 0n);
      nextPeriodNumber = (maxVal + 1n).toString();
    } catch {
      nextPeriodNumber = '20260928100050374';
    }
  }

  res.json({
    game_code: gameCode,
    period_number: nextPeriodNumber,
    timestamp: new Date().toISOString(),
    next_period_number: (BigInt(nextPeriodNumber) + 1n).toString(),
    draw_interval_seconds: gameCode === 'WinGo_30S' ? 30 : 60,
  });
});

// DELETE /api/test/results/:id
app.delete('/api/test/results/:id', (req, res) => {
  const { id } = req.params;
  const initialLength = testResults.length;
  testResults = testResults.filter((r) => r.id !== id);

  if (testResults.length === initialLength) {
    return res.status(404).json({ status: 'error', message: 'Record not found' });
  }

  res.json({ status: 'success', id });
});

// ========================================================
// REAL WINGO 30S IN-MEMORY STORE & STATUS ENDPOINTS
// /api/real/history is now served directly from the official WinGo 30S source
// API (server-side), so the history flow does NOT depend on the Render collector.
// Supabase / in-memory stores remain only as fallback if the upstream is unreachable.
// ========================================================

export interface RealCompletedRecord {
  issueNumber: string;
  periodNumber: string;
  winningNumber: number;
  size: 'Big' | 'Small';
  colors: ('red' | 'green' | 'violet')[];
  premium: string;
  sum: number;
  completedAt: string;
  source: 'COMPLETED REAL HISTORY';
}

let accumulatedRealHistory: RealCompletedRecord[] = [];
let lastRealFetchTime = 0;
let lastSupabaseSyncTime: string | null = null;

function getSupabaseClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function parseRealColors(rawColor: string | undefined, num: number): ('red' | 'green' | 'violet')[] {
  if (rawColor) {
    const parts = rawColor.split(',').map((c) => c.trim().toLowerCase());
    const valid = parts.filter((c): c is 'red' | 'green' | 'violet' => ['red', 'green', 'violet'].includes(c));
    if (valid.length > 0) return valid;
  }
  if (num === 0) return ['red', 'violet'];
  if (num === 5) return ['green', 'violet'];
  return num % 2 === 0 ? ['red'] : ['green'];
}

// Helper to inspect Supabase JWT role without exposing secret key
function getJwtRole(token?: string): string {
  const key = token || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  try {
    const parts = key.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
      return payload.role || 'unknown';
    }
  } catch {
    // ignore
  }
  return 'missing-or-invalid';
}

function getSanitizedSupabaseUrl(): string {
  const url = process.env.SUPABASE_URL || '';
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return url ? 'malformed-url' : 'not-set';
  }
}

/**
 * Format a record with the EXACT 8 fields of public.real_wingo_30s_history:
 * issue_number, number, color, premium, sum, game_code, source, source_time
 */
function formatRecordForSupabase(
  r: RealCompletedRecord,
  timeType: 'iso' | 'millis' = 'iso'
): Record<string, unknown> {
  const num = typeof r.winningNumber === 'number' ? r.winningNumber : parseInt(String(r.winningNumber ?? 0), 10);
  const colorStr = Array.isArray(r.colors) ? r.colors.join(',') : String(r.colors || '');

  return {
    game_code: 'WinGo_30S',
    issue_number: String(r.issueNumber),
    number: isNaN(num) ? 0 : num,
    color: colorStr,
    premium: String(r.premium ?? num),
    sum: typeof r.sum === 'number' ? r.sum : 0,
    source: 'COMPLETED REAL HISTORY',
    source_time:
      timeType === 'millis'
        ? Date.parse(r.completedAt) || Date.now()
        : r.completedAt || new Date().toISOString(),
  };
}

export interface SupabaseDetailedError {
  message: string;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
  status?: number | null;
}

export interface SupabaseUpsertResult {
  success: boolean;
  error?: SupabaseDetailedError | null;
  verifiedRow?: Record<string, unknown> | null;
  upsertedCount?: number;
  totalTableRows?: number;
  stage?: string;
  testedPayload?: Record<string, unknown>;
}

/**
 * Test single record upsert first, return exact error without hiding,
 * then perform batch synchronization and verify row exists.
 */
async function syncRecordsToSupabase(records: RealCompletedRecord[]): Promise<SupabaseUpsertResult> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      success: false,
      error: {
        message: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable is missing on server',
        details: 'Check Vercel Project Settings > Environment Variables',
        code: 'MISSING_ENV_VARS',
      },
      stage: 'client_initialization',
    };
  }

  if (!records || records.length === 0) {
    return { success: true, upsertedCount: 0 };
  }

  // 1. Test with ONE real record first (Requirement 13 & 14)
  let testPayload = formatRecordForSupabase(records[0], 'iso');
  let singleResponse = await client
    .from('real_wingo_30s_history')
    .upsert([testPayload], { onConflict: 'game_code,issue_number' })
    .select();

  // If failed with a timestamp type error, test millis fallback for source_time
  if (
    singleResponse.error &&
    (singleResponse.error.code === '22007' || singleResponse.error.code === '22P02')
  ) {
    const millisPayload = formatRecordForSupabase(records[0], 'millis');
    const retryRes = await client
      .from('real_wingo_30s_history')
      .upsert([millisPayload], { onConflict: 'game_code,issue_number' })
      .select();

    if (!retryRes.error) {
      testPayload = millisPayload;
      singleResponse = retryRes;
    }
  }

  if (singleResponse.error) {
    console.error("SUPABASE UPSERT ERROR", {
      message: singleResponse.error.message,
      details: singleResponse.error.details,
      hint: singleResponse.error.hint,
      code: singleResponse.error.code,
      status: singleResponse.status,
    });

    return {
      success: false,
      error: {
        message: singleResponse.error.message,
        details: singleResponse.error.details,
        hint: singleResponse.error.hint,
        code: singleResponse.error.code,
        status: singleResponse.status,
      },
      testedPayload: testPayload,
      stage: 'single_record_test',
    };
  }

  // 2. Single record insert worked! If more than 1 record, execute batch upsert
  if (records.length > 1) {
    const isMillisTime = typeof testPayload.source_time === 'number';
    const batchPayload = records.map((r) =>
      formatRecordForSupabase(r, isMillisTime ? 'millis' : 'iso')
    );

    const batchResponse = await client
      .from('real_wingo_30s_history')
      .upsert(batchPayload, { onConflict: 'game_code,issue_number' });

    if (batchResponse.error) {
      console.error("SUPABASE UPSERT ERROR", {
        message: batchResponse.error.message,
        details: batchResponse.error.details,
        hint: batchResponse.error.hint,
        code: batchResponse.error.code,
        status: batchResponse.status,
      });

      return {
        success: false,
        error: {
          message: batchResponse.error.message,
          details: batchResponse.error.details,
          hint: batchResponse.error.hint,
          code: batchResponse.error.code,
          status: batchResponse.status,
        },
        stage: 'batch_upsert',
      };
    }
  }

  // 3. Verify that an actual row exists in public.real_wingo_30s_history (Requirement 16 & 17)
  const verifyRes = await client
    .from('real_wingo_30s_history')
    .select('issue_number, number, color, premium, sum, game_code, source, source_time')
    .eq('game_code', 'WinGo_30S')
    .eq('issue_number', String(testPayload.issue_number))
    .limit(1);

  const countRes = await client
    .from('real_wingo_30s_history')
    .select('*', { count: 'exact', head: true })
    .eq('game_code', 'WinGo_30S');

  const verifiedRow = verifyRes.data?.[0] || null;

  return {
    success: true,
    upsertedCount: records.length,
    totalTableRows: countRes.count ?? records.length,
    verifiedRow,
  };
}

/**
 * Compare two issue numbers numerically descending (e.g. 50501 before 50500).
 * Handles text format safely using BigInt or numeric locale comparison.
 */
function compareIssuesDesc(issueA: string, issueB: string): number {
  const cleanA = String(issueA || '').trim();
  const cleanB = String(issueB || '').trim();
  try {
    const diff = BigInt(cleanB) - BigInt(cleanA);
    if (diff > 0n) return 1;
    if (diff < 0n) return -1;
    return 0;
  } catch {
    return cleanB.localeCompare(cleanA, undefined, { numeric: true });
  }
}

function sortRealRecordsDescending(records: RealCompletedRecord[]): RealCompletedRecord[] {
  return records.sort((a, b) => compareIssuesDesc(a.issueNumber, b.issueNumber));
}

/**
 * Read history from public.real_wingo_30s_history strictly ordered by issue_number numerically descending.
 * Uses pagination with batching (.range(from, to)) to retrieve 1,000+ records beyond PostgREST single-query limits.
 */
async function readFromSupabase(
  limit: number | 'all' = 'all'
): Promise<{ records: RealCompletedRecord[]; totalCount: number; error: string | null }> {
  const client = getSupabaseClient();
  if (!client) {
    return { records: [], totalCount: 0, error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured' };
  }

  const BATCH_SIZE = 1000;
  let from = 0;
  const allRows: any[] = [];
  let totalCount = 0;

  while (true) {
    const to =
      limit === 'all'
        ? from + BATCH_SIZE - 1
        : Math.min(from + BATCH_SIZE - 1, limit - 1);

    const { data, count, error } = await client
      .from('real_wingo_30s_history')
      .select('*', { count: from === 0 ? 'exact' : undefined })
      .eq('game_code', 'WinGo_30S')
      .order('issue_number', { ascending: false })
      .range(from, to);

    if (error) {
      console.error('[Supabase Read Error]:', error);
      if (allRows.length > 0) {
        break;
      }
      return { records: [], totalCount: 0, error: error.message };
    }

    if (from === 0 && typeof count === 'number') {
      totalCount = count;
    }

    if (!data || data.length === 0) {
      break;
    }

    allRows.push(...data);

    // If fewer rows returned than the requested range batch, we have reached the end of the table
    const requestedBatchCount = to - from + 1;
    if (data.length < requestedBatchCount) {
      break;
    }

    if (typeof limit === 'number' && allRows.length >= limit) {
      break;
    }

    from += data.length;
  }

  const dedupeMap = new Map<string, RealCompletedRecord>();
  for (const row of allRows) {
    const rawNum = row.winning_number !== undefined ? row.winning_number : row.number;
    const num = typeof rawNum === 'number' ? rawNum : parseInt(String(rawNum ?? 0), 10);
    const colorStr = String(row.color || (Array.isArray(row.colors) ? row.colors.join(',') : '') || '');
    const issue = String(row.issue_number).trim();

    if (issue && !dedupeMap.has(issue)) {
      dedupeMap.set(issue, {
        issueNumber: issue,
        periodNumber: issue,
        winningNumber: isNaN(num) ? 0 : num,
        size: (row.size as 'Big' | 'Small') || (num >= 5 ? 'Big' : 'Small'),
        colors: parseRealColors(colorStr, num),
        premium: String(row.premium ?? num),
        sum: typeof row.sum === 'number' ? row.sum : 0,
        completedAt: row.completed_at || row.created_at || new Date().toISOString(),
        source: 'COMPLETED REAL HISTORY',
      });
    }
  }

  // Explicitly ensure numeric descending sort (Requirement 3, 4, 5, 6)
  const records = sortRealRecordsDescending(Array.from(dedupeMap.values()));

  return { records, totalCount: totalCount || records.length, error: null };
}

// GET /api/real/current (Fallback status / schedule)
app.get('/api/real/current', async (_req, res) => {
  const UPSTREAM_BASE_URL = (process.env.UPSTREAM_WINGO_BASE_URL || 'https://draw.ar-lottery01.com/WinGo').replace(/\/$/, '');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

  try {
    const ts = Date.now();
    const url = `${UPSTREAM_BASE_URL}/WinGo_30S.json?ts=${ts}`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
      },
    });

    if (response.ok) {
      const data = (await response.json()) as {
        gameCode?: string;
        intervalMinute?: number;
        state?: number;
        previous?: { issueNumber?: string; startTime?: number; endTime?: number };
        current?: { issueNumber?: string; startTime?: number; endTime?: number };
        next?: { issueNumber?: string; startTime?: number; endTime?: number };
      };

      const endTime = data.current?.endTime || (Date.now() + 30000);
      const remainingSeconds = Math.max(0, Math.round((endTime - Date.now()) / 1000));

      return res.json({
        success: true,
        gameCode: data.gameCode || 'WinGo_30S',
        intervalMinute: data.intervalMinute || 0.5,
        state: data.state ?? 1,
        currentIssue: data.current?.issueNumber || '',
        startTime: data.current?.startTime || Date.now(),
        endTime,
        remainingSeconds,
        previousIssue: data.previous?.issueNumber || '',
        nextIssue: data.next?.issueNumber || '',
        source: 'CURRENT ISSUE',
        lastUpdated: new Date().toISOString(),
      });
    }
  } catch {
    // Cloudflare 403 or network failure on datacenter IP
  } finally {
    clearTimeout(timeoutId);
  }

  // Graceful fallback from latest accumulated record
  const latest = accumulatedRealHistory[0];
  let curIssue = '';
  let prevIssue = '';
  let nextIssue = '';
  if (latest) {
    try {
      prevIssue = latest.issueNumber;
      curIssue = (BigInt(latest.issueNumber) + 1n).toString();
      nextIssue = (BigInt(latest.issueNumber) + 2n).toString();
    } catch {
      // ignore
    }
  }

  res.json({
    success: true,
    gameCode: 'WinGo_30S',
    intervalMinute: 0.5,
    state: 1,
    currentIssue: curIssue,
    startTime: Date.now(),
    endTime: Date.now() + 30000,
    remainingSeconds: 25,
    previousIssue: prevIssue,
    nextIssue,
    source: 'CURRENT ISSUE',
    lastUpdated: new Date().toISOString(),
    statusNote: 'Fallback schedule (browser direct fetch is primary)',
  });
});

// GET /api/real/status (Check Supabase configuration and sync status)
app.get('/api/real/status', (req, res) => {
  const client = getSupabaseClient();
  res.json({
    supabaseConfigured: !!client,
    lastSyncTime: lastSupabaseSyncTime,
    totalInMemory: accumulatedRealHistory.length,
    lastFetchTime: lastRealFetchTime ? new Date(lastRealFetchTime).toISOString() : null,
  });
});

// Official WinGo 30S source (same game, same JSON schema, same issue-number stream).
// Cloudflare blocks datacenter IPs (Vercel/AWS) with HTTP 403 on some official mirror
// hosts, so we fail over across the official mirror hosts. No third-party API is used.
// Hosts are tried in order — datacenter-friendly mirrors first, then the legacy host.
const OFFICIAL_WINGO_HISTORY_HOSTS = [
  'https://draw.ar-lottery02.com',
  'https://draw.ar-lottery03.com',
  'https://draw.ar-lottery01.com',
];
const OFFICIAL_WINGO_HISTORY_PATH = '/WinGo/WinGo_30S/GetHistoryIssuePage.json';

// Short per-host timeout so a blocked/hanging host cannot stall a 5s polling cycle.
const UPSTREAM_TIMEOUT_MS = 3000;

interface LiveUpstreamResult {
  records: RealCompletedRecord[];
  totalCount: number;
  host: string;
  status: number;
  responseMs: number;
}

/**
 * Extract the real reason from a fetch/network error. Undici (Node fetch) surfaces
 * generic failures as message "fetch failed"; the actual cause lives in err.cause.
 */
function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts: string[] = [`${err.name}: ${err.message}`];
  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    parts.push(`cause: ${cause.name}: ${cause.message}`);
  } else if (typeof cause === 'string') {
    parts.push(`cause: ${cause}`);
  } else if (cause && typeof cause === 'object') {
    const code = (cause as { code?: string }).code;
    const message = (cause as { message?: string }).message;
    parts.push(`cause: ${code || message || JSON.stringify(cause).slice(0, 200)}`);
  }
  return parts.join(' | ');
}

/**
 * Fetch the latest settled WinGo 30S draws straight from the official source API.
 * Reuses the upstream endpoint already present in the project — no new API invented.
 */
async function fetchLiveOfficialHistory(): Promise<LiveUpstreamResult> {
  let lastError = 'no upstream host attempted';

  for (const host of OFFICIAL_WINGO_HISTORY_HOSTS) {
    const startedAt = Date.now();
    const url = `${host}${OFFICIAL_WINGO_HISTORY_PATH}?ts=${startedAt}`;
    console.log(`[real/history] upstream_request_started host=${host}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          Referer: `${host}/`,
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
        signal: controller.signal,
      });

      const responseMs = Date.now() - startedAt;
      console.log(`[real/history] upstream_response_ms=${responseMs} host=${host}`);
      console.log(`[real/history] upstream_status=${response.status} host=${host}`);

      if (!response.ok) {
        const bodySnippet = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 120);
        lastError = `HTTP ${response.status} ${response.statusText} from ${host}${bodySnippet ? ` (${bodySnippet})` : ''}`;
        console.warn(`[real/history] upstream_failed host=${host} status=${response.status} response_ms=${responseMs} reason=${lastError}`);
        continue;
      }

      const rawText = await response.text();
      let payload: {
        serviceTime?: number;
        data?: {
          list?: Array<{
            issueNumber?: string;
            number?: string | number;
            color?: string;
            premium?: string | number;
            sum?: number;
          }>;
        };
      };
      try {
        payload = JSON.parse(rawText) as typeof payload;
      } catch {
        lastError = `${host} returned non-JSON body (${rawText.slice(0, 120).replace(/\s+/g, ' ')})`;
        console.warn(`[real/history] upstream_failed host=${host} status=${response.status} reason=${lastError}`);
        continue;
      }

      const list = payload?.data?.list;
      if (!Array.isArray(list) || list.length === 0) {
        lastError = `${host} returned an empty or invalid records list`;
        console.warn(`[real/history] upstream_failed host=${host} status=${response.status} reason=${lastError}`);
        continue;
      }

      const dedupeMap = new Map<string, RealCompletedRecord>();
      for (const item of list) {
        const issue = String(item.issueNumber || '').trim();
        const rawNum = item.number;
        const num = typeof rawNum === 'number' ? rawNum : parseInt(String(rawNum ?? ''), 10);

        if (issue && !isNaN(num) && num >= 0 && num <= 9) {
          dedupeMap.set(issue, {
            issueNumber: issue,
            periodNumber: issue,
            winningNumber: num,
            size: num >= 5 ? 'Big' : 'Small',
            colors: parseRealColors(item.color, num),
            premium: String(item.premium ?? num),
            sum: typeof item.sum === 'number' ? item.sum : 0,
            completedAt: payload.serviceTime
              ? new Date(payload.serviceTime).toISOString()
              : new Date().toISOString(),
            source: 'COMPLETED REAL HISTORY',
          });
        }
      }

      if (dedupeMap.size === 0) {
        lastError = `${host} response contained no valid draw records`;
        console.warn(`[real/history] upstream_failed host=${host} status=${response.status} reason=${lastError}`);
        continue;
      }

      const records = sortRealRecordsDescending(Array.from(dedupeMap.values()));
      console.log(`[real/history] latest_period=${records[0].issueNumber} host=${host} count=${records.length}`);
      return {
        records,
        totalCount: records.length,
        host,
        status: response.status,
        responseMs,
      };
    } catch (err) {
      const responseMs = Date.now() - startedAt;
      lastError = `${host}: ${describeFetchError(err)}`;
      console.warn(`[real/history] upstream_failed host=${host} response_ms=${responseMs} reason=${lastError}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new Error(`all official hosts failed -> ${lastError}`);
}

/**
 * Return the subset of `issues` that already exist in public.real_wingo_30s_history.
 * Used to distinguish newly discovered periods from already-stored ones (dedupe).
 */
async function getExistingIssues(client: SupabaseClient, issues: string[]): Promise<Set<string>> {
  const existing = new Set<string>();
  if (!issues || issues.length === 0) return existing;
  try {
    const { data, error } = await client
      .from('real_wingo_30s_history')
      .select('issue_number')
      .eq('game_code', 'WinGo_30S')
      .in('issue_number', issues);
    if (!error && Array.isArray(data)) {
      for (const row of data) existing.add(String(row.issue_number).trim());
    }
  } catch {
    // Non-fatal: treat all as new — the unique constraint still prevents duplicates.
  }
  return existing;
}

// ========================================================
// BACKGROUND COLLECTOR WORKER
// Invoked by Vercel Cron -> writes new WinGo 30S periods into
// public.real_wingo_30s_history. Runs entirely server-side, so collection
// continues with the browser fully closed.
//
// Security: Vercel Cron automatically sends `Authorization: Bearer $CRON_SECRET`
// when the CRON_SECRET environment variable is set. Requests without a valid
// secret are rejected, so this endpoint cannot be abused as a free public
// polling endpoint (each accepted hit costs an upstream fetch plus a DB write).
// ========================================================

/**
 * Constant-time-ish bearer check against CRON_SECRET. Fails CLOSED when the
 * secret is not configured, so a missing env var can never open the endpoint.
 */
function isAuthorizedWorkerRequest(req: express.Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length === 0) return false;

  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.*)$/i.exec(header.trim());
  const provided = (match?.[1] || '').trim();
  if (provided.length !== secret.length) return false;

  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ secret.charCodeAt(i);
  }
  return diff === 0;
}

interface CollectRunResult {
  success: boolean;
  upstreamLatestPeriod: string | null;
  upstreamCount: number;
  inserted: number;
  duplicates: number;
  tableTotal: number | null;
  durationMs: number;
  error: string | null;
}

/**
 * One idempotent collection cycle: fetch upstream -> diff against stored
 * periods -> insert only the new ones. Never deletes or rewrites history.
 * Safe to run every minute; the same period always resolves to one row.
 */
async function runCollectOnce(): Promise<CollectRunResult> {
  const startedAt = Date.now();
  const durationMs = () => Date.now() - startedAt;

  console.log('[worker] started');

  const client = getSupabaseClient();
  if (!client) {
    const error = 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured on the server';
    console.error(`[worker] failed reason=${error}`);
    return {
      success: false,
      upstreamLatestPeriod: null,
      upstreamCount: 0,
      inserted: 0,
      duplicates: 0,
      tableTotal: null,
      durationMs: durationMs(),
      error,
    };
  }

  // 1. Fetch the newest settled draws from the official upstream source
  let live: LiveUpstreamResult;
  try {
    live = await fetchLiveOfficialHistory();
  } catch (err) {
    const error = describeFetchError(err);
    console.error(`[worker] upstream_failed reason=${error}`);
    return {
      success: false,
      upstreamLatestPeriod: null,
      upstreamCount: 0,
      inserted: 0,
      duplicates: 0,
      tableTotal: null,
      durationMs: durationMs(),
      error,
    };
  }

  const upstreamLatestPeriod = live.records[0]?.issueNumber || null;
  const upstreamCount = live.records.length;
  console.log(`[worker] upstream_latest_period=${upstreamLatestPeriod}`);
  console.log(`[worker] upstream_count=${upstreamCount}`);

  // 2. Dedupe against what is already persisted
  const issues = live.records.map((r) => r.issueNumber);
  const existing = await getExistingIssues(client, issues);
  const newRecords = live.records.filter((r) => !existing.has(r.issueNumber));
  const duplicates = live.records.length - newRecords.length;

  // 3. Insert only the newly discovered periods. The upsert conflict target
  //    (game_code,issue_number) is the second line of defence if two cron
  //    invocations overlap, so duplicates cannot be created either way.
  let inserted = 0;
  if (newRecords.length > 0) {
    const syncRes = await syncRecordsToSupabase(newRecords);
    if (syncRes.success) {
      inserted = newRecords.length;
      lastSupabaseSyncTime = new Date().toISOString();
    } else {
      console.error('[worker] supabase_upsert_failed', syncRes.error);
    }
  }

  const { count } = await client
    .from('real_wingo_30s_history')
    .select('issue_number', { count: 'exact', head: true })
    .eq('game_code', 'WinGo_30S');

  console.log(`[worker] inserted=${inserted}`);
  console.log(`[worker] duplicates=${duplicates}`);
  console.log('[worker] completed');

  return {
    success: true,
    upstreamLatestPeriod,
    upstreamCount,
    inserted,
    duplicates,
    tableTotal: count ?? null,
    durationMs: durationMs(),
    error: null,
  };
}

// GET /api/real/collect — scheduled collection worker (Vercel Cron target)
const handleCollectWorker = async (_req: express.Request, res: express.Response) => {
  if (!process.env.CRON_SECRET) {
    console.error('[worker] misconfigured CRON_SECRET is not set on the server');
    return res.status(503).json({
      success: false,
      error: 'CRON_SECRET is not configured. Set it in Vercel project environment variables.',
    });
  }

  if (!isAuthorizedWorkerRequest(_req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  res.setHeader('Cache-Control', 'no-store');
  const result = await runCollectOnce();
  return res.status(result.success ? 200 : 502).json(result);
};

app.get('/api/real/collect', handleCollectWorker);
// GET /api/real/collect/backfill — same idempotent cycle, invoked less often by
// cron to recover any periods a missed per-minute run left behind. Each run
// already re-fetches the newest upstream window, so a missed run is
// self-healing; this is a low-frequency safety net, not the primary path.
app.get('/api/real/collect/backfill', handleCollectWorker);

// GET /api/real/history
// READ-ONLY. public.real_wingo_30s_history is populated exclusively by the
// background collector (GET /api/real/collect) via Vercel Cron, so the browser
// only displays persisted data and never drives collection.
// Fallback: if Supabase is unreachable, serve the live upstream window read-only
// (nothing is written) so the UI degrades instead of going blank.
app.get('/api/real/history', async (req, res) => {
  // Strict no-cache: every request must return the latest available result
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');

  const limitParam = req.query.limit as string;

  let limit: number | 'all' = 'all';
  if (limitParam === 'all') {
    limit = 'all';
  } else if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (!isNaN(parsed) && parsed > 0) limit = parsed;
  }

  const supabaseClient = getSupabaseClient();
  let live: LiveUpstreamResult | null = null;

  // 1. Serve the FULL persistent history from Supabase, written by the collector.
  if (supabaseClient) {
    const { records, totalCount, error } = await readFromSupabase(limit);

    console.log(`[real/history] supabase_total=${totalCount}`);

    if (!error && records.length > 0) {
      // Merge stored history into in-memory cache as well
      const map = new Map<string, RealCompletedRecord>();
      for (const r of accumulatedRealHistory) map.set(r.issueNumber, r);
      for (const r of records) map.set(r.issueNumber, r);
      accumulatedRealHistory = sortRealRecordsDescending(Array.from(map.values()));

      return res.json({
        success: true,
        totalAvailable: totalCount,
        returnedCount: records.length,
        lastUpdated: new Date().toISOString(),
        lastSyncTime: lastSupabaseSyncTime || new Date().toISOString(),
        storage: 'supabase',
        source: 'COMPLETED REAL HISTORY',
        results: records,
        error: null,
      });
    }
  }

  // 2. Fallback: if Supabase is unavailable/empty, serve the live upstream window
  //    READ-ONLY — nothing is persisted from this path. Collection is the
  //    background worker's job (GET /api/real/collect).
  try {
    live = await fetchLiveOfficialHistory();
    const liveMap = new Map<string, RealCompletedRecord>();
    for (const r of accumulatedRealHistory) liveMap.set(r.issueNumber, r);
    for (const r of live.records) liveMap.set(r.issueNumber, r);
    accumulatedRealHistory = sortRealRecordsDescending(Array.from(liveMap.values()));
    lastRealFetchTime = Date.now();
  } catch (liveErr) {
    console.warn(
      `[real/history] live_upstream_failed reason=${describeFetchError(liveErr)}; serving stored Supabase history`
    );
  }

  if (live && live.records.length > 0) {
    const liveResults = limit === 'all' ? live.records : live.records.slice(0, limit);
    return res.json({
      success: true,
      totalAvailable: live.totalCount,
      returnedCount: liveResults.length,
      lastUpdated: new Date().toISOString(),
      lastSyncTime: lastSupabaseSyncTime,
      storage: 'live-upstream-readonly',
      source: 'COMPLETED REAL HISTORY',
      results: liveResults,
      error: supabaseClient
        ? null
        : 'Supabase not configured; serving live upstream window only (not persisted).',
    });
  }

  // 3. Last resort: in-memory cache
  const sliceCount = limit === 'all' ? accumulatedRealHistory.length : limit;
  res.json({
    success: true,
    totalAvailable: accumulatedRealHistory.length,
    returnedCount: Math.min(sliceCount, accumulatedRealHistory.length),
    lastUpdated: new Date(lastRealFetchTime || Date.now()).toISOString(),
    lastSyncTime: lastSupabaseSyncTime,
    storage: supabaseClient ? 'supabase-empty-fallback' : 'in-memory-fallback',
    error: supabaseClient
      ? null
      : 'Supabase server environment variables (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) not set. Using in-memory fallback.',
    source: 'COMPLETED REAL HISTORY',
    results: accumulatedRealHistory.slice(0, sliceCount),
  });
});

// POST /api/real/history & POST /api/real/sync (Upserts records into Supabase & in-memory cache)
const handleSyncHistory = async (req: express.Request, res: express.Response) => {
  const incoming = Array.isArray(req.body.results)
    ? req.body.results
    : Array.isArray(req.body.records)
    ? req.body.records
    : [];

  if (incoming.length === 0) {
    return res.status(400).json({ success: false, message: 'No records provided in body' });
  }

  const validRecords: RealCompletedRecord[] = [];
  for (const item of incoming) {
    if (item && (item.issueNumber || item.issue_number || item.periodNumber)) {
      const issue = String(item.issueNumber || item.issue_number || item.periodNumber).trim();
      const rawNum =
        item.winningNumber !== undefined
          ? item.winningNumber
          : item.winning_number !== undefined
          ? item.winning_number
          : item.number;
      const num = Number(rawNum);
      if (issue && !isNaN(num) && num >= 0 && num <= 9) {
        validRecords.push({
          issueNumber: issue,
          periodNumber: issue,
          winningNumber: num,
          size: (item.size as 'Big' | 'Small') || (num >= 5 ? 'Big' : 'Small'),
          colors: parseRealColors(item.color || (Array.isArray(item.colors) ? item.colors.join(',') : ''), num),
          premium: String(item.premium ?? num),
          sum: Number(item.sum ?? 0),
          completedAt: item.completedAt || item.created_at || new Date().toISOString(),
          source: 'COMPLETED REAL HISTORY',
        });
      }
    }
  }

  // Deduplicate incoming batch by issueNumber
  const dedupeMap = new Map<string, RealCompletedRecord>();
  for (const r of validRecords) {
    dedupeMap.set(r.issueNumber, r);
  }
  const cleanRecords = Array.from(dedupeMap.values());

  const client = getSupabaseClient();
  const syncResult = await syncRecordsToSupabase(cleanRecords);

  // Merge into in-memory store as cache
  const memoryMap = new Map<string, RealCompletedRecord>();
  for (const r of accumulatedRealHistory) memoryMap.set(r.issueNumber, r);
  for (const r of cleanRecords) memoryMap.set(r.issueNumber, r);
  accumulatedRealHistory = sortRealRecordsDescending(Array.from(memoryMap.values()));
  lastRealFetchTime = Date.now();

  if (!syncResult.success) {
    console.error("SUPABASE UPSERT ERROR", {
      message: syncResult.error?.message,
      details: syncResult.error?.details,
      hint: syncResult.error?.hint,
      code: syncResult.error?.code,
      status: syncResult.error?.status,
      stage: syncResult.stage,
      testedPayload: syncResult.testedPayload,
    });

    return res.status(200).json({
      success: false,
      upsertedCount: 0,
      totalAvailable: accumulatedRealHistory.length,
      storage: client ? 'supabase-error' : 'in-memory-fallback',
      lastSyncTime: lastSupabaseSyncTime,
      error: syncResult.error?.message || 'Supabase upsert failed',
      details: syncResult.error?.details || null,
      hint: syncResult.error?.hint || null,
      code: syncResult.error?.code || null,
      status: syncResult.error?.status || null,
      stage: syncResult.stage || 'unknown',
      testedPayload: syncResult.testedPayload || null,
    });
  }

  lastSupabaseSyncTime = new Date().toISOString();

  res.json({
    success: true,
    upsertedCount: syncResult.upsertedCount ?? cleanRecords.length,
    totalAvailable: accumulatedRealHistory.length,
    totalTableRows: syncResult.totalTableRows,
    storage: 'supabase',
    lastSyncTime: lastSupabaseSyncTime,
    verifiedRow: syncResult.verifiedRow,
    error: null,
  });
};

app.post('/api/real/history', handleSyncHistory);
app.post('/api/real/sync', handleSyncHistory);

// POST /api/real/reset (also aliased to /api/reset, /real/reset, /reset)
// Server-side protected reset of application data in Supabase & memory.
// Clears: public.real_wingo_30s_history and public.wingo_t7_signals.
// Does NOT delete unrelated tables or user accounts.
// Clears server in-memory caches and notifies the collector worker.
const handleResetEndpoint = async (_req: express.Request, res: express.Response) => {
  const client = getSupabaseClient();
  const deletedTables: string[] = [];

  if (client) {
    try {
      // 1. Delete all records from public.real_wingo_30s_history
      const { error: histDelErr } = await client
        .from('real_wingo_30s_history')
        .delete()
        .neq('issue_number', '');

      if (histDelErr) {
        console.error('Failed to clear real_wingo_30s_history in Supabase:', histDelErr);
        return res.status(500).json({
          success: false,
          error: `Failed to clear real_wingo_30s_history: ${histDelErr.message}`,
        });
      }
      deletedTables.push('public.real_wingo_30s_history');

      // 2. Delete all records from public.wingo_t7_signals
      const { error: t7DelErr } = await client
        .from('wingo_t7_signals')
        .delete()
        .neq('period_id', '');

      if (t7DelErr) {
        console.error('Failed to clear wingo_t7_signals in Supabase:', t7DelErr);
        return res.status(500).json({
          success: false,
          error: `Failed to clear wingo_t7_signals: ${t7DelErr.message}`,
        });
      }
      deletedTables.push('public.wingo_t7_signals');

      // 3. Verify deletion in Supabase
      const { count: histCount, error: countErr } = await client
        .from('real_wingo_30s_history')
        .select('issue_number', { count: 'exact', head: true });

      const { count: t7Count, error: t7CountErr } = await client
        .from('wingo_t7_signals')
        .select('period_id', { count: 'exact', head: true });

      if (!countErr && typeof histCount === 'number' && histCount > 0) {
        return res.status(500).json({
          success: false,
          error: `Verification failed: real_wingo_30s_history still contains ${histCount} records.`,
        });
      }

      if (!t7CountErr && typeof t7Count === 'number' && t7Count > 0) {
        return res.status(500).json({
          success: false,
          error: `Verification failed: wingo_t7_signals still contains ${t7Count} records.`,
        });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({
        success: false,
        error: `Supabase deletion error: ${errMsg}`,
      });
    }
  }

  // 4. Clear server in-memory store
  accumulatedRealHistory = [];
  lastRealFetchTime = 0;
  lastSupabaseSyncTime = null;
  cachedT7Signals.clear();
  lastT7HistoryFetchTime = 0;

  // 5. Notify backend collector if reachable
  const collectorPort = process.env.COLLECTOR_PORT || process.env.PORT || '8080';
  const collectorUrl = process.env.COLLECTOR_URL || `http://127.0.0.1:${collectorPort}/reset`;
  try {
    const cCtrl = new AbortController();
    const cTimeout = setTimeout(() => cCtrl.abort(), 2000);
    await fetch(collectorUrl, { method: 'POST', signal: cCtrl.signal }).catch(() => null);
    clearTimeout(cTimeout);
  } catch {
    // Non-fatal — collector also actively detects empty Supabase table on next poll
  }

  return res.status(200).json({
    success: true,
    message: 'All data reset successfully',
    deletedTables,
    timestamp: new Date().toISOString(),
  });
};

app.post(['/api/real/reset', '/api/reset', '/real/reset', '/reset'], handleResetEndpoint);
app.all('/api/real/reset', handleResetEndpoint);

// GET /api/real/debug-supabase (Diagnostic endpoint for testing Supabase connectivity and schema)
app.get('/api/real/debug-supabase', async (_req, res) => {
  const client = getSupabaseClient();
  const url = getSanitizedSupabaseUrl();
  const jwtRole = getJwtRole();
  const hasKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!client) {
    return res.status(200).json({
      configured: false,
      supabaseUrl: url,
      serviceRoleKeyPresent: hasKey,
      jwtRole,
      error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing from environment variables',
    });
  }

  // Run test on single record
  const sampleRecord: RealCompletedRecord = accumulatedRealHistory[0] || {
    issueNumber: '202603290001',
    periodNumber: '202603290001',
    winningNumber: 5,
    size: 'Big',
    colors: ['green', 'violet'],
    premium: '5',
    sum: 5,
    completedAt: new Date().toISOString(),
    source: 'COMPLETED REAL HISTORY',
  };

  const testResult = await syncRecordsToSupabase([sampleRecord]);

  return res.json({
    configured: true,
    supabaseUrl: url,
    serviceRoleKeyPresent: hasKey,
    jwtRole,
    targetTable: 'public.real_wingo_30s_history',
    conflictTarget: 'game_code,issue_number',
    fieldsExpected: [
      'issue_number',
      'number',
      'color',
      'premium',
      'sum',
      'game_code',
      'source',
      'source_time',
    ],
    testResult,
  });
});

// GET /api/real/history/export?format=csv|json (Requirement 7: CSV/JSON export sorted descending)
app.get('/api/real/history/export', async (req, res) => {
  const format = (req.query.format as string) === 'json' ? 'json' : 'csv';
  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = `wingo30s_real_history_${timestamp}.${format}`;

  let exportRecords: RealCompletedRecord[] = accumulatedRealHistory;
  const client = getSupabaseClient();
  if (client) {
    const { records, error } = await readFromSupabase('all');
    if (!error && records.length > 0) {
      exportRecords = records;
    }
  }

  // Ensure strict numerical descending ordering (Requirement 3, 4, 5, 7)
  const sortedRecords = sortRealRecordsDescending([...exportRecords]);

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(JSON.stringify(sortedRecords, null, 2));
  }

  // CSV format
  const headers = ['Period', 'WinningNumber', 'BigSmall', 'Colors', 'Premium', 'Sum', 'CompletedAt', 'Source'];
  const rows = sortedRecords.map((r) => [
    `"${r.periodNumber}"`,
    r.winningNumber,
    `"${r.size}"`,
    `"${r.colors.join(';')}"`,
    `"${r.premium}"`,
    r.sum,
    `"${r.completedAt || ''}"`,
    `"${r.source}"`,
  ].join(','));

  const csvContent = [headers.join(','), ...rows].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(csvContent);
});

// ─── WingoAI T7 Signals (Historical & Live) ──────────────────────────────────
export interface StoredT7Signal {
  period_id: string;
  signal: 'BIG' | 'SMALL';
  confidence: number | null;
  lucky_number?: number | null;
  fetched_at: string;
  stored_at?: string;
  api_response_ms?: number;
}

// ─── WingoAI T7 Signals (Historical & Live) ──────────────────────────────────
export interface StoredT7Signal {
  period_id: string;
  signal: 'BIG' | 'SMALL';
  confidence: number | null;
  fetched_at: string;
  stored_at: string;
  api_response_ms?: number;
}

// GET /api/real/t7-signals
// Returns WingoAI signals directly from public.wingo_t7_signals (and live collector memory).
// Auth token is NEVER returned or exposed — only period_id, signal, confidence, fetched_at, stored_at.
app.get('/api/real/t7-signals', async (_req, res) => {
  const requestStarted = new Date().toISOString();
  const tReqStart = Date.now();

  // Set strict no-cache headers to guarantee fresh data delivery
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');

  const signalMap = new Map<string, StoredT7Signal>();

  // 1. Read directly from public.wingo_t7_signals in Supabase
  const supabaseClient = getSupabaseClient();
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('wingo_t7_signals')
        .select('period_id, signal, confidence, fetched_at, stored_at')
        .order('period_id', { ascending: false })
        .limit(500);

      if (!error && Array.isArray(data)) {
        for (const row of data) {
          if (row.period_id && (row.signal === 'BIG' || row.signal === 'SMALL')) {
            const pid = String(row.period_id).trim();
            signalMap.set(pid, {
              period_id: pid,
              signal: row.signal as 'BIG' | 'SMALL',
              confidence: row.confidence !== null ? Number(row.confidence) : null,
              fetched_at: row.fetched_at,
              stored_at: row.stored_at,
            });
          }
        }
      } else if (error) {
        console.error('[T7 API] Supabase query error:', error.message);
      }
    } catch (err) {
      console.error('[T7 API] Supabase query exception:', err);
    }
  }

  // 2. Merge live collector in-memory signals if collector is reachable
  let collectorTiming: any = null;
  const collectorPort = process.env.COLLECTOR_PORT || process.env.PORT || '10000';
  const collectorSignalsUrl = process.env.COLLECTOR_URL
    ? process.env.COLLECTOR_URL.replace(/\/reset$/, '/api/real/t7-signals')
    : `http://127.0.0.1:${collectorPort}/api/real/t7-signals`;

  try {
    const cCtrl = new AbortController();
    const cTimeout = setTimeout(() => cCtrl.abort(), 400);
    const cResp = await fetch(collectorSignalsUrl, {
      signal: cCtrl.signal,
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });
    clearTimeout(cTimeout);
    if (cResp.ok) {
      const cJson = await cResp.json();
      if (cJson?.timing) collectorTiming = cJson.timing;
      if (Array.isArray(cJson?.signals)) {
        for (const s of cJson.signals) {
          if (s.period_id && (s.signal === 'BIG' || s.signal === 'SMALL')) {
            const pid = String(s.period_id).trim();
            signalMap.set(pid, {
              period_id: pid,
              signal: s.signal,
              confidence: typeof s.confidence === 'number' ? s.confidence : null,
              fetched_at: s.fetched_at,
              stored_at: s.stored_at,
              api_response_ms: s.api_response_ms,
            });
          }
        }
      }
    }
  } catch {
    // Non-fatal: collector runs as standalone service
  }

  // 3. Sort descending so the newest signal is first
  const allSignals = Array.from(signalMap.values()).sort((a, b) => b.period_id.localeCompare(a.period_id));
  const latest = allSignals[0] || null;

  const responseGenerated = new Date().toISOString();
  const apiLatencyMs = Date.now() - tReqStart;

  const latestFetchedAt = latest?.fetched_at || null;
  const latestStoredAt = latest?.stored_at || null;
  const collectorLatencyMs = latestStoredAt && latestFetchedAt ? Math.max(0, Date.parse(latestStoredAt) - Date.parse(latestFetchedAt)) : 0;
  const apiResponseMs = collectorTiming?.api_response_ms ?? collectorTiming?.collector_latency_ms ?? latest?.api_response_ms ?? collectorLatencyMs;

  // Diagnostic logging matching requirement
  console.log(`[T7 API]\nrequest_started=${requestStarted}\nlatest_period=${latest?.period_id || 'none'}\nlatest_fetched_at=${latestFetchedAt || 'none'}\nlatest_stored_at=${latestStoredAt || 'none'}\nresponse_generated=${responseGenerated}\napi_latency_ms=${apiLatencyMs}`);

  return res.json({
    success: true,
    count: allSignals.length,
    signals: allSignals,
    timing: {
      latest_period: latest?.period_id || null,
      period_id: latest?.period_id || null,
      fetched_at: latestFetchedAt,
      latest_fetched_at: latestFetchedAt,
      stored_at: latestStoredAt,
      latest_stored_at: latestStoredAt,
      collector_latency_ms: collectorTiming?.collector_latency_ms ?? collectorLatencyMs,
      api_response_ms: apiResponseMs,
      api_latency_ms: apiLatencyMs,
      request_started: requestStarted,
      response_generated: responseGenerated,
    },
  });
});

// Health / Monitoring endpoints
app.get(['/health', '/api/health', '/ping'], (_req, res) => {
  res.status(200).json({
    status: 'ok',
    health: 'healthy',
    service: 'Lottery Simulator & Real Proxy API',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// Health / Root info endpoint
app.get('/api', (_req, res) => {
  res.json({
    status: 'online',
    service: 'Lottery Simulator & Real Proxy API',
    endpoints: [
      '/api/real/current',
      '/api/real/history',
      '/api/real/reset',
      '/api/real/t7-signals',
      '/api/real/history/export',
      '/api/test/current-period',
      '/api/test/results',
      '/api/merchant/token',
      '/merchant/api/get_merchant_custom_results.php',
      '/merchant/api/set_merchant_custom_result.php',
    ],
  });
});

// Fallback 404 handler: ensure all unmatched API routes return JSON, never HTML
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Endpoint not found: ${req.method} ${req.originalUrl || req.url}`,
  });
});

export default app;
