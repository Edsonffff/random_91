/**
 * Experimental Test 9: Chronological Periodic Logistic (CPL-1).
 *
 * This module intentionally has no dependency on Tests 2, 3, 5, 6, or 7.
 * It uses only the target issue's known sequential position and outcomes from
 * earlier, same-date records. It must never be trained with the target result.
 */

export type ExperimentalSize = 'BIG' | 'SMALL';

export interface ExperimentalHistoryRecord {
  issueNumber: string;
  winningNumber: number;
  sourceTime?: string | null;
  createdAt?: string | null;
}

export interface PeriodicFeature {
  name: string;
  value: number;
}

export interface ExperimentalPrediction {
  periodId: string;
  algorithmVersion: 'CPL-1';
  prediction: ExperimentalSize | null;
  probabilityBig: number | null;
  features: PeriodicFeature[];
  trainingCount: number;
  trainedThroughPeriod: string | null;
  reason?: string;
}

export interface WalkForwardRow extends ExperimentalPrediction {
  date: string;
  actualNumber: number;
  actualSize: ExperimentalSize;
  outcome: 'WIN' | 'LOSS' | 'NO_SIGNAL';
}

export interface PerformanceMetrics {
  totalPredictions: number;
  wins: number;
  losses: number;
  noSignals: number;
  accuracy: number | null;
  longestWinStreak: number;
  longestLossStreak: number;
  maximumDrawdownUnits: number;
}

export const PERIODIC_MODULI = [2, 3, 5, 10, 60] as const;
export const MINIMUM_TRAINING_ROWS = 20;
export const LOGISTIC_ITERATIONS = 120;
export const LOGISTIC_LEARNING_RATE = 0.2;
export const LOGISTIC_L2 = 0.05;

const FEATURE_NAMES = PERIODIC_MODULI.flatMap((modulus) => [
  `period_mod_${modulus}_sin`,
  `period_mod_${modulus}_cos`,
]);

export function compareIssueNumbers(a: string, b: string): number {
  try {
    const left = BigInt(String(a).trim());
    const right = BigInt(String(b).trim());
    return left < right ? -1 : left > right ? 1 : 0;
  } catch {
    return String(a).localeCompare(String(b), undefined, { numeric: true });
  }
}

export function dateFromIssue(issueNumber: string): string | null {
  const issue = String(issueNumber).trim();
  return /^\d{8}/.test(issue) ? issue.slice(0, 8) : null;
}

export function positionFromIssue(issueNumber: string): number | null {
  const issue = String(issueNumber).trim();
  if (!/^\d+$/.test(issue) || issue.length < 4) return null;
  const position = Number(issue.slice(-4));
  return Number.isInteger(position) ? position : null;
}

