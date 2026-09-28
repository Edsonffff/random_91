import type { RealGameRecord, RealGameSchedule } from '../types/result';
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '').replace(/\/api$/, '');
const BASE_URL = `${API_BASE}/api/real`;

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

    const endpointUrl = `${BASE_URL}/history?${params.toString()}`;
    const response = await fetch(endpointUrl);
    
    console.log(`[RealHistoryApi] GET ${endpointUrl} - HTTP Status: ${response.status} (${response.statusText})`);

    if (!response.ok) {
      throw new Error(`Proxy error: HTTP ${response.status}`);
    }

    const data = (await response.json()) as RealHistoryApiResponse;
    console.log('[RealHistoryApi] /history response shape:', {
      success: data.success,
      totalAvailable: data.totalAvailable,
      returnedCount: data.returnedCount,
      error: data.error,
      resultsCount: data.results?.length ?? 0,
    });

    return data;
  },

  async fetchRealSchedule(): Promise<RealGameSchedule> {
    const endpointUrl = `${BASE_URL}/current`;
    const response = await fetch(endpointUrl);

    console.log(`[RealHistoryApi] GET ${endpointUrl} - HTTP Status: ${response.status} (${response.statusText})`);

    if (!response.ok) {
      throw new Error(`Proxy error: HTTP ${response.status}`);
    }

    const data = (await response.json()) as RealGameSchedule;
    console.log('[RealHistoryApi] /current response shape:', {
      success: (data as unknown as { success?: boolean }).success,
      currentIssue: data.currentIssue,
      previousIssue: data.previousIssue,
      nextIssue: data.nextIssue,
      remainingSeconds: data.remainingSeconds,
    });

    return data;
  },
};
