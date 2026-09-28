import type { CreateTestResultInput, ResultPeriod, TestResult } from '../types/result';
import { calculateResult } from '../utils/resultRules';
import { generateNextUniquePeriod, incrementPeriodString } from '../utils/periodGenerator';
import { ApiLogger } from './apiLogger';

const STORAGE_KEY = 'lottery_simulator_test_results_v1';

// Seed data requested in Section 22
const SEED_DATA: TestResult[] = [
  {
    id: 'seed-373',
    gameCode: 'WinGo_30S',
    periodNumber: '20260928100050373',
    winningNumber: 0,
    size: 'Small',
    colors: ['red', 'violet'],
    environment: 'test',
    createdAt: new Date(Date.now() - 1000 * 15).toISOString(),
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
    createdAt: new Date(Date.now() - 1000 * 45).toISOString(),
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
    createdAt: new Date(Date.now() - 1000 * 75).toISOString(),
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
    createdAt: new Date(Date.now() - 1000 * 105).toISOString(),
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
    createdAt: new Date(Date.now() - 1000 * 135).toISOString(),
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
    createdAt: new Date(Date.now() - 1000 * 165).toISOString(),
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
    createdAt: new Date(Date.now() - 1000 * 195).toISOString(),
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
    createdAt: new Date(Date.now() - 1000 * 225).toISOString(),
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
    createdAt: new Date(Date.now() - 1000 * 255).toISOString(),
    status: 'TEST',
  },
];

function delay(ms: number = 40): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockResultProvider {
  constructor() {
    this.ensureInitialized();
  }

  private ensureInitialized(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED_DATA));
      }
    } catch {
      // LocalStorage fallback
    }
  }

  private readStorage(): TestResult[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return [...SEED_DATA];
      return JSON.parse(stored);
    } catch {
      return [...SEED_DATA];
    }
  }

  private writeStorage(items: TestResult[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (e) {
      console.warn('Error saving results to localStorage', e);
    }
  }

  async getCurrentPeriod(gameCode: string = 'WinGo_30S'): Promise<ResultPeriod> {
    const startTime = performance.now();
    await delay(35);

    const items = this.readStorage().filter((i) => i.gameCode === gameCode);
    const existingPeriodNumbers = items.map((i) => i.periodNumber);
    const currentPeriodNumber = generateNextUniquePeriod(existingPeriodNumbers);
    const nextPeriodNumber = incrementPeriodString(currentPeriodNumber);

    const result: ResultPeriod = {
      gameCode,
      periodNumber: currentPeriodNumber,
      timestamp: new Date().toISOString(),
      nextPeriodNumber,
      drawIntervalSeconds: gameCode === 'WinGo_30S' ? 30 : 60,
    };

    const duration = Math.round(performance.now() - startTime);
    ApiLogger.log('GET', `/api/test/current-period?gameCode=${gameCode}`, 200, duration, null, result);

    return result;
  }

  async getResults(gameCode?: string, limit?: number): Promise<TestResult[]> {
    const startTime = performance.now();
    await delay(45);

    let items = this.readStorage();
    if (gameCode) {
      items = items.filter((i) => i.gameCode === gameCode);
    }

    items.sort((a, b) => {
      try {
        const bigA = BigInt(a.periodNumber);
        const bigB = BigInt(b.periodNumber);
        if (bigA > bigB) return -1;
        if (bigA < bigB) return 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      } catch {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    });

    if (limit && limit > 0) {
      items = items.slice(0, limit);
    }

    const duration = Math.round(performance.now() - startTime);
    ApiLogger.log(
      'GET',
      `/api/test/results${gameCode ? `?gameCode=${gameCode}` : ''}`,
      200,
      duration,
      null,
      { count: items.length, results: items }
    );

    return items;
  }

  async createTestResult(input: CreateTestResultInput): Promise<TestResult> {
    const startTime = performance.now();
    await delay(55);

    const { gameCode, periodNumber, winningNumber, allowReplace } = input;

    if (winningNumber < 0 || winningNumber > 9 || !Number.isInteger(winningNumber)) {
      const duration = Math.round(performance.now() - startTime);
      const err = 'Winning number must be an integer between 0 and 9.';
      ApiLogger.log('POST', '/api/test/results', 400, duration, input, { error: err });
      throw new Error(err);
    }

    if (!periodNumber || !/^\d+$/.test(periodNumber.trim())) {
      const duration = Math.round(performance.now() - startTime);
      const err = 'Period number must be non-empty and purely numeric.';
      ApiLogger.log('POST', '/api/test/results', 400, duration, input, { error: err });
      throw new Error(err);
    }

    const items = this.readStorage();
    const existingIndex = items.findIndex(
      (i) => i.gameCode === gameCode && i.periodNumber === periodNumber.trim()
    );

    if (existingIndex !== -1 && !allowReplace) {
      const duration = Math.round(performance.now() - startTime);
      const err = `Period ${periodNumber} already exists in test results. Enable 'Replace Existing Test Result' to overwrite.`;
      ApiLogger.log('POST', '/api/test/results', 409, duration, input, { error: err });
      throw new Error(err);
    }

    const calculated = calculateResult(winningNumber);

    const newRecord: TestResult = {
      id: existingIndex !== -1 ? items[existingIndex].id : 'tr_' + Math.random().toString(36).substring(2, 10),
      gameCode,
      periodNumber: periodNumber.trim(),
      winningNumber,
      size: calculated.size,
      colors: calculated.colors,
      environment: 'test',
      createdAt: new Date().toISOString(),
      status: 'TEST',
      replaced: existingIndex !== -1,
    };

    let updatedList: TestResult[];
    if (existingIndex !== -1) {
      updatedList = [...items];
      updatedList[existingIndex] = newRecord;
    } else {
      updatedList = [newRecord, ...items];
    }

    this.writeStorage(updatedList);

    const duration = Math.round(performance.now() - startTime);
    const responsePayload = {
      success: true,
      status: 'TEST',
      result: newRecord,
    };

    ApiLogger.log('POST', '/api/test/results', 201, duration, input, responsePayload);

    return newRecord;
  }

  async deleteTestResult(id: string): Promise<boolean> {
    const startTime = performance.now();
    await delay(35);

    const items = this.readStorage();
    const filtered = items.filter((i) => i.id !== id);
    const existed = filtered.length < items.length;

    if (existed) {
      this.writeStorage(filtered);
    }

    const duration = Math.round(performance.now() - startTime);
    ApiLogger.log(
      'DELETE',
      `/api/test/results/${id}`,
      existed ? 200 : 404,
      duration,
      { id },
      { success: existed }
    );

    return existed;
  }

  async resetSeedData(): Promise<TestResult[]> {
    const startTime = performance.now();
    await delay(50);
    this.writeStorage(SEED_DATA);

    const duration = Math.round(performance.now() - startTime);
    ApiLogger.log('POST', '/api/test/results/reset-seed', 200, duration, null, {
      message: 'Seed data restored',
      count: SEED_DATA.length,
    });

    return [...SEED_DATA];
  }
}
