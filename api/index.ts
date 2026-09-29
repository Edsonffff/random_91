import express from 'express';
import cors from 'cors';

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

// GET /api/real/history (Fallback & status endpoint - does NOT proxy upstream to avoid 403)
app.get('/api/real/history', (req, res) => {
  const limitParam = req.query.limit as string;

  let limit = 10;
  if (limitParam === 'all') {
    limit = accumulatedRealHistory.length;
  } else if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (!isNaN(parsed) && parsed > 0) limit = parsed;
  }

  res.json({
    success: true,
    totalAvailable: accumulatedRealHistory.length,
    returnedCount: Math.min(limit, accumulatedRealHistory.length),
    lastUpdated: new Date(lastRealFetchTime || Date.now()).toISOString(),
    error: accumulatedRealHistory.length === 0
      ? 'Vercel server proxy is disabled (upstream blocks datacenter IPs with Cloudflare HTTP 403). Live history is fetched directly from client browser.'
      : null,
    source: 'COMPLETED REAL HISTORY',
    results: accumulatedRealHistory.slice(0, limit),
  });
});

// POST /api/real/history (Sync client-fetched records into server memory if needed)
app.post('/api/real/history', (req, res) => {
  const incoming = Array.isArray(req.body.results) ? req.body.results : [];
  if (incoming.length > 0) {
    const existingMap = new Map<string, RealCompletedRecord>();
    for (const item of accumulatedRealHistory) {
      existingMap.set(item.periodNumber, item);
    }
    for (const item of incoming) {
      if (item && item.issueNumber) {
        const num = Number(item.winningNumber ?? item.number);
        existingMap.set(String(item.issueNumber), {
          issueNumber: String(item.issueNumber),
          periodNumber: String(item.issueNumber),
          winningNumber: isNaN(num) ? 0 : num,
          size: num >= 5 ? 'Big' : 'Small',
          colors: parseRealColors(item.color, num),
          premium: String(item.premium ?? num),
          sum: Number(item.sum ?? 0),
          completedAt: item.completedAt || new Date().toISOString(),
          source: 'COMPLETED REAL HISTORY',
        });
      }
    }

    accumulatedRealHistory = Array.from(existingMap.values()).sort((a, b) => {
      try {
        const ba = BigInt(a.periodNumber);
        const bb = BigInt(b.periodNumber);
        return ba > bb ? -1 : ba < bb ? 1 : 0;
      } catch {
        return b.periodNumber.localeCompare(a.periodNumber);
      }
    });

    if (accumulatedRealHistory.length > 1000) {
      accumulatedRealHistory = accumulatedRealHistory.slice(0, 1000);
    }
    lastRealFetchTime = Date.now();
  }

  res.json({
    success: true,
    totalAvailable: accumulatedRealHistory.length,
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
