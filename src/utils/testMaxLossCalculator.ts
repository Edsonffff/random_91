/**
 * Pure, independent maximum loss streak calculator for Tests 3, 7, and 9.
 *
 * Rules:
 *  - Each test processes its own evaluated results independently.
 *  - Do NOT combine T3, T7, and T9 data.
 *  - Do NOT use Adaptive Learning.
 *  - Do NOT change the prediction algorithms of T3, T7, or T9.
 *  - Do NOT count unknown / unscored / pending periods as losses.
 *  - Only finalized WIN/LOSS results contribute to streak calculations.
 *  - Results are sorted chronologically ascending by period/issue.
 *  - Missing periods are ignored; they never reset or increment a loss streak.
 */

import { compareIssuesAsc } from '../context/RealHistoryContext';
import { test3Prediction } from '../experimental/test3Sequence';
import {
  evaluateWalkForward,
  type ExperimentalHistoryRecord,
} from '../experimental/periodicLogisticAlgorithm';
import {
  CPL3_CONFIGS,
  runCpl3WalkForward,
  type Cpl3Row,
} from '../experimental/cpl3LossStreakBreaker';

export interface TestStreakMetrics {
  name: 'T3' | 'T7' | 'T9';
  label: string;
  maxLossStreak: number;
  currentLossStreak: number;
  totalEvaluated: number;
  totalHits: number;
  totalMisses: number;
  accuracy: number | null;
  latestPrediction: string | null;
  longestWinStreak: number;
  coverage: 'partial' | 'complete';
  coverageReason: string | null;
  knownThrough: string | null;
  unknownPeriods: number;
}

export interface AllTestMaxLossResults {
  t3: TestStreakMetrics;
  t7: TestStreakMetrics;
  t9: TestStreakMetrics;
  evaluatedAt: string;
}

/**
 * Standard 30-second issue sequencer for WinGo 30S (2880 issues per day).
 */
