import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyCpl2Gate,
  calculateLossStreakMetrics,
  compareLossObjectives,
  CPL2_THRESHOLDS,
  measureCpl2,
  selectCpl2Threshold,
} from '../src/experimental/cpl2ConfidenceGate';
import type { WalkForwardRow } from '../src/experimental/periodicLogisticAlgorithm.js';
import {
  cpl3Metrics,
  CPL3_CONFIGS,
  runCpl3WalkForward,
  selectCpl3Config,
} from '../src/experimental/cpl3LossStreakBreaker';

function row(probabilityBig: number | null, slot = 1): WalkForwardRow {
  return {
    periodId: `2026100310005${String(slot).padStart(4, '0')}`,
    algorithmVersion: 'CPL-1',
    prediction: probabilityBig === null ? null : probabilityBig >= 0.5 ? 'BIG' : 'SMALL',
    probabilityBig,
    features: [],
    trainingCount: 20,
    trainedThroughPeriod: null,
    date: '20261003',
    actualNumber: 6,
    actualSize: 'BIG',
    outcome: probabilityBig === null ? 'NO_SIGNAL' : probabilityBig >= 0.5 ? 'WIN' : 'LOSS',
  };
}

test('all gate boundaries are inclusive, null and uncertain probabilities abstain', () => {
  for (const threshold of CPL2_THRESHOLDS) {
    assert.equal(applyCpl2Gate(row(threshold), threshold).gatedPrediction, 'BIG');
    assert.equal(applyCpl2Gate(row(1 - threshold), threshold).gatedPrediction, 'SMALL');
    assert.equal(applyCpl2Gate(row(threshold - 1e-8), threshold).gatedPrediction, null);
    assert.equal(applyCpl2Gate(row(1 - threshold + 1e-8), threshold).gatedPrediction, null);
    assert.equal(applyCpl2Gate(row(null), threshold).gatedPrediction, null);
  }
});

test('gating does not mutate CPL-1 or depend on the actual result', () => {
  const input = row(0.57);
  const before = structuredClone(input);
  const result = applyCpl2Gate(input, 0.56);
  const alternate = applyCpl2Gate({ ...input, actualSize: 'SMALL', actualNumber: 2 }, 0.56);
  assert.deepEqual(input, before);
  assert.equal(result.gatedPrediction, alternate.gatedPrediction);
  assert.equal(result.gatedOutcome, 'WIN');
  assert.equal(alternate.gatedOutcome, 'LOSS');
});

test('NO_SIGNAL breaks a loss episode but does not reset drawdown', () => {
  const outcomes = ['LOSS', 'LOSS', 'NO_SIGNAL', 'LOSS', 'WIN', 'LOSS', 'LOSS'] as const;
  const metrics = calculateLossStreakMetrics(outcomes.map((outcome, i) => ({ periodId: row(null, i + 1).periodId, outcome })));
  assert.equal(metrics.lossStreakCount, 3);
  assert.equal(metrics.averageLossStreak, 5 / 3);
  assert.equal(metrics.longestLossStreak, 2);
  assert.equal(metrics.maximumDrawdown, 4);
  assert.equal(metrics.coverage, 6 / 7);
  assert.equal(metrics.noSignalCount, 1);
  assert.equal(metrics.accuracy, 1 / 6);
});

test('gaps break streaks but keep daily drawdown; dates reset daily accounting', () => {
  const metrics = calculateLossStreakMetrics([
    { periodId: row(null, 3).periodId, outcome: 'LOSS' },
    { periodId: row(null, 1).periodId, outcome: 'LOSS' },
    { periodId: '20261004100050001', outcome: 'LOSS' },
  ]);
  assert.equal(metrics.lossStreakCount, 3);
  assert.equal(metrics.longestLossStreak, 1);
  assert.equal(metrics.maximumDrawdown, 2);
});

test('80% is a hard constraint; no eligible candidate returns null', () => {
  const rows = [row(0.6, 1), row(0.6, 2), row(0.6, 3), row(0.6, 4), row(0.5, 5)];
  const metrics = measureCpl2(rows, 0.52);
  assert.equal(metrics.coverage, 0.8);
  assert.equal(selectCpl2Threshold([{ threshold: 0.52, metrics }])?.threshold, 0.52);
  assert.equal(selectCpl2Threshold([{ threshold: 0.52, metrics: { ...metrics, coverage: 0.7999 } }]), null);
  assert.equal(selectCpl2Threshold([]), null);
});

test('selection obeys every lexicographic objective and deterministic final tie-break', () => {
  const base = measureCpl2([row(0.6)], 0.52);
  const fields = ['lossStreakCount', 'longestLossStreak', 'averageLossStreak', 'maximumDrawdown'] as const;
  for (const field of fields) {
    assert.ok(compareLossObjectives({ ...base, [field]: 1 }, { ...base, [field]: 2 }) < 0);
  }
  assert.ok(compareLossObjectives({ ...base, lossStreakCount: 1, longestLossStreak: 10 }, { ...base, lossStreakCount: 2, longestLossStreak: 1 }) < 0);
  assert.ok(compareLossObjectives({ ...base, accuracy: 0.6 }, { ...base, accuracy: 0.5 }) < 0);
  assert.equal(selectCpl2Threshold([{ threshold: 0.54, metrics: base }, { threshold: 0.52, metrics: base }])?.threshold, 0.52);
});

test('CPL-3 preserves CPL-1 signal coverage and never abstains on a CPL-1 signal', () => {
  const rows = [row(0.6, 1), row(0.4, 2), row(null, 3), row(0.6, 4)];
  const result = runCpl3WalkForward(rows, CPL3_CONFIGS[0]);
  assert.equal(result.length, rows.length);
  assert.equal(result.filter((item) => item.noSignal).length, 1);
  assert.equal(result.filter((item) => !item.noSignal).length, 3);
  assert.equal(cpl3Metrics(result).coverage, 0.75);
});

test('CPL-3 selection enforces coverage before loss-streak objectives', () => {
  const base = cpl3Metrics(runCpl3WalkForward([row(0.6, 1), row(0.4, 2), row(0.6, 3), row(0.4, 4)], CPL3_CONFIGS[0]));
  const selected = selectCpl3Config([
    { config: CPL3_CONFIGS[0], metrics: { ...base, coverage: 0.79, longestLossStreak: 1 } },
    { config: CPL3_CONFIGS[1], metrics: { ...base, coverage: 0.8, longestLossStreak: 3 } },
    { config: CPL3_CONFIGS[2], metrics: { ...base, coverage: 0.8, longestLossStreak: 2 } },
  ]);
  assert.equal(selected?.config.name, CPL3_CONFIGS[2].name);
});
