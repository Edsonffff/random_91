import type { ResultProvider } from './resultApi';
import type { CreateTestResultInput, ResultPeriod, TestResult } from '../types/result';
import { calculateResult } from '../utils/resultRules';
import { ApiLogger } from './apiLogger';

/**
 * SaaS Imperial Sandbox API Adapter.
 * Connects to an authorized sandbox proxy / test server using the documented endpoints:
 * - POST /merchant/api/set_merchant_custom_result.php
 * - GET  /merchant/api/get_merchant_custom_results.php?game={game_code}
 * - GET  /api/test/current-period
 */
export class SaaSImperialSandboxProvider implements ResultProvider {
  private baseUrl: string;

  constructor(baseUrl: string = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async getCurrentPeriod(gameCode: string = 'WinGo_30S'): Promise<ResultPeriod> {
    const startTime = performance.now();
    const endpoint = `/api/test/current-period?game_code=${encodeURIComponent(gameCode)}`;
    const url = `${this.baseUrl}${endpoint}`;

    try {
      const response = await fetch(url);
      const data = await response.json();
      const duration = Math.round(performance.now() - startTime);

      ApiLogger.log('GET', endpoint, response.status, duration, null, data);

      return {
        gameCode: data.game_code || gameCode,
        periodNumber: data.period_number,
        timestamp: data.timestamp || new Date().toISOString(),
        nextPeriodNumber: data.next_period_number,
        drawIntervalSeconds: data.draw_interval_seconds || 30,
      };
    } catch (err: unknown) {
      const duration = Math.round(performance.now() - startTime);
      const msg = err instanceof Error ? err.message : 'Network error';
      ApiLogger.log('GET', endpoint, 500, duration, null, { error: msg });
      throw err;
    }
  }

  async getResults(gameCode?: string, limit: number = 20): Promise<TestResult[]> {
    const startTime = performance.now();
    const query = new URLSearchParams();
    if (gameCode) query.append('game', gameCode);
    if (limit) query.append('limit', String(limit));

    const endpoint = `/merchant/api/get_merchant_custom_results.php?${query.toString()}`;
    const url = `${this.baseUrl}${endpoint}`;

    try {
      const response = await fetch(url);
      const data = await response.json();
      const duration = Math.round(performance.now() - startTime);

      ApiLogger.log('GET', endpoint, response.status, duration, null, data);

      if (!data.results || !Array.isArray(data.results)) {
        return [];
      }

      return data.results.map((r: {
        id: string;
        game_code: string;
        period_number: string;
        winning_number: number;
        size?: 'Big' | 'Small';
        colors?: ('red' | 'green' | 'violet')[];
        created_at?: string;
        status?: string;
      }) => {
        const calculated = calculateResult(Number(r.winning_number));
        return {
          id: r.id || `res_${r.period_number}`,
          gameCode: r.game_code,
          periodNumber: String(r.period_number),
          winningNumber: Number(r.winning_number),
          size: r.size || calculated.size,
          colors: r.colors || calculated.colors,
          environment: 'sandbox' as const,
          createdAt: r.created_at || new Date().toISOString(),
          status: 'TEST' as const,
        };
      });
    } catch (err: unknown) {
      const duration = Math.round(performance.now() - startTime);
      const msg = err instanceof Error ? err.message : 'Failed to fetch custom results';
      ApiLogger.log('GET', endpoint, 500, duration, null, { error: msg });
      throw err;
    }
  }

  async createTestResult(input: CreateTestResultInput): Promise<TestResult> {
    const startTime = performance.now();
    const endpoint = '/merchant/api/set_merchant_custom_result.php';
    const url = `${this.baseUrl}${endpoint}`;

    const payload = {
      game_code: input.gameCode,
      period_number: input.periodNumber,
      winning_number: input.winningNumber,
      allow_replace: input.allowReplace ? '1' : '0',
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      const duration = Math.round(performance.now() - startTime);

      ApiLogger.log('POST', endpoint, response.status, duration, payload, data);

      if (!response.ok) {
        throw new Error(data.message || `API error (${response.status})`);
      }

      const calculated = calculateResult(input.winningNumber);
      return {
        id: data.data?.id || `tr_${Date.now()}`,
        gameCode: input.gameCode,
        periodNumber: input.periodNumber,
        winningNumber: input.winningNumber,
        size: calculated.size,
        colors: calculated.colors,
        environment: 'sandbox',
        createdAt: data.data?.timestamp || new Date().toISOString(),
        status: 'TEST',
        replaced: input.allowReplace,
      };
    } catch (err: unknown) {
      const duration = Math.round(performance.now() - startTime);
      const msg = err instanceof Error ? err.message : 'Error setting custom result';
      ApiLogger.log('POST', endpoint, 500, duration, payload, { error: msg });
      throw err;
    }
  }

  async deleteTestResult(id: string): Promise<boolean> {
    const startTime = performance.now();
    const endpoint = `/api/test/results/${id}`;
    const url = `${this.baseUrl}${endpoint}`;

    try {
      const response = await fetch(url, { method: 'DELETE' });
      const data = await response.json();
      const duration = Math.round(performance.now() - startTime);

      ApiLogger.log('DELETE', endpoint, response.status, duration, { id }, data);
      return response.ok;
    } catch {
      return false;
    }
  }

  async resetSeedData(): Promise<TestResult[]> {
    return [];
  }
}
