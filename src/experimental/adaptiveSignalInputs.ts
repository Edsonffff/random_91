import type { AdaptiveInputRow, ActiveInputRow } from '../hooks/useAdaptiveLearning';
import type { computeTest3 } from './test3Sequence';
import type { TimeTestResult } from '../components/history/AdditionalSignalsPanel';
import type { Cpl3Row } from './cpl3LossStreakBreaker';

/** Pure full-replay input joins for generated algorithm parity validation. */
export function browserAdaptiveInputs(
  dataset: { period: string; number: number }[],
  test3: ReturnType<typeof computeTest3>, test7: TimeTestResult, test9Rows: Cpl3Row[],
): AdaptiveInputRow[] {
  const t3 = new Map(test3.details.map((row) => [row.period, row.predictedSize]));
  const t7 = new Map(test7.details.filter((row) => !row.noSignal).map((row) => [row.period, row.predictedSize]));
  const t9 = new Map(test9Rows.map((row) => [row.periodId, row.prediction === 'BIG' ? 'Big' : row.prediction === 'SMALL' ? 'Small' : null] as const));
  const actuals = new Map(dataset.map((row) => [row.period, row.number >= 5 ? 'Big' : 'Small'] as const));
  return [...actuals].map(([period, actual]) => ({
    period, actual, t3pred: t3.get(period) ?? null, t7pred: t7.get(period) ?? null, t9pred: t9.get(period) ?? null,
  }));
}

export function browserActiveInput(
  period: string | null, test3: ReturnType<typeof computeTest3>, test7: TimeTestResult, test9: Cpl3Row | null,
): ActiveInputRow | null {
  return period ? {
    period, t3pred: test3.latestPrediction, t7pred: test7.latestPrediction,
    t9pred: test9?.prediction === 'BIG' ? 'Big' : test9?.prediction === 'SMALL' ? 'Small' : null,
  } : null;
}
