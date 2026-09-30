import type { RealGameRecord, RealGameSchedule, ResultColor, ResultSize } from '../types/result';

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL ? import.meta.env.VITE_API_BASE_URL : '').replace(/\/$/, '').replace(/\/api$/, '');
const BASE_URL = `${API_BASE}/api/real`;

export const OFFICIAL_WINGO_HISTORY_URL = 'https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json';
export const OFFICIAL_WINGO_SCHEDULE_URL = 'https://draw.ar-lottery01.com/WinGo/WinGo_30S.json';

export interface OfficialHistoryItem {
  issueNumber?: string;
  number?: string | number;
  color?: string;
  premium?: string | number;
  sum?: number;
}

export interface OfficialHistoryRawResponse {
  data?: {
    list?: OfficialHistoryItem[];
    pageNo?: number;
    totalPage?: number;
    totalCount?: number;
  };
  code?: number;
  msg?: string;
  msgCode?: number;
  serviceTime?: number;
}

export interface BrowserFetchHistoryResult {
  records: RealGameRecord[];
  pageNo: number;
  totalPage: number;
  totalCount: number;
  serviceTime?: number;
}

export interface RealHistoryApiResponse {
  success: boolean;
  totalAvailable: number;
  returnedCount: number;
  lastUpdated: string;
  lastSyncTime?: string | null;
  storage?: string;
  error?: string | null;
  source: 'COMPLETED REAL HISTORY';
  results: RealGameRecord[];
}

export function parseOfficialColors(rawColor: string | undefined, num: number): ResultColor[] {
  if (rawColor) {
    const parts = rawColor.split(',').map((c) => c.trim().toLowerCase());
    const valid = parts.filter((c): c is ResultColor => ['red', 'green', 'violet'].includes(c));
    if (valid.length > 0) return valid;
  }
  if (num === 0) return ['red', 'violet'];
  if (num === 5) return ['green', 'violet'];
  return num % 2 === 0 ? ['red'] : ['green'];
}

export function parseOfficialHistoryData(payload: unknown): BrowserFetchHistoryResult {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Malformed JSON: Response payload is not a valid JSON object.');
  }

  const res = payload as OfficialHistoryRawResponse;
  if (!res.data || typeof res.data !== 'object') {
    throw new Error('Malformed JSON: Missing "data" property in official response.');
  }

  const { list, pageNo = 1, totalPage = 1, totalCount = 0 } = res.data;
  if (!Array.isArray(list)) {
    throw new Error('Malformed JSON: "data.list" is missing or is not an array.');
  }

  if (list.length === 0) {
    throw new Error('Empty data: Official history endpoint returned an empty list (0 records).');
  }

  const rawRecords: RealGameRecord[] = [];
  for (const item of list) {
    const issue = String(item.issueNumber || '').trim();
    const rawNum = item.number;
    const num = typeof rawNum === 'number' ? rawNum : parseInt(String(rawNum ?? ''), 10);

    if (issue && !isNaN(num) && num >= 0 && num <= 9) {
      const size: ResultSize = num >= 5 ? 'Big' : 'Small';
      rawRecords.push({
        issueNumber: issue,
        periodNumber: issue,
        winningNumber: num,
        size,
        colors: parseOfficialColors(item.color, num),
        premium: String(item.premium ?? num),
        sum: typeof item.sum === 'number' ? item.sum : 0,
        completedAt: res.serviceTime ? new Date(res.serviceTime).toISOString() : new Date().toISOString(),
        source: 'COMPLETED REAL HISTORY',
      });
    }
  }

  if (rawRecords.length === 0) {
    throw new Error('Malformed JSON: No valid draw records with issueNumber and winning number found.');
  }

  // Deduplicate records by issueNumber
  const dedupeMap = new Map<string, RealGameRecord>();
  for (const r of rawRecords) {
    dedupeMap.set(r.issueNumber, r);
  }

  // Sort descending by period/issue number
  const sortedRecords = Array.from(dedupeMap.values()).sort((a, b) => {
    try {
      const diff = BigInt(b.issueNumber) - BigInt(a.issueNumber);
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    } catch {
      return b.issueNumber.localeCompare(a.issueNumber);
    }
  });

  return {
    records: sortedRecords,
    pageNo,
    totalPage,
    totalCount,
    serviceTime: res.serviceTime,
  };
}

