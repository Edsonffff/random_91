import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { TestResult, GameOption } from '../types/result';
import { SUPPORTED_GAMES } from '../types/result';
import { resultApiService } from '../services/resultApi';
import { useToast } from './ToastContext';

interface ResultContextType {
  results: TestResult[];
  activeGame: GameOption;
  setActiveGame: (game: GameOption) => void;
  currentPeriod: string;
  nextPeriod: string;
  isLoading: boolean;
  isAutoDrawActive: boolean;
  setIsAutoDrawActive: (active: boolean) => void;
  countdownSeconds: number;
  drawCycleDuration: number;
  setDrawCycleDuration: (seconds: number) => void;
  queuedNextNumber: number | null;
  setQueuedNextNumber: (num: number | null) => void;
  refreshResults: () => Promise<void>;
  generateResult: (
    winningNumber: number,
    periodNumber: string,
    allowReplace?: boolean
  ) => Promise<TestResult | null>;
  deleteResult: (id: string) => Promise<boolean>;
  resetToSeedData: () => Promise<void>;
  generateNextPeriod: () => Promise<void>;
  triggerInstantDraw: () => Promise<void>;
  loadBigMumbaiSample: () => Promise<void>;
  importRawCurlJson: (rawJson: string) => Promise<boolean>;
}

const ResultContext = createContext<ResultContextType | undefined>(undefined);

