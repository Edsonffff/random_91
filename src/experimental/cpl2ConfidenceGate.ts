/**
 * Experimental Test 9 policy layer: CPL-2 Confidence Gate.
 *
 * CPL-1 remains the sole probability generator. This module only converts a
 * CPL-1 probability into BIG, SMALL, or NO_SIGNAL and measures loss streaks.
 */

// `.js` specifiers are required: these modules are consumed both by Vite (which
// resolves extensionless specifiers) and by the Vercel Node runtime, which
// transpiles each file separately and then runs real Node ESM. Node ESM does not
// perform extensionless resolution, so an extensionless specifier here breaks
// module loading for every API route.
import type { ExperimentalSize, WalkForwardRow } from './periodicLogisticAlgorithm.js';
import { compareIssueNumbers, dateFromIssue, positionFromIssue } from './periodicLogisticAlgorithm.js';

export const CPL2_THRESHOLDS = [0.52, 0.54, 0.56, 0.58, 0.60] as const;
export const CPL2_MINIMUM_COVERAGE = 0.8;

export type Cpl2Threshold = (typeof CPL2_THRESHOLDS)[number];
export type GatedOutcome = 'WIN' | 'LOSS' | 'NO_SIGNAL';

export interface GatedRow extends WalkForwardRow {
  gateVersion: 'CPL-2';
  threshold: Cpl2Threshold;
  gatedPrediction: ExperimentalSize | null;
  gatedOutcome: GatedOutcome;
}

export interface LossStreakMetrics {
  totalPeriods: number;
  coverage: number;
  totalPredictions: number;
  wins: number;
  losses: number;
  accuracy: number | null;
  lossStreakCount: number;
  averageLossStreak: number;
  longestLossStreak: number;
  maximumDrawdown: number;
  noSignalCount: number;
}

export interface ScoredRow {
  periodId: string;
  outcome: GatedOutcome;
}

function startsNewSequence(previous: ScoredRow | null, current: ScoredRow): boolean {
  if (!previous) return true;
  if (dateFromIssue(previous.periodId) !== dateFromIssue(current.periodId)) return true;
  const previousPosition = positionFromIssue(previous.periodId);
  const currentPosition = positionFromIssue(current.periodId);
  return previousPosition !== null && currentPosition !== null && currentPosition !== previousPosition + 1;
}

export function applyCpl2Gate(row: WalkForwardRow, threshold: Cpl2Threshold): GatedRow {
  if (!CPL2_THRESHOLDS.includes(threshold)) throw new Error('Unsupported CPL-2 threshold');
  const probability = row.probabilityBig;
  if (probability !== null && (!Number.isFinite(probability) || probability < 0 || probability > 1)) {
    throw new Error('Invalid CPL-1 probability');
  }
  let gatedPrediction: ExperimentalSize | null = null;
  if (probability !== null) {
    if (probability >= threshold) gatedPrediction = 'BIG';
    else if (probability <= 1 - threshold) gatedPrediction = 'SMALL';
  }

  const gatedOutcome: GatedOutcome = gatedPrediction === null
    ? 'NO_SIGNAL'
    : gatedPrediction === row.actualSize
    ? 'WIN'
    : 'LOSS';

  return {
    ...row,
    gateVersion: 'CPL-2',
    threshold,
    gatedPrediction,
    gatedOutcome,
  };
}

export function applyCpl2Threshold(rows: WalkForwardRow[], threshold: Cpl2Threshold): GatedRow[] {
  return rows
    .map((row) => applyCpl2Gate(row, threshold))
    .sort((a, b) => compareIssueNumbers(a.periodId, b.periodId));
}

export function calculateLossStreakMetrics(rows: ScoredRow[]): LossStreakMetrics {
  const sorted = [...rows].sort((a, b) => compareIssueNumbers(a.periodId, b.periodId));
  let wins = 0;
  let losses = 0;
  let noSignalCount = 0;
  let lossStreakCount = 0;
  let currentLossStreak = 0;
  let equity = 0;
  let peak = 0;
  let maximumDrawdown = 0;
  const lossStreakLengths: number[] = [];
  let previous: ScoredRow | null = null;

  const closeLossStreak = () => {
    if (currentLossStreak > 0) lossStreakLengths.push(currentLossStreak);
    currentLossStreak = 0;
  };

  for (const row of sorted) {
    if (startsNewSequence(previous, row)) {
      closeLossStreak();
    }
    // Worst within-date drawdown: gaps and abstentions do not erase losses.
    if (previous && dateFromIssue(previous.periodId) !== dateFromIssue(row.periodId)) {
      equity = 0;
      peak = 0;
    }

    if (row.outcome === 'NO_SIGNAL') {
      noSignalCount += 1;
      closeLossStreak();
    } else if (row.outcome === 'WIN') {
      wins += 1;
      equity += 1;
      closeLossStreak();
    } else {
      losses += 1;
      equity -= 1;
      if (currentLossStreak === 0) lossStreakCount += 1;
      currentLossStreak += 1;
    }

    peak = Math.max(peak, equity);
    maximumDrawdown = Math.max(maximumDrawdown, peak - equity);
    previous = row;
  }
  closeLossStreak();

  const totalPredictions = wins + losses;
  return {
    totalPeriods: sorted.length,
    coverage: sorted.length > 0 ? totalPredictions / sorted.length : 0,
    totalPredictions,
    wins,
    losses,
    accuracy: totalPredictions > 0 ? wins / totalPredictions : null,
    lossStreakCount,
    averageLossStreak: lossStreakLengths.length > 0
      ? lossStreakLengths.reduce((sum, length) => sum + length, 0) / lossStreakLengths.length
      : 0,
    longestLossStreak: lossStreakLengths.length > 0 ? Math.max(...lossStreakLengths) : 0,
    maximumDrawdown,
    noSignalCount,
  };
}

export function measureCpl2(rows: WalkForwardRow[], threshold: Cpl2Threshold): LossStreakMetrics {
  return calculateLossStreakMetrics(applyCpl2Threshold(rows, threshold).map((row) => ({
    periodId: row.periodId,
    outcome: row.gatedOutcome,
  })));
}

/** Coverage is a feasibility constraint, not a score. */
export function compareLossObjectives(a: LossStreakMetrics, b: LossStreakMetrics): number {
  return a.lossStreakCount - b.lossStreakCount ||
    a.longestLossStreak - b.longestLossStreak ||
    a.averageLossStreak - b.averageLossStreak ||
    a.maximumDrawdown - b.maximumDrawdown ||
    (b.accuracy ?? -1) - (a.accuracy ?? -1);
}

export function selectCpl2Threshold(
  validationMetrics: Array<{ threshold: Cpl2Threshold; metrics: LossStreakMetrics }>,
): { threshold: Cpl2Threshold; metrics: LossStreakMetrics } | null {
  const eligible = validationMetrics.filter((candidate) => candidate.metrics.coverage >= CPL2_MINIMUM_COVERAGE);
  if (eligible.length === 0) {
    return null;
  }

  return [...eligible].sort((left, right) => {
    return compareLossObjectives(left.metrics, right.metrics) || left.threshold - right.threshold;
  })[0];
}