/**
 * Direct browser-side fetch for the official WinGo 30S history endpoint.
 * GET credentials: omit, Accept: application/json, text/plain, * / *
 */
export async function fetchOfficialHistoryFromBrowser(
  signal?: AbortSignal
): Promise<BrowserFetchHistoryResult> {
  const url = `${OFFICIAL_WINGO_HISTORY_URL}?ts=${Date.now()}`;
  let response: Response;

  try {
    response = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      headers: {
        Accept: 'application/json, text/plain, */*',
      },
      signal,
    });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    const errText = err instanceof Error ? err.message : String(err);
    if (
      errText.toLowerCase().includes('failed to fetch') ||
      errText.toLowerCase().includes('networkerror') ||
      errText.toLowerCase().includes('cors')
    ) {
      throw new Error(
        'CORS / Network Failure: Unable to connect directly to draw.ar-lottery01.com from browser. Ensure connection or use "Import Curl JSON".'
      );
    }
    throw new Error(`Network failure: ${errText}`);
  }

  if (response.status === 403) {
    throw new Error('HTTP 403 Forbidden: Cloudflare denied direct access to official history endpoint.');
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} (${response.statusText}): Official history endpoint returned an error.`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (jsonErr: unknown) {
    const detail = jsonErr instanceof Error ? jsonErr.message : 'Invalid JSON';
    throw new Error(`Malformed JSON: Failed to parse official response (${detail}).`);
  }

  return parseOfficialHistoryData(payload);
}

/**
 * Direct browser-side fetch for the official WinGo 30S active round schedule.
 */
export async function fetchOfficialScheduleFromBrowser(
  signal?: AbortSignal
): Promise<RealGameSchedule> {
  const url = `${OFFICIAL_WINGO_SCHEDULE_URL}?ts=${Date.now()}`;
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'omit',
    headers: {
      Accept: 'application/json, text/plain, */*',
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Schedule HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    gameCode?: string;
    intervalMinute?: number;
    state?: number;
    previous?: { issueNumber?: string; startTime?: number; endTime?: number };
    current?: { issueNumber?: string; startTime?: number; endTime?: number };
    next?: { issueNumber?: string; startTime?: number; endTime?: number };
  };

  const endTime = data.current?.endTime || Date.now() + 30000;
  const remainingSeconds = Math.max(0, Math.round((endTime - Date.now()) / 1000));

  return {
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
  };
}

/**
 * Fallback / status call to existing /api/real/history endpoint.
 */
export async function fetchRealHistoryFallback(
  limit: number | 'all' = 'all',
  forceRefresh: boolean = false
): Promise<RealHistoryApiResponse> {
  const params = new URLSearchParams();
  if (limit !== undefined) {
    params.set('limit', String(limit));
  }
  if (forceRefresh) {
    params.set('forceRefresh', 'true');
  }

  const endpointUrl = `${BASE_URL}/history?${params.toString()}`;
  const response = await fetch(endpointUrl);

  if (!response.ok) {
    throw new Error(`Server fallback HTTP ${response.status}`);
  }

  return (await response.json()) as RealHistoryApiResponse;
}

/**
 * Fallback call to existing /api/real/current endpoint.
 */
export async function fetchRealScheduleFallback(): Promise<RealGameSchedule> {
  const endpointUrl = `${BASE_URL}/current`;
  const response = await fetch(endpointUrl);

  if (!response.ok) {
    throw new Error(`Server schedule fallback HTTP ${response.status}`);
  }

  return (await response.json()) as RealGameSchedule;
}

export interface SupabaseSyncResponse {
  success: boolean;
  upsertedCount: number;
  totalAvailable: number;
  totalTableRows?: number;
  storage?: string;
  lastSyncTime?: string;
  error?: string | null;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
  status?: number | null;
  stage?: string;
  testedPayload?: Record<string, unknown>;
  verifiedRow?: Record<string, unknown>;
}

/**
 * Send real history records to server to upsert into Supabase public.real_wingo_30s_history.
 * Duplicate key: (game_code, issue_number).
 */
export async function syncRealHistoryToSupabase(
  records: RealGameRecord[]
): Promise<SupabaseSyncResponse> {
  const endpointUrl = `${BASE_URL}/sync`;
  try {
    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ records }),
    });

    const data = await response.json();
    if (!response.ok && data.success === undefined) {
      return {
        success: false,
        upsertedCount: 0,
        totalAvailable: 0,
        error: data.message || `Sync HTTP error: ${response.status}`,
        status: response.status,
      };
    }
    return data as SupabaseSyncResponse;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      upsertedCount: 0,
      totalAvailable: 0,
      error: msg,
    };
  }
}

/**
 * Inspect server-side Supabase configuration and trigger single-record test.
 */
export async function debugSupabaseBackend(): Promise<Record<string, unknown>> {
  const endpointUrl = `${BASE_URL}/debug-supabase`;
  const response = await fetch(endpointUrl);
  return await response.json();
}

/**
 * Read persistent real history records from Supabase via server /api/real/history.
 */
export async function fetchRealHistoryFromSupabase(
  limit: number | 'all' = 'all'
): Promise<RealHistoryApiResponse> {
  const params = new URLSearchParams();
  if (limit !== undefined) {
    params.set('limit', String(limit));
  }
  const endpointUrl = `${BASE_URL}/history?${params.toString()}`;
  const response = await fetch(endpointUrl);
  if (!response.ok) {
    throw new Error(`Failed to load Supabase history: HTTP ${response.status}`);
  }
  return (await response.json()) as RealHistoryApiResponse;
}

export const realHistoryApiService = {
  fetchOfficialHistoryFromBrowser,
  fetchOfficialScheduleFromBrowser,
  fetchRealHistoryFallback,
  fetchRealScheduleFallback,
  syncRealHistoryToSupabase,
  debugSupabaseBackend,
  fetchRealHistoryFromSupabase,

  /**
   * Primary fetcher for real history: direct browser fetch with server fallback.
   */
  async fetchRealHistory(
    limit: number | 'all' = 'all',
    forceRefresh: boolean = false,
    signal?: AbortSignal
  ): Promise<RealHistoryApiResponse> {
    try {
      const direct = await fetchOfficialHistoryFromBrowser(signal);
      let slice = direct.records;
      if (limit !== 'all' && typeof limit === 'number') {
        slice = slice.slice(0, limit);
      }
      return {
        success: true,
        totalAvailable: direct.records.length,
        returnedCount: slice.length,
        lastUpdated: new Date().toISOString(),
        error: null,
        source: 'COMPLETED REAL HISTORY',
        results: slice,
      };
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      // If browser direct access fails, try server fallback endpoint
      try {
        const fallback = await fetchRealHistoryFallback(limit, forceRefresh);
        if (fallback.results && fallback.results.length > 0) {
          return fallback;
        }
      } catch {
        // Fallback also failed or returned 0
      }
      throw err;
    }
  },

  /**
   * Primary fetcher for schedule: direct browser fetch with server fallback.
   */
  async fetchRealSchedule(signal?: AbortSignal): Promise<RealGameSchedule> {
    try {
      return await fetchOfficialScheduleFromBrowser(signal);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      return await fetchRealScheduleFallback();
    }
  },
};