export const ResultProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [results, setResults] = useState<TestResult[]>([]);
  const [activeGame, setActiveGame] = useState<GameOption>(SUPPORTED_GAMES[0]);
  const [currentPeriod, setCurrentPeriod] = useState<string>('20260928100050466');
  const [nextPeriod, setNextPeriod] = useState<string>('20260928100050467');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Auto-Draw Realtime Engine States
  const [isAutoDrawActive, setIsAutoDrawActive] = useState<boolean>(true);
  const [drawCycleDuration, setDrawCycleDuration] = useState<number>(30); // 30s default
  const [countdownSeconds, setCountdownSeconds] = useState<number>(15); // Start at 15 for quick action
  const [queuedNextNumber, setQueuedNextNumber] = useState<number | null>(null);

  const { showToast } = useToast();

  const fetchPeriodAndResults = useCallback(async (gameCode: string) => {
    setIsLoading(true);
    try {
      const [periodData, resultsData] = await Promise.all([
        resultApiService.getCurrentPeriod(gameCode),
        resultApiService.getResults(gameCode),
      ]);
      setCurrentPeriod(periodData.periodNumber);
      setNextPeriod(periodData.nextPeriodNumber);
      setResults(resultsData);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch test data';
      showToast(message, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchPeriodAndResults(activeGame.code);
  }, [activeGame.code, fetchPeriodAndResults]);

  const refreshResults = async () => {
    await fetchPeriodAndResults(activeGame.code);
  };

  const generateNextPeriod = async () => {
    try {
      const periodData = await resultApiService.getCurrentPeriod(activeGame.code);
      setCurrentPeriod(periodData.periodNumber);
      setNextPeriod(periodData.nextPeriodNumber);
      showToast(`Next period ready: ${periodData.periodNumber}`, 'info');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unable to generate next period';
      showToast(message, 'error');
    }
  };

  const generateResult = async (
    winningNumber: number,
    periodNumber: string,
    allowReplace: boolean = false
  ): Promise<TestResult | null> => {
    try {
      const created = await resultApiService.createTestResult({
        gameCode: activeGame.code,
        periodNumber,
        winningNumber,
        allowReplace,
      });

      showToast(
        allowReplace && created.replaced
          ? `Period ${periodNumber} result replaced.`
          : `Draw landed: Period ${periodNumber} → Number ${winningNumber} (${created.size})`,
        'success'
      );

      // Refresh results list and advance period
      await fetchPeriodAndResults(activeGame.code);
      return created;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unable to create test result.';
      showToast(message, 'error');
      return null;
    }
  };

  const deleteResult = async (id: string): Promise<boolean> => {
    try {
      const success = await resultApiService.deleteTestResult(id);
      if (success) {
        showToast('Test result removed.', 'info');
        await fetchPeriodAndResults(activeGame.code);
      }
      return success;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete test result.';
      showToast(message, 'error');
      return false;
    }
  };

  const resetToSeedData = async () => {
    try {
      await resultApiService.resetSeedData();
      showToast('Reset to default seed data completed.', 'success');
      await fetchPeriodAndResults(activeGame.code);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to reset seed data.';
      showToast(message, 'error');
    }
  };

  const loadBigMumbaiSample = async () => {
    setIsLoading(true);
    try {
      const sampleDraws = [
        { periodNumber: '20260928100050568', winningNumber: 5 },
        { periodNumber: '20260928100050569', winningNumber: 0 },
        { periodNumber: '20260928100050570', winningNumber: 4 },
        { periodNumber: '20260928100050571', winningNumber: 6 },
        { periodNumber: '20260928100050572', winningNumber: 6 },
        { periodNumber: '20260928100050573', winningNumber: 2 },
        { periodNumber: '20260928100050574', winningNumber: 5 },
        { periodNumber: '20260928100050575', winningNumber: 7 },
        { periodNumber: '20260928100050576', winningNumber: 6 },
        { periodNumber: '20260928100050577', winningNumber: 6 },
      ];

      for (const item of sampleDraws) {
        await resultApiService.createTestResult({
          gameCode: activeGame.code,
          periodNumber: item.periodNumber,
          winningNumber: item.winningNumber,
          allowReplace: true,
        });
      }

      setCurrentPeriod('20260928100050578');
      setNextPeriod('20260928100050579');
      await fetchPeriodAndResults(activeGame.code);
      showToast('Synced latest Big Mumbai screen (...568 to ...577)! Next period: ...578', 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to sync Big Mumbai sample.';
      showToast(message, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const importRawCurlJson = async (rawJson: string): Promise<boolean> => {
    setIsLoading(true);
    try {
      const parsed = JSON.parse(rawJson);
      let list: Array<Record<string, unknown>> = [];

      if (Array.isArray(parsed)) {
        list = parsed;
      } else if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        if (obj.data && typeof obj.data === 'object' && Array.isArray((obj.data as Record<string, unknown>).list)) {
          list = (obj.data as Record<string, unknown>).list as Array<Record<string, unknown>>;
        } else if (Array.isArray(obj.list)) {
          list = obj.list as Array<Record<string, unknown>>;
        }
      }

      if (!list || list.length === 0) {
        throw new Error('No items found in JSON. Expected array or object with data.list.');
      }

      const draws: Array<{ periodNumber: string; winningNumber: number }> = [];
      for (const item of list) {
        const period = String(item.issueNumber || item.periodNumber || item.period || '').trim();
        const numVal = item.number !== undefined ? item.number : item.winningNumber;
        const num = typeof numVal === 'number' ? numVal : parseInt(String(numVal), 10);
        if (period && !isNaN(num) && num >= 0 && num <= 9) {
          draws.push({ periodNumber: period, winningNumber: num });
        }
      }

      if (draws.length === 0) {
        throw new Error('Could not find valid issueNumber and number entries.');
      }

      // Sort chronological (oldest to newest)
      draws.sort((a, b) => {
        try {
          const ba = BigInt(a.periodNumber);
          const bb = BigInt(b.periodNumber);
          return ba > bb ? 1 : ba < bb ? -1 : 0;
        } catch {
          return a.periodNumber.localeCompare(b.periodNumber);
        }
      });

      for (const d of draws) {
        await resultApiService.createTestResult({
          gameCode: activeGame.code,
          periodNumber: d.periodNumber,
          winningNumber: d.winningNumber,
          allowReplace: true,
        });
      }

      const highestPeriod = draws[draws.length - 1].periodNumber;
      try {
        const nextP = (BigInt(highestPeriod) + 1n).toString();
        const nextNextP = (BigInt(highestPeriod) + 2n).toString();
        setCurrentPeriod(nextP);
        setNextPeriod(nextNextP);
      } catch {
        // Fallback
      }

      await fetchPeriodAndResults(activeGame.code);
      showToast(`Successfully imported ${draws.length} live draws!`, 'success');
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid JSON format.';
      showToast(message, 'error');
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  // Ref to hold latest state for interval execution
  const stateRef = useRef({
    currentPeriod,
    activeGame,
    queuedNextNumber,
    isAutoDrawActive,
    drawCycleDuration,
  });

  useEffect(() => {
    stateRef.current = {
      currentPeriod,
      activeGame,
      queuedNextNumber,
      isAutoDrawActive,
      drawCycleDuration,
    };
  }, [currentPeriod, activeGame, queuedNextNumber, isAutoDrawActive, drawCycleDuration]);

  // Execute a draw
  const executeDraw = useCallback(async () => {
    const { currentPeriod: period, activeGame: game, queuedNextNumber: queued } = stateRef.current;
    const numberToDrop = queued !== null ? queued : Math.floor(Math.random() * 10);

    try {
      await resultApiService.createTestResult({
        gameCode: game.code,
        periodNumber: period,
        winningNumber: numberToDrop,
        allowReplace: true,
      });

      // Clear queued number
      setQueuedNextNumber(null);

      // Refresh state
      const [periodData, resultsData] = await Promise.all([
        resultApiService.getCurrentPeriod(game.code),
        resultApiService.getResults(game.code),
      ]);
      setCurrentPeriod(periodData.periodNumber);
      setNextPeriod(periodData.nextPeriodNumber);
      setResults(resultsData);
    } catch (err) {
      console.warn('Auto draw execution error', err);
    }
  }, []);

  const triggerInstantDraw = async () => {
    await executeDraw();
    setCountdownSeconds(drawCycleDuration);
  };

  // Realtime Countdown Engine
  useEffect(() => {
    if (!isAutoDrawActive) return;

    const interval = setInterval(() => {
      setCountdownSeconds((prev) => {
        if (prev <= 1) {
          // Trigger draw
          executeDraw();
          return stateRef.current.drawCycleDuration;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isAutoDrawActive, executeDraw]);

  return (
    <ResultContext.Provider
      value={{
        results,
        activeGame,
        setActiveGame,
        currentPeriod,
        nextPeriod,
        isLoading,
        isAutoDrawActive,
        setIsAutoDrawActive,
        countdownSeconds,
        drawCycleDuration,
        setDrawCycleDuration,
        queuedNextNumber,
        setQueuedNextNumber,
        refreshResults,
        generateResult,
        deleteResult,
        resetToSeedData,
        generateNextPeriod,
        triggerInstantDraw,
        loadBigMumbaiSample,
        importRawCurlJson,
      }}
    >
      {children}
    </ResultContext.Provider>
  );
};

export function useResults(): ResultContextType {
  const context = useContext(ResultContext);
  if (!context) {
    throw new Error('useResults must be used within a ResultProvider');
  }
  return context;
}
