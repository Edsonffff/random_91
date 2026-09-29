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
  const matchedPath = req.headers['x-matched-path'] as string | undefined;
  const originalPath = forwardedUrl || matchedPath;

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
// Note: Upstream (draw.ar-lottery01.com) blocks cloud datacenter/server IPs
// with HTTP 403 (Cloudflare). Live real history is fetched directly by the browser.
// /api/real/history remains as a fallback and status endpoint.
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

  // 2. Single record insert worked! Now execute batch upsert (Requirement 15)
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
 * Read history from public.real_wingo_30s_history ordered by issue_number descending.
 */
async function readFromSupabase(
  limit: number | 'all' = 50
): Promise<{ records: RealCompletedRecord[]; totalCount: number; error: string | null }> {
  const client = getSupabaseClient();
  if (!client) {
    return { records: [], totalCount: 0, error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured' };
  }

  const limitCount =
    limit === 'all' ? 1000 : Math.min(1000, Math.max(1, typeof limit === 'number' ? limit : 50));

  const { data, count, error } = await client
    .from('real_wingo_30s_history')
    .select('*', { count: 'exact' })
    .eq('game_code', 'WinGo_30S')
    .order('issue_number', { ascending: false })
    .limit(limitCount);

  if (error) {
    console.error('[Supabase Read Error]:', error);
    return { records: [], totalCount: 0, error: error.message };
  }

  const records: RealCompletedRecord[] = (data || []).map((row: any) => {
    const rawNum = row.winning_number !== undefined ? row.winning_number : row.number;
    const num = typeof rawNum === 'number' ? rawNum : parseInt(String(rawNum ?? 0), 10);
    const colorStr = String(row.color || (Array.isArray(row.colors) ? row.colors.join(',') : '') || '');

    return {
      issueNumber: String(row.issue_number),
      periodNumber: String(row.issue_number),
      winningNumber: isNaN(num) ? 0 : num,
      size: (row.size as 'Big' | 'Small') || (num >= 5 ? 'Big' : 'Small'),
      colors: parseRealColors(colorStr, num),
      premium: String(row.premium ?? num),
      sum: typeof row.sum === 'number' ? row.sum : 0,
      completedAt: row.completed_at || row.created_at || new Date().toISOString(),
      source: 'COMPLETED REAL HISTORY',
    };
  });

  return { records, totalCount: count ?? records.length, error: null };
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

// GET /api/real/history (Reads from Supabase with in-memory fallback)
app.get('/api/real/history', async (req, res) => {
  const limitParam = req.query.limit as string;

  let limit: number | 'all' = 50;
  if (limitParam === 'all') {
    limit = 'all';
  } else if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (!isNaN(parsed) && parsed > 0) limit = parsed;
  }

  const supabaseClient = getSupabaseClient();
  if (supabaseClient) {
    const { records, totalCount, error } = await readFromSupabase(limit);
    if (!error && records.length > 0) {
      // Merge into in-memory store as well
      const map = new Map<string, RealCompletedRecord>();
      for (const r of accumulatedRealHistory) map.set(r.issueNumber, r);
      for (const r of records) map.set(r.issueNumber, r);
      accumulatedRealHistory = Array.from(map.values()).sort((a, b) => b.issueNumber.localeCompare(a.issueNumber));
      if (accumulatedRealHistory.length > 1000) accumulatedRealHistory = accumulatedRealHistory.slice(0, 1000);

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

  // Fallback to in-memory store if Supabase is not configured or empty
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
  accumulatedRealHistory = Array.from(memoryMap.values()).sort((a, b) => b.issueNumber.localeCompare(a.issueNumber));
  if (accumulatedRealHistory.length > 1000) accumulatedRealHistory = accumulatedRealHistory.slice(0, 1000);
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

// GET /api/real/history/export?format=csv|json
app.get('/api/real/history/export', (req, res) => {
  const format = (req.query.format as string) === 'json' ? 'json' : 'csv';
  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = `wingo30s_real_history_${timestamp}.${format}`;

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(JSON.stringify(accumulatedRealHistory, null, 2));
  }

  // CSV format
  const headers = ['Period', 'WinningNumber', 'BigSmall', 'Colors', 'Premium', 'Sum', 'CompletedAt', 'Source'];
  const rows = accumulatedRealHistory.map((r) => [
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

// Health / Root info endpoint
app.get('/api', (_req, res) => {
  res.json({
    status: 'online',
    service: 'Lottery Simulator & Real Proxy API',
    endpoints: [
      '/api/real/current',
      '/api/real/history',
      '/api/real/history/export',
      '/api/test/current-period',
      '/api/test/results',
      '/api/merchant/token',
      '/merchant/api/get_merchant_custom_results.php',
      '/merchant/api/set_merchant_custom_result.php',
    ],
  });
});

export default app;
