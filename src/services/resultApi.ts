import type { CreateTestResultInput, ResultPeriod, TestResult } from '../types/result';

export interface ResultProvider {
  getCurrentPeriod(gameCode?: string): Promise<ResultPeriod>;
  getResults(gameCode?: string, limit?: number): Promise<TestResult[]>;
  createTestResult(input: CreateTestResultInput): Promise<TestResult>;
  deleteTestResult(id: string): Promise<boolean>;
  resetSeedData(): Promise<TestResult[]>;
}

// Global active instance (defaults to MockResultProvider)
import { MockResultProvider } from './mockResultApi';

export const resultApiService: ResultProvider = new MockResultProvider();