export function scheduledStartFromIssue(issueNumber: string): number | null {
  const date = dateFromIssue(issueNumber);
  const position = positionFromIssue(issueNumber);
  if (!date || position === null) return null;
  const startOfDate = Date.parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T00:00:00.000Z`);
  if (!Number.isFinite(startOfDate)) return null;
  return startOfDate + (position - 1) * 30_000;
}

function availabilityOf(record: ExperimentalHistoryRecord): number | null {
  const values = [record.createdAt, record.sourceTime]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));
  return values.length > 0 ? Math.max(...values) : null;
}

export function sizeOfNumber(number: number): ExperimentalSize {
  return number >= 5 ? 'BIG' : 'SMALL';
}

export function buildPeriodicFeatures(issueNumber: string): PeriodicFeature[] {
  const position = positionFromIssue(issueNumber);
  if (position === null) return [];
  return PERIODIC_MODULI.flatMap((modulus) => {
    const angle = (2 * Math.PI * position) / modulus;
    return [
      { name: `period_mod_${modulus}_sin`, value: Math.sin(angle) },
      { name: `period_mod_${modulus}_cos`, value: Math.cos(angle) },
    ];
  });
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}

function fitWeights(trainingRows: Array<{ features: number[]; actual: ExperimentalSize }>): number[] {
  const weights = Array.from({ length: FEATURE_NAMES.length + 1 }, () => 0);
  if (trainingRows.length === 0) return weights;

  for (let iteration = 0; iteration < LOGISTIC_ITERATIONS; iteration += 1) {
    const gradient = Array.from({ length: weights.length }, () => 0);
    for (const row of trainingRows) {
      const values = [1, ...row.features];
      const probability = sigmoid(values.reduce((sum, value, index) => sum + value * weights[index], 0));
      const target = row.actual === 'BIG' ? 1 : 0;
      for (let index = 0; index < values.length; index += 1) {
        gradient[index] += (probability - target) * values[index];
      }
    }

    for (let index = 0; index < weights.length; index += 1) {
      const regularization = index === 0 ? 0 : LOGISTIC_L2 * weights[index];
      weights[index] -= LOGISTIC_LEARNING_RATE * (gradient[index] / trainingRows.length + regularization);
    }
  }
  return weights;
}

function predictWithWeights(weights: number[], features: number[]): number {
  return sigmoid([1, ...features].reduce((sum, value, index) => sum + value * weights[index], 0));
}

function eligibleTrainingRows(
  target: ExperimentalHistoryRecord,
  history: ExperimentalHistoryRecord[],
): Array<{ record: ExperimentalHistoryRecord; features: number[]; actual: ExperimentalSize }> {
  const targetDate = dateFromIssue(target.issueNumber);
  const targetStart = scheduledStartFromIssue(target.issueNumber);
  if (!targetDate || targetStart === null) return [];

  return history
    .filter((record) => {
      const recordDate = dateFromIssue(record.issueNumber);
      const recordStart = scheduledStartFromIssue(record.issueNumber);
      const availableAt = availabilityOf(record);
      return (
        recordDate === targetDate &&
        recordStart !== null &&
        recordStart < targetStart &&
        availableAt !== null &&
        availableAt < targetStart &&
        compareIssueNumbers(record.issueNumber, target.issueNumber) < 0
      );
    })
    .map((record) => ({
      record,
      features: buildPeriodicFeatures(record.issueNumber).map((feature) => feature.value),
      actual: sizeOfNumber(record.winningNumber),
    }));
}

export function predictExperimentalPeriod(
  target: ExperimentalHistoryRecord,
  history: ExperimentalHistoryRecord[],
): ExperimentalPrediction {
  const features = buildPeriodicFeatures(target.issueNumber);
  const training = eligibleTrainingRows(target, history);
  // Length-based indexing instead of Array.prototype.at(-1): `.at` requires
  // lib ES2022+, but Vercel typechecks the api/ function graph with an older
  // default lib. Behaviour is identical (empty array -> undefined -> null).
  const sortedTrainingPeriods = training
    .map((row) => row.record.issueNumber)
    .sort(compareIssueNumbers);
  const trainedThrough = sortedTrainingPeriods[sortedTrainingPeriods.length - 1] ?? null;

  if (features.length !== FEATURE_NAMES.length) {
    return {
      periodId: target.issueNumber,
      algorithmVersion: 'CPL-1',
      prediction: null,
      probabilityBig: null,
      features,
      trainingCount: training.length,
      trainedThroughPeriod: trainedThrough,
      reason: 'Invalid issue format: periodic position is unavailable.',
    };
  }

  if (training.length < MINIMUM_TRAINING_ROWS) {
    return {
      periodId: target.issueNumber,
      algorithmVersion: 'CPL-1',
      prediction: null,
      probabilityBig: null,
      features,
      trainingCount: training.length,
      trainedThroughPeriod: trainedThrough,
      reason: `Minimum training history is ${MINIMUM_TRAINING_ROWS} same-date rows.`,
    };
  }

  const weights = fitWeights(training);
  const probabilityBig = predictWithWeights(weights, features.map((feature) => feature.value));
  return {
    periodId: target.issueNumber,
    algorithmVersion: 'CPL-1',
    prediction: probabilityBig >= 0.5 ? 'BIG' : 'SMALL',
    probabilityBig,
    features,
    trainingCount: training.length,
    trainedThroughPeriod: trainedThrough,
  };
}

export function calculatePerformance(rows: WalkForwardRow[]): PerformanceMetrics {
  let wins = 0;
  let losses = 0;
  let noSignals = 0;
  let longestWinStreak = 0;
  let longestLossStreak = 0;
  let currentWinStreak = 0;
  let currentLossStreak = 0;
  let equity = 0;
  let peak = 0;
  let maximumDrawdownUnits = 0;
  let previous: WalkForwardRow | null = null;

  for (const row of [...rows].sort((a, b) => compareIssueNumbers(a.periodId, b.periodId))) {
    const dateChanged = previous && dateFromIssue(previous.periodId) !== dateFromIssue(row.periodId);
    const previousPosition = previous ? positionFromIssue(previous.periodId) : null;
    const currentPosition = positionFromIssue(row.periodId);
    const sequenceGap = previousPosition !== null && currentPosition !== null && currentPosition !== previousPosition + 1;
    if (dateChanged || sequenceGap) {
      equity = 0;
      peak = 0;
      currentWinStreak = 0;
      currentLossStreak = 0;
    }

    if (row.outcome === 'NO_SIGNAL') {
      noSignals += 1;
      previous = row;
      continue;
    }
    if (row.outcome === 'WIN') {
      wins += 1;
      currentWinStreak += 1;
      currentLossStreak = 0;
      equity += 1;
      longestWinStreak = Math.max(longestWinStreak, currentWinStreak);
    } else {
      losses += 1;
      currentLossStreak += 1;
      currentWinStreak = 0;
      equity -= 1;
      longestLossStreak = Math.max(longestLossStreak, currentLossStreak);
    }
    peak = Math.max(peak, equity);
    maximumDrawdownUnits = Math.max(maximumDrawdownUnits, peak - equity);
    previous = row;
  }

  const totalPredictions = wins + losses;
  return {
    totalPredictions,
    wins,
    losses,
    noSignals,
    accuracy: totalPredictions > 0 ? wins / totalPredictions : null,
    longestWinStreak,
    longestLossStreak,
    maximumDrawdownUnits,
  };
}

export function evaluateWalkForward(records: ExperimentalHistoryRecord[]): WalkForwardRow[] {
  const sorted = [...records].sort((a, b) => compareIssueNumbers(a.issueNumber, b.issueNumber));
  const output: WalkForwardRow[] = [];

  for (const target of sorted) {
    const prediction = predictExperimentalPeriod(target, sorted);
    const actualSize = sizeOfNumber(target.winningNumber);
    const outcome = prediction.prediction === null
      ? 'NO_SIGNAL'
      : prediction.prediction === actualSize
      ? 'WIN'
      : 'LOSS';
    output.push({
      ...prediction,
      date: dateFromIssue(target.issueNumber) ?? 'UNKNOWN',
      actualNumber: target.winningNumber,
      actualSize,
      outcome,
    });
  }
  return output;
}

export function featureNames(): string[] {
  return [...FEATURE_NAMES];
}
