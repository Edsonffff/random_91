import { compareIssuesAsc } from '../context/RealHistoryContext';

export const TEST3_SEQUENCE = [
  'Small', 'Big', 'Small', 'Big', 'Small', 'Small', 'Big',
  'Small', 'Big', 'Big', 'Small', 'Big', 'Small', 'Small',
] as const;

export function test3Prediction(predictionIndex: number): 'Big' | 'Small' {
  return TEST3_SEQUENCE[predictionIndex % 14];
}

export interface Test3Detail {
  period: string;
  sequencePosition: number;
  predictedSize: 'Big' | 'Small';
  actualSize: 'Big' | 'Small';
  actualNumber: number;
  isHit: boolean;
  outcome: 'HIT' | 'MISS';
}

export function computeTest3(dataset: { period: string; number: number }[]) {
  const rounds = new Map(dataset.filter((row) => row.period).map((row) => [String(row.period).trim(), row]));
  const periods = [...rounds.keys()].sort(compareIssuesAsc);
  let hits = 0;
  let currentMissStreak = 0;
  let longestMissStreak = 0;
  const details: Test3Detail[] = periods.map((period, predictionIndex) => {
    const round = rounds.get(period)!;
    const predictedSize = test3Prediction(predictionIndex);
    const actualSize = round.number >= 5 ? 'Big' : 'Small';
    const isHit = predictedSize === actualSize;
    hits += Number(isHit);
    currentMissStreak = isHit ? 0 : currentMissStreak + 1;
    longestMissStreak = Math.max(longestMissStreak, currentMissStreak);
    return {
      period, sequencePosition: predictionIndex % 14 + 1, predictedSize,
      actualSize, actualNumber: round.number, isHit, outcome: isHit ? 'HIT' : 'MISS',
    };
  });
  return {
    hits, total: details.length, accuracy: details.length ? Math.round(hits / details.length * 100) : 0,
    details, currentMissStreak, longestMissStreak,
    latestPrediction: test3Prediction(details.length),
    latestPosition: details.length % 14 + 1,
    latestStatus: 'ACTIVE' as const,
    latestReason: `Repeating 14-round sequence · position ${details.length % 14 + 1}/14`,
  };
}