export function nextPeriod(period: string | null | undefined): string | null {
  if (!period) return null;
  const clean = String(period).trim();
  if (!/^\d{8}10005\d{4}$/.test(clean)) {
    try {
      return String(BigInt(clean) + 1n);
    } catch {
      return null;
    }
  }
  if (Number(clean.slice(-4)) < 2880) {
    return String(BigInt(clean) + 1n);
  }
  const date = new Date(`${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return `${date.toISOString().slice(0, 10).replaceAll('-', '')}100050001`;
}

function validNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 9;
}

function isFinalized(row: { status?: string; finalized?: boolean }): boolean {
  return row.finalized !== false && !['pending', 'unknown', 'unfinalized', 'skipped'].includes(String(row.status ?? '').toLowerCase());
}

function isFinalizedT7(
  signal: { signal?: string; status?: string; actual_number?: number | null; settled_at?: string | null } | undefined,
  record: { number: number },
): boolean {
  if (!signal || !['BIG', 'SMALL'].includes(signal.signal ?? '')) return false;
  if (signal.status === undefined || signal.status === null) return true;
  return ['win', 'loss'].includes(String(signal.status).toLowerCase())
    && Boolean(signal.settled_at)
    && (signal.actual_number === undefined || signal.actual_number === null || signal.actual_number === record.number);
}

function coverage(knownThrough: string | null, unknownPeriods: number, periods: string[]) {
  let gaps = 0;
  for (let i = 1; i < periods.length; i++) {
    if (nextPeriod(periods[i - 1]) !== periods[i]) gaps++;
  }
  const reasons = [gaps ? 'historical_gap' : null, unknownPeriods ? 'unknown_or_unscored_periods' : null].filter(Boolean);
  return {
    coverage: reasons.length ? 'partial' as const : 'complete' as const,
    coverageReason: reasons[0] ?? null,
    knownThrough,
    unknownPeriods,
  };
}

/**
 * Test 3: 14-Round Repeating Sequence.
 * Evaluates chronological settled rounds.
 * Missing periods or gaps are ignored and are never counted as losses.
 */
export function calculateT3MaxLoss(
  records: Array<{ period: string; number: number; status?: string; finalized?: boolean }>,
): TestStreakMetrics {
  const rounds = new Map(records.filter((r) => r.period).map((r) => [String(r.period).trim(), r]));
  const periods = [...rounds.keys()].sort(compareIssuesAsc);

  let currentLossStreak = 0;
  let maxLossStreak = 0;
  let hits = 0;
  let misses = 0;
  let unknownPeriods = 0;
  let previousPeriod: string | null = null;
  for (let i = 0; i < periods.length; i++) {
    const period = periods[i];
    const round = rounds.get(period)!;

    if (previousPeriod && nextPeriod(previousPeriod) !== period) currentLossStreak = 0;
    previousPeriod = period;
    if (!isFinalized(round) || !validNumber(round.number)) {
      unknownPeriods++;
      currentLossStreak = 0;
      continue;
    }

    const predictedSize = test3Prediction(i);
    const actualSize = round.number >= 5 ? 'Big' : 'Small';
    const isHit = predictedSize === actualSize;

    if (isHit) {
      hits++;
      currentLossStreak = 0;
    } else {
      misses++;
      currentLossStreak += 1;
      maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
    }
  }

  const total = hits + misses;
  return {
    name: 'T3',
    label: '14-Round Repeating Sequence',
    maxLossStreak,
    currentLossStreak,
    totalEvaluated: total,
    totalHits: hits,
    totalMisses: misses,
    accuracy: total > 0 ? Math.round((hits / total) * 100) : null,
    latestPrediction: test3Prediction(periods.length),
    longestWinStreak: 0,
    ...coverage(periods.at(-1) ?? null, unknownPeriods, periods),
  };
}

/**
 * Test 7: External Signal (WingoAI / bdgtharu.com).
 * Evaluates only periods with a stored, finalized signal ('BIG' or 'SMALL').
 * Periods with no finalized signal or gaps are UNKNOWN — they are ignored and
 * are NEVER losses.
 */
export function calculateT7MaxLoss(
  records: Array<{ period: string; number: number; status?: string; finalized?: boolean }>,
  t7SignalsMap?: Map<string, { signal: 'BIG' | 'SMALL'; [key: string]: any }>,
): TestStreakMetrics {
  const rounds = new Map(records.filter((r) => r.period).map((r) => [String(r.period).trim(), r]));
  const periods = [...rounds.keys()].sort(compareIssuesAsc);

  let currentLossStreak = 0;
  let maxLossStreak = 0;
  let hits = 0;
  let misses = 0;
  let unknownPeriods = 0;
  let previousPeriod: string | null = null;
  for (let i = 0; i < periods.length; i++) {
    const period = periods[i];
    const round = rounds.get(period)!;

    if (previousPeriod && nextPeriod(previousPeriod) !== period) currentLossStreak = 0;
    previousPeriod = period;

    const stored = t7SignalsMap?.get(period);

    // If no signal exists or signal is not finalized BIG/SMALL:
    // This period is UNKNOWN. It does not count as a loss and does not alter
    // the streak made up exclusively of finalized WIN/LOSS results. Unknown
    // results break the current run so losses cannot bridge an unavailable row.
    if (!isFinalized(round) || !validNumber(round.number) || !isFinalizedT7(stored, round)) {
      unknownPeriods++;
      currentLossStreak = 0;
      continue;
    }
    const finalizedSignal = stored!;

    const predictedSize = finalizedSignal.signal === 'BIG' ? 'Big' : 'Small';
    const actualSize = round.number >= 5 ? 'Big' : 'Small';
    const isHit = predictedSize === actualSize;

    if (isHit) {
      hits++;
      currentLossStreak = 0;
    } else {
      misses++;
      currentLossStreak += 1;
      maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
    }

  }
  const total = hits + misses;
  return {
    name: 'T7',
    label: 'External Signal (WingoAI)',
    maxLossStreak,
    currentLossStreak,
    totalEvaluated: total,
    totalHits: hits,
    totalMisses: misses,
    accuracy: total > 0 ? Math.round((hits / total) * 100) : null,
    latestPrediction: null,
    longestWinStreak: 0,
    ...coverage(periods.at(-1) ?? null, unknownPeriods, periods),
  };
}

/**
 * Test 9: CPL-3 Loss-Streak Breaker.
 * Reuses evaluateWalkForward + runCpl3WalkForward + calculateLossStreakMetrics.
 * Gaps, date boundaries, and NO_SIGNAL do not count as losses or reset the
 * streak; only finalized WIN/LOSS outcomes are considered.
 */
export function calculateT9MaxLoss(
  records: Array<{ period: string; number: number; completedAt?: string; status?: string; finalized?: boolean }>,
): TestStreakMetrics {
  const sorted = [...new Map(records.filter((r) => r.period).map((r) => [String(r.period).trim(), r])).values()]
    .sort((a, b) => compareIssuesAsc(a.period, b.period));

  if (sorted.length === 0) {
    return {
      name: 'T9',
      label: 'CPL-3 Loss-Streak Breaker',
      maxLossStreak: 0,
      currentLossStreak: 0,
      totalEvaluated: 0,
      totalHits: 0,
      totalMisses: 0,
      accuracy: null,
      latestPrediction: null,
      longestWinStreak: 0,
      coverage: 'partial', coverageReason: 'No historical periods are available.', knownThrough: null, unknownPeriods: 0,
    };
  }

  const finalized = sorted.filter((r) => isFinalized(r) && validNumber(r.number));
  const test9History: ExperimentalHistoryRecord[] = finalized.map((r) => ({
    issueNumber: r.period,
    winningNumber: r.number,
    sourceTime: r.completedAt ?? null,
    createdAt: r.completedAt ?? null,
  }));

  const test9Cpl1Rows = evaluateWalkForward(test9History);
  const config = CPL3_CONFIGS.find((item) => item.name === 'context-8-cap-3')!;
  const test9Rows: Cpl3Row[] = runCpl3WalkForward(test9Cpl1Rows, config);
  const rowsByPeriod = new Map(test9Rows.map((row) => [row.periodId, row]));
  let maxLossStreak = 0;
  let currentLossStreak = 0;
  let currentWinStreak = 0;
  let longestWinStreak = 0;
  let hits = 0;
  let misses = 0;
  let unknownPeriods = 0;
  let previousPeriod: string | null = null;
  for (const record of sorted) {
    const period = String(record.period).trim();
    const row = rowsByPeriod.get(period);
    if (previousPeriod && nextPeriod(previousPeriod) !== period) currentLossStreak = 0;
    previousPeriod = period;
    if (!row || row.outcome === 'NO_SIGNAL') {
      unknownPeriods++;
      currentLossStreak = 0;
      currentWinStreak = 0;
    } else if (row.outcome === 'LOSS') {
      misses++;
      currentLossStreak++;
      currentWinStreak = 0;
      maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
    } else {
      hits++;
      currentLossStreak = 0;
      currentWinStreak++;
      longestWinStreak = Math.max(longestWinStreak, currentWinStreak);
    }
  }

  return {
    name: 'T9',
    label: 'CPL-3 Loss-Streak Breaker',
    maxLossStreak,
    currentLossStreak,
    totalEvaluated: hits + misses,
    totalHits: hits,
    totalMisses: misses,
    accuracy: hits + misses > 0 ? Math.round((hits / (hits + misses)) * 100) : null,
    latestPrediction: test9Rows.at(-1)?.prediction ?? null,
    ...coverage(sorted.at(-1)?.period ?? null, unknownPeriods, sorted.map((record) => record.period)),
    longestWinStreak,
  };
}

/**
 * Convenience aggregator to calculate all three independent test metrics.
 */
export function calculateAllTestMaxLoss(
  records: Array<{ period: string; number: number; completedAt?: string }>,
  t7SignalsMap?: Map<string, { signal: 'BIG' | 'SMALL'; [key: string]: any }>,
): AllTestMaxLossResults {
  return {
    t3: calculateT3MaxLoss(records),
    t7: calculateT7MaxLoss(records, t7SignalsMap),
    t9: calculateT9MaxLoss(records),
    evaluatedAt: new Date().toISOString(),
  };
}
