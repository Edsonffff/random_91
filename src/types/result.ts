export type ResultSize = 'Big' | 'Small';
export type ResultColor = 'green' | 'red' | 'violet';

export interface CalculatedOutcome {
  number: number;
  size: ResultSize;
  colors: ResultColor[];
}

export interface TestResult {
  id: string;
  gameCode: string;
  periodNumber: string;
  winningNumber: number;
  size: ResultSize;
  colors: ResultColor[];
  environment: 'test' | 'sandbox' | 'local';
  createdAt: string;
  status: 'TEST';
  replaced?: boolean;
}

export interface ResultPeriod {
  gameCode: string;
  periodNumber: string;
  timestamp: string;
  nextPeriodNumber: string;
  drawIntervalSeconds: number;
}

export interface CreateTestResultInput {
  gameCode: string;
  periodNumber: string;
  winningNumber: number;
  allowReplace?: boolean;
}

export interface GameOption {
  code: string;
  name: string;
  description: string;
  intervalSeconds: number;
}

export const SUPPORTED_GAMES: GameOption[] = [
  {
    code: 'WinGo_30S',
    name: 'WinGo 30S',
    description: '30-second rapid result test cycle',
    intervalSeconds: 30,
  },
  {
    code: 'WinGo_1M',
    name: 'WinGo 1Min',
    description: '1-minute standard test cycle',
    intervalSeconds: 60,
  },
  {
    code: 'WinGo_3M',
    name: 'WinGo 3Min',
    description: '3-minute mid-duration cycle',
    intervalSeconds: 180,
  },
  {
    code: 'WinGo_5M',
    name: 'WinGo 5Min',
    description: '5-minute extended cycle',
    intervalSeconds: 300,
  },
];

export type DataSourceType = 'CURRENT ISSUE' | 'COMPLETED REAL HISTORY' | 'SIMULATOR DATA';

export interface RealGameRecord {
  issueNumber: string;
  periodNumber: string;
  winningNumber: number;
  size: ResultSize;
  colors: ResultColor[];
  premium: string;
  sum: number;
  completedAt: string;
  source: 'COMPLETED REAL HISTORY';
}

export interface RealGameSchedule {
  success: boolean;
  gameCode: string;
  intervalMinute: number;
  state: number;
  currentIssue: string;
  startTime: number;
  endTime: number;
  remainingSeconds: number;
  previousIssue: string;
  nextIssue: string;
  source: 'CURRENT ISSUE';
  lastUpdated: string;
  error?: string;
}
