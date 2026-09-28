import type { ApiLogEntry, HttpMethod } from '../types/api';
import { formatTimeOnly } from '../utils/formatters';

const LOGS_STORAGE_KEY = 'lottery_simulator_api_logs_v1';
const MAX_LOGS = 100;

export class ApiLogger {
  private static listeners: Array<(logs: ApiLogEntry[]) => void> = [];

  static getLogs(): ApiLogEntry[] {
    try {
      const raw = localStorage.getItem(LOGS_STORAGE_KEY);
      if (!raw) return [];
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  static log(
    method: HttpMethod,
    endpoint: string,
    status: number,
    responseTimeMs: number,
    requestPayload?: unknown,
    responsePayload?: unknown,
    error?: string
  ): ApiLogEntry {
    const entry: ApiLogEntry = {
      id: 'log_' + Math.random().toString(36).substring(2, 9),
      timestamp: formatTimeOnly(new Date().toISOString()),
      method,
      endpoint,
      status,
      responseTimeMs,
      environment: 'TEST',
      requestPayload,
      responsePayload,
      error,
    };

    try {
      const current = this.getLogs();
      const updated = [entry, ...current].slice(0, MAX_LOGS);
      localStorage.setItem(LOGS_STORAGE_KEY, JSON.stringify(updated));
      this.notify(updated);
    } catch (e) {
      console.warn('Failed to persist API log entry', e);
    }

    return entry;
  }

  static clearLogs(): void {
    localStorage.removeItem(LOGS_STORAGE_KEY);
    this.notify([]);
  }

  static subscribe(listener: (logs: ApiLogEntry[]) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private static notify(logs: ApiLogEntry[]): void {
    this.listeners.forEach((listener) => {
      try {
        listener(logs);
      } catch (err) {
        console.error('Error notifying log listener', err);
      }
    });
  }
}
