/**
 * Experimental Test 9 policy layer: CPL-3 Loss-Streak Breaker.
 *
 * CPL-1 remains unchanged and supplies the base probability. CPL-3 always
 * chooses BIG/SMALL whenever CPL-1 has a signal. The policy uses only prior
 * CPL-3 outcomes and prior same-date context counts; it never abstains to make
 * loss-streak metrics look better.
 */

import type { ExperimentalSize, WalkForwardRow } from './periodicLogisticAlgorithm';
import {
  compareIssueNumbers,
  dateFromIssue,
  positionFromIssue,
} from './periodicLogisticAlgorithm';
import type { LossStreakMetrics, ScoredRow } from './cpl2ConfidenceGate';
import { calculateLossStreakMetrics } from './cpl2ConfidenceGate';

export const CPL3_MINIMUM_COVERAGE = 0.8;
export const CPL3_CONFIGS = [
  { name: 'context-1-cap-2', minimumSupport: 1, streakCap: 2 },
  { name: 'context-3-cap-2', minimumSupport: 3, streakCap: 2 },
  { name: 'context-5-cap-3', minimumSupport: 5, streakCap: 3 },
  { name: 'context-8-cap-3', minimumSupport: 8, streakCap: 3 },
] as const;

export type Cpl3Config = (typeof CPL3_CONFIGS)[number];

export interface Cpl3Row extends ScoredRow {
  basePrediction: ExperimentalSize | null;
  baseProbabilityBig: number | null;
  prediction: ExperimentalSize | null;
  priorLossStreak: number;
  contextKey: string | null;
  usedFallbackContext: boolean;
  noSignal: boolean;
}

interface ContextStats {
  big: number;
  small: number;
}

function sizeOfPrediction(row: WalkForwardRow): ExperimentalSize | null {
  return row.prediction;
}

function sequenceBreak(previous: Cpl3Row | null, current: WalkForwardRow): boolean {
  if (!previous) return true;
  if (dateFromIssue(previous.periodId) !== dateFromIssue(current.periodId)) return true;
  const previousPosition = positionFromIssue(previous.periodId);
  const currentPosition = positionFromIssue(current.periodId);
  return previousPosition !== null && currentPosition !== null && currentPosition !== previousPosition + 1;
}

function contextKey(
  basePrediction: ExperimentalSize,
  priorLossStreak: number,
  previousActual: ExperimentalSize | null,
  config: Cpl3Config,
): string {
  const streakBucket = Math.min(priorLossStreak, config.streakCap);
  return `${basePrediction}|L${streakBucket}|A${previousActual ?? 'NONE'}`;
}

function updateStats(stats: Map<string, ContextStats>, key: string, actual: ExperimentalSize): void {
  const current = stats.get(key) ?? { big: 0, small: 0 };
  if (actual === 'BIG') current.big += 1;
  else current.small += 1;
  stats.set(key, current);
}

function total(stats: ContextStats | undefined): number {
  return stats ? stats.big + stats.small : 0;
}

function contextCandidates(
  basePrediction: ExperimentalSize,
  priorLossStreak: number,
  previousActual: ExperimentalSize | null,
  config: Cpl3Config,
): string[] {
  const streakBucket = Math.min(priorLossStreak, config.streakCap);
  return [
    contextKey(basePrediction, priorLossStreak, previousActual, config),
    `${basePrediction}|L${streakBucket}|AANY`,
    `ANY|L${streakBucket}|A${previousActual ?? 'NONE'}`,
    `ANY|L${streakBucket}|AANY`,
    'GLOBAL',
  ];
}

function choosePrediction(
  basePrediction: ExperimentalSize,
  priorLossStreak: number,
  previousActual: ExperimentalSize | null,
  stats: Map<string, ContextStats>,
  config: Cpl3Config,
): { prediction: ExperimentalSize; key: string; usedFallbackContext: boolean } {
  const candidates = contextCandidates(basePrediction, priorLossStreak, previousActual, config);
  let selectedKey = 'GLOBAL';
  let selectedStats = stats.get('GLOBAL');
  for (const candidate of candidates) {
    const candidateStats = stats.get(candidate);
    if (total(candidateStats) >= config.minimumSupport) {
      selectedKey = candidate;
      selectedStats = candidateStats;
      break;
    }
  }

  if (!selectedStats || total(selectedStats) === 0) {
    return { prediction: basePrediction, key: selectedKey, usedFallbackContext: true };
  }

  const probabilityBig = (selectedStats.big + 1) / (total(selectedStats) + 2);
  // The policy chooses the lower estimated immediate loss risk. This is used
  // to avoid starting/extending a loss streak, not to tune accuracy metrics.
  const prediction = probabilityBig > 0.5
    ? 'BIG'
    : probabilityBig < 0.5
    ? 'SMALL'
    : basePrediction;
  return {
    prediction,
    key: selectedKey,
    usedFallbackContext: selectedKey !== candidates[0],
  };
}

