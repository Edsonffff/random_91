import { useState, useEffect, useMemo } from 'react';
import { useRealHistory } from '../context/RealHistoryContext';
import {
  calculateAllTestMaxLoss,
  type AllTestMaxLossResults,
  type TestStreakMetrics,
} from '../utils/testMaxLossCalculator';
import type { WingoAIT7Signal } from '../components/history/AdditionalSignalsPanel';

const STREAKS_CACHE_KEY = 'wingo_test_streaks_cache_v1';
const T7_SIGNALS_CACHE_KEY = 'wingo_t7_signals_cache_v1';

const DEFAULT_METRIC = (name: 'T3' | 'T7' | 'T9', label: string): TestStreakMetrics => ({
  name,
  label,
  maxLossStreak: 0,
  currentLossStreak: 0,
  totalEvaluated: 0,
  totalHits: 0,
  totalMisses: 0,
  accuracy: null,
  latestPrediction: null,
});

function loadCachedStreaks(): AllTestMaxLossResults | null {
  try {
    const raw = localStorage.getItem(STREAKS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.t3 && parsed?.t7 && parsed?.t9) return parsed;
    return null;
  } catch {
    return null;
  }
}

function loadCachedT7Signals(): Map<string, WingoAIT7Signal> {
  try {
    const raw = localStorage.getItem(T7_SIGNALS_CACHE_KEY);
    if (!raw) return new Map();
    const parsed: WingoAIT7Signal[] = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Map();
    const map = new Map<string, WingoAIT7Signal>();
    for (const s of parsed) {
      if (s?.period_id) map.set(String(s.period_id).trim(), s);
    }
    return map;
  } catch {
    return new Map();
  }
}

export interface UseTestMaxLossStreaksReturn {
  t3: TestStreakMetrics;
  t7: TestStreakMetrics;
  t9: TestStreakMetrics;
  isLoading: boolean;
  evaluatedAt: string | null;
  refetchT7: () => Promise<void>;
}

export function useTestMaxLossStreaks(): UseTestMaxLossStreaksReturn {
  const { realHistory, isLoading: isHistoryLoading } = useRealHistory();
  const [t7SignalsMap, setT7SignalsMap] = useState<Map<string, WingoAIT7Signal>>(() => loadCachedT7Signals());
  const [isT7Loading, setIsT7Loading] = useState(false);

  // Fetch T7 signals from backend collector/api endpoint
  const fetchT7Signals = async (signal?: AbortSignal) => {
    try {
      setIsT7Loading(true);
      const apiBase = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL
        ? import.meta.env.VITE_API_BASE_URL
        : ''
      ).replace(/\/$/, '').replace(/\/api$/, '');

      const resp = await fetch(`${apiBase}/api/real/t7-signals?t=${Date.now()}`, {
        cache: 'no-store',
        signal,
      });

      if (!resp.ok) return;
      const json = await resp.json();
      if (!json.success || !Array.isArray(json.signals)) return;

      const newMap = new Map<string, WingoAIT7Signal>();
      const signalsList: WingoAIT7Signal[] = [];

      for (const s of json.signals) {
        if (s.period_id && (s.signal === 'BIG' || s.signal === 'SMALL')) {
          const pid = String(s.period_id).trim();
          const entry: WingoAIT7Signal = {
            period_id: pid,
            signal: s.signal,
            confidence: typeof s.confidence === 'number' ? s.confidence : null,
            lucky_number: typeof s.lucky_number === 'number' ? s.lucky_number : null,
            fetched_at: s.fetched_at || s.created_at || new Date().toISOString(),
          };
          newMap.set(pid, entry);
          signalsList.push(entry);
        }
      }

      setT7SignalsMap(newMap);
      try {
        localStorage.setItem(T7_SIGNALS_CACHE_KEY, JSON.stringify(signalsList.slice(0, 500)));
      } catch {
        // quota exceeded or SSR
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        // Non-blocking warning
      }
    } finally {
      setIsT7Loading(false);
    }
  };

  // Poll T7 signals every 5 seconds to match collector rounds
  useEffect(() => {
    const controller = new AbortController();
    void fetchT7Signals(controller.signal);
    const interval = setInterval(() => {
      void fetchT7Signals();
    }, 5000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, []);

  // Format real history records for test calculators
  const formattedRecords = useMemo(() => {
    return realHistory.map((r) => ({
      period: r.periodNumber,
      number: r.winningNumber,
      completedAt: r.completedAt,
    }));
  }, [realHistory]);

  // Compute streaks independently for T3, T7, and T9
  const calculatedResults = useMemo(() => {
    if (formattedRecords.length === 0) {
      // Fallback to cached results if available so streaks persist across refreshes
      return loadCachedStreaks();
    }

    const results = calculateAllTestMaxLoss(formattedRecords, t7SignalsMap);

    // Save to localStorage for instant restoration upon refresh/restart
    try {
      localStorage.setItem(STREAKS_CACHE_KEY, JSON.stringify(results));
    } catch {
      // quota exceeded or SSR
    }

    return results;
  }, [formattedRecords, t7SignalsMap]);

  return {
    t3: calculatedResults?.t3 ?? DEFAULT_METRIC('T3', '14-Round Repeating Sequence'),
    t7: calculatedResults?.t7 ?? DEFAULT_METRIC('T7', 'External Signal (WingoAI)'),
    t9: calculatedResults?.t9 ?? DEFAULT_METRIC('T9', 'CPL-3 Loss-Streak Breaker'),
    isLoading: isHistoryLoading || (isT7Loading && !calculatedResults),
    evaluatedAt: calculatedResults?.evaluatedAt ?? null,
    refetchT7: fetchT7Signals,
  };
}
