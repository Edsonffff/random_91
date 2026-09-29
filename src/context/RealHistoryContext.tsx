import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { RealGameRecord, RealGameSchedule } from '../types/result';
import {
  realHistoryApiService,
  parseOfficialColors,
  type BrowserFetchHistoryResult,
} from '../services/realHistoryApi';
import { useToast } from './ToastContext';

const REAL_HISTORY_STORAGE_KEY = 'wingo_real_history_cache_v1';

export interface RealHistoryPagination {
  pageNo: number;
  totalPage: number;
  totalCount: number;
}

export type ConnectionMode = 'browser-direct' | 'server-fallback' | 'imported' | 'cached' | 'idle';

export interface RealHistoryContextType {
  realHistory: RealGameRecord[];
  realSchedule: RealGameSchedule | null;
  selectedLimit: 10 | 50 | 100 | 'all';
  setSelectedLimit: (limit: 10 | 50 | 100 | 'all') => void;
  autoRefresh: boolean;
  setAutoRefresh: (val: boolean) => void;
  lastUpdated: string | null;
  isLoading: boolean;
  error: string | null;
  pagination: RealHistoryPagination | null;
  connectionMode: ConnectionMode;
  refreshRealResults: (force?: boolean) => Promise<void>;
  refreshSchedule: () => Promise<void>;
  importRealHistoryCurlJson: (rawJsonText: string) => boolean;
}

const RealHistoryContext = createContext<RealHistoryContextType | undefined>(undefined);

/**
 * Deduplicate records strictly by issueNumber and sort newest first.
 */
function mergeAndDeduplicate(existing: RealGameRecord[], incoming: RealGameRecord[]): RealGameRecord[] {
  const map = new Map<string, RealGameRecord>();
  for (const r of existing) {
    if (r.issueNumber) {
      map.set(r.issueNumber, r);
    }
  }
  for (const r of incoming) {
    if (r.issueNumber) {
      map.set(r.issueNumber, r);
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    try {
      const diff = BigInt(b.issueNumber) - BigInt(a.issueNumber);
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    } catch {
      return b.issueNumber.localeCompare(a.issueNumber);
    }
  });
}