export function runCpl3WalkForward(rows: WalkForwardRow[], config: Cpl3Config): Cpl3Row[] {
  const sorted = [...rows].sort((a, b) => compareIssueNumbers(a.periodId, b.periodId));
  const stats = new Map<string, ContextStats>();
  const output: Cpl3Row[] = [];
  let previous: Cpl3Row | null = null;
  let priorLossStreak = 0;
  let previousActual: ExperimentalSize | null = null;

  for (const row of sorted) {
    const dateChanged = previous && dateFromIssue(previous.periodId) !== dateFromIssue(row.periodId);
    if (dateChanged) stats.clear();
    if (sequenceBreak(previous, row)) {
      priorLossStreak = 0;
      previousActual = null;
    }

    const basePrediction = sizeOfPrediction(row);
    if (basePrediction === null || row.probabilityBig === null) {
      const noSignalRow: Cpl3Row = {
        periodId: row.periodId,
        outcome: 'NO_SIGNAL',
        basePrediction: null,
        baseProbabilityBig: null,
        prediction: null,
        priorLossStreak,
        contextKey: null,
        usedFallbackContext: false,
        noSignal: true,
      };
      output.push(noSignalRow);
      priorLossStreak = 0;
      previousActual = null;
      previous = noSignalRow;
      continue;
    }

    const choice = choosePrediction(basePrediction, priorLossStreak, previousActual, stats, config);
    const outcome = choice.prediction === row.actualSize ? 'WIN' : 'LOSS';
    const cpl3Row: Cpl3Row = {
      periodId: row.periodId,
      outcome,
      basePrediction,
      baseProbabilityBig: row.probabilityBig,
      prediction: choice.prediction,
      priorLossStreak,
      contextKey: choice.key,
      usedFallbackContext: choice.usedFallbackContext,
      noSignal: false,
    };
    output.push(cpl3Row);

    const actual = row.actualSize;
    updateStats(stats, 'GLOBAL', actual);
    const exactKey = contextKey(basePrediction, priorLossStreak, previousActual, config);
    updateStats(stats, exactKey, actual);
    const streakBucket = Math.min(priorLossStreak, config.streakCap);
    updateStats(stats, `${basePrediction}|L${streakBucket}|AANY`, actual);
    updateStats(stats, `ANY|L${streakBucket}|A${previousActual ?? 'NONE'}`, actual);
    updateStats(stats, `ANY|L${streakBucket}|AANY`, actual);

    if (outcome === 'LOSS') priorLossStreak += 1;
    else priorLossStreak = 0;
    previousActual = actual;
    previous = cpl3Row;
  }
  return output;
}

export function cpl3Metrics(rows: Cpl3Row[]): LossStreakMetrics {
  return calculateLossStreakMetrics(rows);
}

export function compareCpl3Objectives(a: LossStreakMetrics, b: LossStreakMetrics): number {
  return a.longestLossStreak - b.longestLossStreak ||
    a.lossStreakCount - b.lossStreakCount ||
    a.averageLossStreak - b.averageLossStreak ||
    a.maximumDrawdown - b.maximumDrawdown;
}

export function selectCpl3Config(
  candidates: Array<{ config: Cpl3Config; metrics: LossStreakMetrics }>,
): { config: Cpl3Config; metrics: LossStreakMetrics } | null {
  const eligible = candidates.filter((candidate) => candidate.metrics.coverage >= CPL3_MINIMUM_COVERAGE);
  if (eligible.length === 0) return null;
  return [...eligible].sort((left, right) => {
    return compareCpl3Objectives(left.metrics, right.metrics) ||
      left.config.name.localeCompare(right.config.name);
  })[0];
}
