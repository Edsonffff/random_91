import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { RealGameRecord, RealGameSchedule } from '../types/result';
import {
  realHistoryApiService,
  parseOfficialColors,
} from '../services/realHistoryApi';
import { useToast } from './ToastContext';

const REAL_HISTORY_STORAGE_KEY = 'wingo_real_history_cache_v1';

export interface RealHistoryPagination {
  pageNo: number;
  totalPage: number;
  totalCount: number;
}

export type ConnectionMode = 'browser-direct' | 'server-fallback' | 'imported' | 'cached' | 'idle';
export type SupabaseSyncStatus = 'synced' | 'syncing' | 'error' | 'idle';
export interface SupabaseSyncErrorDetails {
  message: string;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
  status?: number | null;
  stage?: string | null;
  testedPayload?: Record<string, unknown> | null;
}

export interface RealHistoryContextType {
  realHistory: RealGameRecord[];
  realSchedule: RealGameSchedule | null;
  selectedLimit: 10 | 50 | 100 | 'all';
  setSelectedLimit: (limit: 10 | 50 | 100 | 'all') => void;
  autoRefresh: boolean;
  setAutoRefresh: (val: boolean) => void;
  lastUpdated: string | null;
  lastSupabaseSyncTime: string | null;
  lastSyncedIssue: string | null;
  supabaseStatus: SupabaseSyncStatus;
  supabaseError: SupabaseSyncErrorDetails | null;
  dismissSupabaseError: () => void;
  totalSupabaseRows: number | null;
  isLoading: boolean;
  error: string | null;
  pagination: RealHistoryPagination | null;
  connectionMode: ConnectionMode;
  refreshRealResults: (force?: boolean) => Promise<void>;
  refreshSchedule: () => Promise<void>;
  syncAllToSupabase: () => Promise<void>;
  testSingleSupabaseSync: () => Promise<void>;
  importRealHistoryCurlJson: (rawJsonText: string) => boolean;
}

const RealHistoryContext = createContext<RealHistoryContextType | undefined>(undefined);

/**
 * Compare two issue numbers numerically descending (e.g. 50501 before 50500).
 * Handles fixed-length and arbitrary text formats safely via BigInt or numeric collation.
 */
