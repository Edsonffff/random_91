import type { RealGameRecord, RealGameSchedule } from '../types/result';

const BASE_URL = 'http://localhost:3000/api/real';

export interface RealHistoryApiResponse {
  success: boolean;
  totalAvailable: number;
  returnedCount: number;
  lastUpdated: string;
  error?: string | null;
  source: 'COMPLETED REAL HISTORY';
  results: RealGameRecord[];
}

export const realHistoryApiService = {
  async fetchRealHistory(
    limit: number | 'all' = 10,
    forceRefresh: boolean = false
  ): Promise<RealHistoryApiResponse> {
    const params = new URLSearchParams();
    if (limit !== undefined) {
      params.set('limit', String(limit));
    }
    if (forceRefresh) {
      params.set('forceRefresh', 'true');
    }

    const response = await fetch(`${BASE_URL}/history?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Proxy error: HTTP ${response.status}`);
    }
    return (await response.json()) as RealHistoryApiResponse;
  },

  async fetchRealSchedule(): Promise<RealGameSchedule> {
    const response = await fetch(`${BASE_URL}/current`);
    if (!response.ok) {
      throw new Error(`Proxy error: HTTP ${response.status}`);
    }
    return (await response.json()) as RealGameSchedule;
  },
};
