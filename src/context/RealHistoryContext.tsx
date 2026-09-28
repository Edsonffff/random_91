import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { RealGameRecord, RealGameSchedule } from '../types/result';
import { realHistoryApiService } from '../services/realHistoryApi';
import { useToast } from './ToastContext';

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
}

const RealHistoryContext = createContext<RealHistoryContextType | undefined>(undefined);

export const RealHistoryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [realHistory, setRealHistory] = useState<RealGameRecord[]>([]);
  const [realSchedule, setRealSchedule] = useState<RealGameSchedule | null>(null);
  const [selectedLimit, setSelectedLimit] = useState<10 | 50 | 100 | 'all'>(10);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const { showToast } = useToast();
  const stateRef = useRef({ selectedLimit, autoRefresh });

  useEffect(() => {
    stateRef.current = { selectedLimit, autoRefresh };
  }, [selectedLimit, autoRefresh]);

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
    setError(null);
    try {
      const limit = stateRef.current.selectedLimit;
      const [historyData, scheduleData] = await Promise.all([
        realHistoryApiService.fetchRealHistory(limit, force),
        realHistoryApiService.fetchRealSchedule().catch(() => null),
      ]);

      if (historyData.success) {
        setRealHistory(historyData.results);
        setLastUpdated(historyData.lastUpdated);
      }
      if (scheduleData && scheduleData.success) {
        setRealSchedule(scheduleData);
      }
      if (force) {
        showToast('Real WinGo 30S history updated successfully.', 'success');
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