export const RealHistoryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [realHistory, setRealHistory] = useState<RealGameRecord[]>(() => {
    try {
      const stored = localStorage.getItem(REAL_HISTORY_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [realSchedule, setRealSchedule] = useState<RealGameSchedule | null>(null);
  const [selectedLimit, setSelectedLimit] = useState<10 | 50 | 100 | 'all'>(10);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState<RealHistoryPagination | null>(null);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>(() =>
    realHistory.length > 0 ? 'cached' : 'idle'
  );

  const { showToast } = useToast();

  const realHistoryRef = useRef(realHistory);
  useEffect(() => {
    realHistoryRef.current = realHistory;
  }, [realHistory]);

  const activeAbortControllerRef = useRef<AbortController | null>(null);

  const refreshSchedule = useCallback(async () => {
    try {
      const schedule = await realHistoryApiService.fetchRealSchedule();
      setRealSchedule(schedule);
    } catch {
      // Non-blocking
    }
  }, []);

  const refreshRealResults = useCallback(
    async (force: boolean = false) => {
      // Abort previous running request if a new refresh starts
      if (activeAbortControllerRef.current) {
        activeAbortControllerRef.current.abort();
        activeAbortControllerRef.current = null;
      }

      const controller = new AbortController();
      activeAbortControllerRef.current = controller;
      setIsLoading(true);

      try {
        // Step 1: Direct browser fetch from the official endpoint
        const directResult: BrowserFetchHistoryResult =
          await realHistoryApiService.fetchOfficialHistoryFromBrowser(controller.signal);

        if (controller.signal.aborted) return;

        // Process successful direct browser records
        if (directResult.records && directResult.records.length > 0) {
          const merged = mergeAndDeduplicate(realHistoryRef.current, directResult.records);
          setRealHistory(merged);
          setPagination({
            pageNo: directResult.pageNo,
            totalPage: directResult.totalPage,
            totalCount: directResult.totalCount,
          });
          setConnectionMode('browser-direct');
          setLastUpdated(new Date().toISOString());
          setError(null);

          try {
            localStorage.setItem(REAL_HISTORY_STORAGE_KEY, JSON.stringify(merged));
          } catch {
            // LocalStorage fallback
          }

          if (force) {
            showToast(
              `Live official history refreshed (${directResult.records.length} draws fetched directly).`,
              'success'
            );
          }
        }

        // Fetch or derive schedule concurrently
        try {
          const sched = await realHistoryApiService.fetchRealSchedule(controller.signal);
          if (!controller.signal.aborted && sched && sched.success) {
            setRealSchedule(sched);
          }
        } catch {
          // Derive schedule from latest settled period if live schedule request fails
          if (directResult.records && directResult.records.length > 0) {
            const latest = directResult.records[0];
            try {
              const currentIssue = (BigInt(latest.issueNumber) + 1n).toString();
              const nextIssue = (BigInt(latest.issueNumber) + 2n).toString();
              setRealSchedule((prev) => ({
                success: true,
                gameCode: 'WinGo_30S',
                intervalMinute: 0.5,
                state: 1,
                currentIssue,
                startTime: Date.now(),
                endTime: Date.now() + 30000,
                remainingSeconds: prev ? prev.remainingSeconds : 25,
                previousIssue: latest.issueNumber,
                nextIssue,
                source: 'CURRENT ISSUE',
                lastUpdated: new Date().toISOString(),
              }));
            } catch {
              // ignore BigInt parsing issues
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          // Request intentionally aborted by a newer refresh
          return;
        }

        const directErrMsg = err instanceof Error ? err.message : 'Unknown direct fetch error';
        console.warn('[RealHistoryContext] Direct browser fetch failed:', directErrMsg);

        // Step 2: Attempt fallback to server /api/real/history endpoint as fallback/status
        let fallbackSucceeded = false;
        try {
          const fallbackData = await realHistoryApiService.fetchRealHistoryFallback(50, force);
          if (!controller.signal.aborted && fallbackData.results && fallbackData.results.length > 0) {
            const merged = mergeAndDeduplicate(realHistoryRef.current, fallbackData.results);
            setRealHistory(merged);
            setConnectionMode('server-fallback');
            setLastUpdated(fallbackData.lastUpdated || new Date().toISOString());
            setError(null);
            fallbackSucceeded = true;
          }
        } catch {
          // Fallback also unavailable
        }

        if (!controller.signal.aborted && !fallbackSucceeded) {
          setError(directErrMsg);
          if (force) {
            showToast(directErrMsg, 'error');
          }
        }
      } finally {
        if (activeAbortControllerRef.current === controller) {
          activeAbortControllerRef.current = null;
          setIsLoading(false);
        }
      }
    },
    [showToast]
  );

  const importRealHistoryCurlJson = useCallback(
    (rawJsonText: string): boolean => {
      try {
        const trimmed = rawJsonText.trim();
        if (!trimmed) {
          showToast('Please paste valid curl response JSON.', 'warning');
          return false;
        }

        const parsedJson = JSON.parse(trimmed) as Record<string, unknown>;
        let list: Array<Record<string, unknown>> | undefined;
        let pageNo = 1;
        let totalPage = 1;
        let totalCount = 0;

        if (Array.isArray(parsedJson)) {
          list = parsedJson;
        } else if (parsedJson.data && typeof parsedJson.data === 'object') {
          const dataObj = parsedJson.data as Record<string, unknown>;
          if (Array.isArray(dataObj.list)) {
            list = dataObj.list as Array<Record<string, unknown>>;
          }
          if (typeof dataObj.pageNo === 'number') pageNo = dataObj.pageNo;
          if (typeof dataObj.totalPage === 'number') totalPage = dataObj.totalPage;
          if (typeof dataObj.totalCount === 'number') totalCount = dataObj.totalCount;
        } else if (Array.isArray(parsedJson.list)) {
          list = parsedJson.list as Array<Record<string, unknown>>;
        }

        if (!list || !Array.isArray(list) || list.length === 0) {
          showToast('No record list found in JSON. Expected {"data": {"list": [...]}}', 'error');
          return false;
        }

        const newRecords: RealGameRecord[] = [];
        for (const item of list) {
          const issue = String(item.issueNumber || item.periodNumber || item.period || '').trim();
          const rawNum = item.number !== undefined ? item.number : item.winningNumber;
          const num = typeof rawNum === 'number' ? rawNum : parseInt(String(rawNum ?? ''), 10);

          if (issue && !isNaN(num) && num >= 0 && num <= 9) {
            newRecords.push({
              issueNumber: issue,
              periodNumber: issue,
              winningNumber: num,
              size: num >= 5 ? 'Big' : 'Small',
              colors: parseOfficialColors(String(item.color || ''), num),
              premium: String(item.premium ?? num),
              sum: typeof item.sum === 'number' ? item.sum : 0,
              completedAt: new Date().toISOString(),
              source: 'COMPLETED REAL HISTORY',
            });
          }
        }

        if (newRecords.length === 0) {
          showToast('Could not find any valid issueNumber and number entries in JSON.', 'error');
          return false;
        }

        // Deduplicate records by issueNumber
        const merged = mergeAndDeduplicate(realHistoryRef.current, newRecords);

        setRealHistory(merged);
        setPagination({
          pageNo,
          totalPage,
          totalCount: totalCount || merged.length,
        });
        setConnectionMode('imported');
        setError(null);
        setLastUpdated(new Date().toISOString());

        try {
          localStorage.setItem(REAL_HISTORY_STORAGE_KEY, JSON.stringify(merged));
        } catch {
          // localStorage fallback
        }

        // Derive active schedule from latest imported record
        const latest = merged[0];
        if (latest) {
          try {
            const current = (BigInt(latest.issueNumber) + 1n).toString();
            const next = (BigInt(latest.issueNumber) + 2n).toString();
            setRealSchedule((prev) => ({
              success: true,
              gameCode: 'WinGo_30S',
              intervalMinute: 0.5,
              state: 1,
              currentIssue: current,
              startTime: Date.now(),
              endTime: Date.now() + 30000,
              remainingSeconds: prev ? prev.remainingSeconds : 25,
              previousIssue: latest.issueNumber,
              nextIssue: next,
              source: 'CURRENT ISSUE',
              lastUpdated: new Date().toISOString(),
            }));
          } catch {
            // ignore BigInt parsing issues
          }
        }

        showToast(`Successfully imported ${newRecords.length} official records!`, 'success');
        return true;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Invalid JSON format';
        showToast(`Failed to parse JSON: ${msg}`, 'error');
        return false;
      }
    },
    [showToast]
  );

  // Initial load
  useEffect(() => {
    refreshRealResults(false);
    return () => {
      if (activeAbortControllerRef.current) {
        activeAbortControllerRef.current.abort();
      }
    };
  }, [refreshRealResults]);

  // Auto-refresh interval (every 8 seconds when active, cancelling overlapping requests)
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      refreshRealResults(false);
    }, 8000);

    return () => {
      clearInterval(interval);
      if (activeAbortControllerRef.current) {
        activeAbortControllerRef.current.abort();
      }
    };
  }, [autoRefresh, refreshRealResults]);

  // Local second-by-second countdown decrement for schedule
  useEffect(() => {
    const timer = setInterval(() => {
      setRealSchedule((prev) => {
        if (!prev) return prev;
        const now = Date.now();
        const diff = Math.max(0, Math.round((prev.endTime - now) / 1000));
        if (diff !== prev.remainingSeconds) {
          return { ...prev, remainingSeconds: diff };
        }
        return prev;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <RealHistoryContext.Provider
      value={{
        realHistory,
        realSchedule,
        selectedLimit,
        setSelectedLimit,
        autoRefresh,
        setAutoRefresh,
        lastUpdated,
        isLoading,
        error,
        pagination,
        connectionMode,
        refreshRealResults,
        refreshSchedule,
        importRealHistoryCurlJson,
      }}
    >
      {children}
    </RealHistoryContext.Provider>
  );
};

export function useRealHistory(): RealHistoryContextType {
  const context = useContext(RealHistoryContext);
  if (!context) {
    throw new Error('useRealHistory must be used within a RealHistoryProvider');
  }
  return context;
}