export function compareIssuesDesc(issueA: string | undefined, issueB: string | undefined): number {
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

/**
 * Compare two issue numbers numerically ascending (e.g. 50500 before 50501).
 * Handles fixed-length and arbitrary text formats safely via BigInt or numeric collation.
 */
export function compareIssuesAsc(issueA: string | undefined, issueB: string | undefined): number {
  return compareIssuesDesc(issueB, issueA);
}

export function sortRealHistoryDescending(records: RealGameRecord[]): RealGameRecord[] {
  return [...records].sort((a, b) => compareIssuesDesc(a.issueNumber, b.issueNumber));
}

/**
 * Deduplicate records strictly by issueNumber and sort newest first (numerically descending).
 */
export function mergeAndDeduplicate(existing: RealGameRecord[], incoming: RealGameRecord[]): RealGameRecord[] {
  const map = new Map<string, RealGameRecord>();
  for (const r of existing) {
    if (r.issueNumber) {
      map.set(String(r.issueNumber).trim(), r);
    }
  }
  for (const r of incoming) {
    if (r.issueNumber) {
      map.set(String(r.issueNumber).trim(), r);
    }
  }
  return Array.from(map.values()).sort((a, b) => compareIssuesDesc(a.issueNumber, b.issueNumber));
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
  const [lastSupabaseSyncTime, setLastSupabaseSyncTime] = useState<string | null>(null);
  const [lastSyncedIssue, setLastSyncedIssue] = useState<string | null>(null);
  const [supabaseStatus, setSupabaseStatus] = useState<SupabaseSyncStatus>('idle');
  const [supabaseError, setSupabaseError] = useState<SupabaseSyncErrorDetails | null>(null);
  const [totalSupabaseRows, setTotalSupabaseRows] = useState<number | null>(null);
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

  const realScheduleRef = useRef<RealGameSchedule | null>(null);
  useEffect(() => {
    realScheduleRef.current = realSchedule;
  }, [realSchedule]);

  // Tracks all issue numbers confirmed to be persisted in Supabase to avoid duplicate writes (Requirement 3b, 11)
  const syncedIssueNumbersRef = useRef<Set<string>>(new Set());
  // Prevents overlapping polling requests (Requirement 13)
  const isPollingOrSyncingRef = useRef<boolean>(false);

  const dismissSupabaseError = useCallback(() => {
    setSupabaseError(null);
  }, []);

  const refreshSchedule = useCallback(async () => {
    try {
      const schedule = await realHistoryApiService.fetchRealSchedule();
      setRealSchedule(schedule);
      realScheduleRef.current = schedule;
    } catch {
      // Non-blocking
    }
  }, []);

  // Manual "Sync to Supabase" button (Requirement 2)
  const syncAllToSupabase = useCallback(async () => {
    if (realHistoryRef.current.length === 0) {
      showToast('No records available to sync to Supabase.', 'warning');
      return;
    }
    setSupabaseStatus('syncing');
    try {
      const res = await realHistoryApiService.syncRealHistoryToSupabase(realHistoryRef.current);
      if (res.success) {
        for (const r of realHistoryRef.current) {
          syncedIssueNumbersRef.current.add(r.issueNumber);
        }
        if (realHistoryRef.current[0]) {
          setLastSyncedIssue(realHistoryRef.current[0].issueNumber);
        }
        const time = res.lastSyncTime || new Date().toISOString();
        setLastSupabaseSyncTime(time);
        setSupabaseStatus('synced');
        setSupabaseError(null);
        if (typeof res.totalTableRows === 'number') {
          setTotalSupabaseRows(res.totalTableRows);
        }
        showToast(
          `Successfully upserted ${res.upsertedCount} records into Supabase public.real_wingo_30s_history!`,
          'success'
        );
      } else {
        setSupabaseStatus('error');
        setSupabaseError({
          message: res.error || 'Failed to upsert records into Supabase',
          details: res.details,
          hint: res.hint,
          code: res.code,
          status: res.status,
          stage: res.stage,
          testedPayload: res.testedPayload,
        });
        showToast(`Supabase sync warning: ${res.error || 'Failed to upsert records'}`, 'warning');
      }
    } catch (err: unknown) {
      setSupabaseStatus('error');
      const msg = err instanceof Error ? err.message : 'Sync failed';
      setSupabaseError({ message: msg });
      showToast(`Supabase sync failed: ${msg}`, 'error');
    }
  }, [showToast]);

  // Single-record test button
  const testSingleSupabaseSync = useCallback(async () => {
    if (realHistoryRef.current.length === 0) {
      showToast('No records available to test Supabase write.', 'warning');
      return;
    }
    setSupabaseStatus('syncing');
    try {
      const single = [realHistoryRef.current[0]];
      const res = await realHistoryApiService.syncRealHistoryToSupabase(single);
      if (res.success) {
        syncedIssueNumbersRef.current.add(single[0].issueNumber);
        setLastSyncedIssue(single[0].issueNumber);
        const time = res.lastSyncTime || new Date().toISOString();
        setLastSupabaseSyncTime(time);
        setSupabaseStatus('synced');
        setSupabaseError(null);
        if (typeof res.totalTableRows === 'number') {
          setTotalSupabaseRows(res.totalTableRows);
        }
        showToast('Single record test passed! Row verified in Supabase.', 'success');
      } else {
        setSupabaseStatus('error');
        setSupabaseError({
          message: res.error || 'Single record test failed',
          details: res.details,
          hint: res.hint,
          code: res.code,
          status: res.status,
          stage: res.stage,
          testedPayload: res.testedPayload,
        });
        showToast(`Single record test failed: ${res.error}`, 'error');
      }
    } catch (err: unknown) {
      setSupabaseStatus('error');
      const msg = err instanceof Error ? err.message : 'Test failed';
      setSupabaseError({ message: msg });
      showToast(msg, 'error');
    }
  }, [showToast]);

  /**
   * Dashboard synchronization cycle (Read-only from Supabase):
   * Reads latest completed records directly from Supabase via server API.
   * Browser does NOT poll external lottery API; collection is handled 24/7 by backend worker.
   */
  const refreshRealResults = useCallback(
    async (force: boolean = false) => {
      if (isPollingOrSyncingRef.current) {
        return;
      }
      isPollingOrSyncingRef.current = true;
      if (force) setIsLoading(true);

      try {
        const supabaseData = await realHistoryApiService.fetchRealHistoryFromSupabase('all');

        if (supabaseData.results && supabaseData.results.length > 0) {
          const sorted = sortRealHistoryDescending(supabaseData.results);
          for (const r of sorted) {
            syncedIssueNumbersRef.current.add(String(r.issueNumber).trim());
          }

          const latest = sorted[0]?.issueNumber || null;
          setLastSyncedIssue(latest);
          setTotalSupabaseRows(supabaseData.totalAvailable || sorted.length);
          setRealHistory(sorted);
          setPagination({
            pageNo: 1,
            totalPage: 1,
            totalCount: supabaseData.totalAvailable || sorted.length,
          });
          setConnectionMode('server-fallback');
          setLastUpdated(supabaseData.lastUpdated || new Date().toISOString());
          if (supabaseData.lastSyncTime) {
            setLastSupabaseSyncTime(supabaseData.lastSyncTime);
          }
          setSupabaseStatus('synced');
          setSupabaseError(null);
          setError(null);

          // Update active round schedule from the latest completed draw
          try {
            const sched = await realHistoryApiService.fetchRealSchedule();
            if (sched && sched.success) {
              setRealSchedule(sched);
              realScheduleRef.current = sched;
            }
          } catch {
            if (sorted[0]) {
              try {
                const currentIssue = (BigInt(sorted[0].issueNumber) + 1n).toString();
                const nextIssue = (BigInt(sorted[0].issueNumber) + 2n).toString();
                const derivedSched: RealGameSchedule = {
                  success: true,
                  gameCode: 'WinGo_30S',
                  intervalMinute: 0.5,
                  state: 1,
                  currentIssue,
                  startTime: Date.now(),
                  endTime: Date.now() + 30000,
                  remainingSeconds: 25,
                  previousIssue: sorted[0].issueNumber,
                  nextIssue,
                  source: 'CURRENT ISSUE',
                  lastUpdated: new Date().toISOString(),
                };
                setRealSchedule(derivedSched);
                realScheduleRef.current = derivedSched;
              } catch {
                // ignore BigInt parsing issues
              }
            }
          }

          if (force) {
            showToast(
              `Live official history refreshed (${sorted.length} draws loaded from Supabase).`,
              'success'
            );
          }
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : 'Failed to load Supabase history';
        console.warn('[RealHistoryContext] Supabase refresh notice:', errMsg);
        setError(errMsg);
        if (force) {
          showToast(errMsg, 'error');
        }
      } finally {
        isPollingOrSyncingRef.current = false;
        if (force) setIsLoading(false);
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

        // Automatically sync imported records into Supabase!
        realHistoryApiService
          .syncRealHistoryToSupabase(newRecords)
          .then((syncRes) => {
            if (syncRes.success) {
              for (const r of newRecords) {
                syncedIssueNumbersRef.current.add(r.issueNumber);
              }
              if (newRecords[0]) {
                setLastSyncedIssue(newRecords[0].issueNumber);
              }
              setLastSupabaseSyncTime(syncRes.lastSyncTime || new Date().toISOString());
              setSupabaseStatus('synced');
              setSupabaseError(null);
              if (typeof syncRes.totalTableRows === 'number') {
                setTotalSupabaseRows(syncRes.totalTableRows);
              }
            } else if (syncRes.error) {
              console.warn('[Supabase Import Sync Notice]:', syncRes.error, syncRes);
              setSupabaseStatus('error');
              setSupabaseError({
                message: syncRes.error,
                details: syncRes.details,
                hint: syncRes.hint,
                code: syncRes.code,
                status: syncRes.status,
                stage: syncRes.stage,
                testedPayload: syncRes.testedPayload,
              });
            }
          })
          .catch((syncErr) => {
            console.warn('[Supabase Import Sync Warning]:', syncErr);
          });

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

  // Initial load: load persistent history from Supabase
  useEffect(() => {
    let isMounted = true;
    if (isMounted) {
      refreshRealResults(false);
    }
    return () => {
      isMounted = false;
    };
  }, [refreshRealResults]);

  // Requirement 14: Tab visibility change handling (immediately sync when user returns to tab)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && autoRefresh) {
        refreshRealResults(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [autoRefresh, refreshRealResults]);

  // Requirement 3: Auto-refresh interval (polling every 5 seconds for new completed draws)
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      refreshRealResults(false);
    }, 5000);

    return () => clearInterval(interval);
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
        lastSupabaseSyncTime,
        lastSyncedIssue,
        supabaseStatus,
        supabaseError,
        dismissSupabaseError,
        totalSupabaseRows,
        isLoading,
        error,
        pagination,
        connectionMode,
        refreshRealResults,
        refreshSchedule,
        syncAllToSupabase,
        testSingleSupabaseSync,
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
