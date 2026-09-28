import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { RealGameRecord, RealGameSchedule } from '../types/result';
import { realHistoryApiService } from '../services/realHistoryApi';
import { useToast } from './ToastContext';

const REAL_HISTORY_STORAGE_KEY = 'wingo_real_history_cache_v1';

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
  refreshRealResults: (force?: boolean) => Promise<void>;
  refreshSchedule: () => Promise<void>;
  importRealHistoryCurlJson: (rawJsonText: string) => boolean;
}

const RealHistoryContext = createContext<RealHistoryContextType | undefined>(undefined);

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

  const { showToast } = useToast();
  const stateRef = useRef({ selectedLimit, autoRefresh, hasRecords: realHistory.length > 0 });

  useEffect(() => {
    stateRef.current = { selectedLimit, autoRefresh, hasRecords: realHistory.length > 0 };
  }, [selectedLimit, autoRefresh, realHistory.length]);

  const refreshSchedule = useCallback(async () => {
    try {
      const schedule = await realHistoryApiService.fetchRealSchedule();
      setRealSchedule(schedule);
    } catch {
      // Schedule fetch failure silent or non-blocking
    }
  }, []);

  const refreshRealResults = useCallback(async (force: boolean = false) => {
    setIsLoading(true);
    try {
      const limit = stateRef.current.selectedLimit;
      const [historyData, scheduleData] = await Promise.all([
        realHistoryApiService.fetchRealHistory(limit, force),
        realHistoryApiService.fetchRealSchedule().catch(() => null),
      ]);

      if (historyData.error) {
        setError(historyData.error);
      } else {
        setError(null);
      }

      if (historyData.success && historyData.results && historyData.results.length > 0) {
        setRealHistory(historyData.results);
        setLastUpdated(historyData.lastUpdated);
        setError(null);
        try {
          localStorage.setItem(REAL_HISTORY_STORAGE_KEY, JSON.stringify(historyData.results));
        } catch {
          // localStorage fallback
        }
      } else if (historyData.results?.length === 0 && historyData.error) {
        // If upstream returned 403 or error with 0 records, do NOT clear existing cached/imported history
        console.warn('[RealHistoryContext] Upstream returned error with 0 records:', historyData.error);
      }

      if (scheduleData && scheduleData.success) {
        setRealSchedule(scheduleData);
      }

      if (force) {
        if (historyData.results && historyData.results.length > 0) {
          showToast(`Real WinGo 30S history updated (${historyData.results.length} records).`, 'success');
        } else if (historyData.error) {
          showToast(`Upstream notice: ${historyData.error}`, 'warning');
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch real WinGo history';
      setError(msg);
      if (force) {
        showToast(`Real history error: ${msg}`, 'error');
      }
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  const importRealHistoryCurlJson = useCallback((rawJsonText: string): boolean => {
    try {
      const trimmed = rawJsonText.trim();
      if (!trimmed) {
        showToast('Please paste valid curl response JSON.', 'warning');
        return false;
      }

      const parsedJson = JSON.parse(trimmed) as Record<string, unknown>;
      let list: Array<Record<string, unknown>> | undefined;

      if (Array.isArray(parsedJson)) {
        list = parsedJson;
      } else if (parsedJson.data && typeof parsedJson.data === 'object') {
        const dataObj = parsedJson.data as Record<string, unknown>;
        if (Array.isArray(dataObj.list)) {
          list = dataObj.list as Array<Record<string, unknown>>;
        }
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
            colors: parseRealColors(String(item.color || ''), num),
            premium: String(item.premium ?? num),
            sum: typeof item.sum === 'number' ? item.sum : num,
            completedAt: new Date().toISOString(),
            source: 'COMPLETED REAL HISTORY',
          });
        }
      }

      if (newRecords.length === 0) {
        showToast('Could not find any valid issueNumber and number entries in JSON.', 'error');
        return false;
      }

      // Merge with existing records without duplicates
      const mergedMap = new Map<string, RealGameRecord>();
      for (const r of realHistory) {
        mergedMap.set(r.periodNumber, r);
      }
      for (const r of newRecords) {
        mergedMap.set(r.periodNumber, r);
      }

      // Sort newest first
      const sorted = Array.from(mergedMap.values()).sort((a, b) => {
        try {
          const ba = BigInt(a.periodNumber);
          const bb = BigInt(b.periodNumber);
          return ba > bb ? -1 : ba < bb ? 1 : 0;
        } catch {
          return b.periodNumber.localeCompare(a.periodNumber);
        }
      });

      setRealHistory(sorted);
      setError(null);
      setLastUpdated(new Date().toISOString());

      try {
        localStorage.setItem(REAL_HISTORY_STORAGE_KEY, JSON.stringify(sorted));
      } catch {
        // localStorage fallback
      }

      // Derive and populate schedule if not already active
      const latest = sorted[0];
      if (latest) {
        try {
          const current = (BigInt(latest.periodNumber) + 1n).toString();
          const next = (BigInt(latest.periodNumber) + 2n).toString();
          setRealSchedule((prev) => ({
            success: true,
            gameCode: 'WinGo_30S',
            intervalMinute: 0.5,
            state: 1,
            currentIssue: current,
            startTime: Date.now(),
            endTime: Date.now() + 30000,
            remainingSeconds: prev ? prev.remainingSeconds : 25,
            previousIssue: latest.periodNumber,
            nextIssue: next,
            source: 'CURRENT ISSUE',
            lastUpdated: new Date().toISOString(),
          }));
        } catch {
          // ignore BigInt parsing issues
        }
      }

      console.log(`[RealHistoryContext] Successfully imported ${newRecords.length} records from curl JSON. Total stored: ${sorted.length}`);
      showToast(`Successfully imported ${newRecords.length} official real records!`, 'success');
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid JSON format';
      showToast(`Failed to parse JSON: ${msg}`, 'error');
      return false;
    }
  }, [realHistory, showToast]);

  // Initial load
  useEffect(() => {
    refreshRealResults(false);
  }, [refreshRealResults, selectedLimit]);

  // Auto-refresh interval (every 8 seconds when active)
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      refreshRealResults(false);
    }, 8000);
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
        isLoading,
        error,
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
