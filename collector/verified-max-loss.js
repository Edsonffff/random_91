import {
  computeTest3, computeTest7, predictExperimentalPeriod, sizeOfNumber,
  dateFromIssue, advanceCpl3, CPL3_CONFIGS, compareIssuesAsc,
} from './adaptive-algorithms.generated.js';
import { nextPeriod } from './adaptive-runtime.js';
import { createHash } from 'node:crypto';

const CONFIG = CPL3_CONFIGS.find((config) => config.name === 'context-8-cap-3');
const freshStreak = () => ({ currentLossStreak: 0, longestLossStreak: 0, knownThrough: null,
  scoredPeriods: 0, unknownPeriods: 0, currentLossStartPeriod: null, recordStartPeriod: null, recordEndPeriod: null });

/** UNKNOWN is ignored, never an inferred win/loss. Historical records never decrease. */
export function advanceVerifiedStreak(state, outcome) {
  if (outcome === 'LOSS') {
    state.currentLossStreak++;
    if (state.currentLossStreak > state.longestLossStreak) state.longestLossStreak = state.currentLossStreak;
  } else if (outcome === 'WIN') {
    state.currentLossStreak = 0;
    if ('currentLossStartPeriod' in state) state.currentLossStartPeriod = null;
  }
  return state;
}

export function historyGap(previous, current) {
  const firstMissingHistoryPeriod = nextPeriod(previous);
  if (firstMissingHistoryPeriod === current) return null;
  // Use the real 30-second sequence, including midnight, not numeric subtraction across dates.
  let period = firstMissingHistoryPeriod;
  let lastMissingHistoryPeriod = null;
  let missingCount = 0;
  while (compareIssuesAsc(period, current) < 0) {
    lastMissingHistoryPeriod = period;
    missingCount++;
    period = nextPeriod(period);
  }
  return { lastAvailablePeriod: previous, firstMissingHistoryPeriod, lastMissingHistoryPeriod, nextAvailablePeriod: current, missingCount };
}

/** Score one durable T7 prediction/result using the existing scorer, not provider settlement metadata. */
export function scoreVerifiedT7(record, signal) {
  if (!signal || signal.period_id !== record.issueNumber || !['BIG', 'SMALL'].includes(signal.signal)) return 'UNKNOWN';
  const detail = computeTest7([{ period: record.issueNumber, number: record.winningNumber }],
    new Map([[signal.period_id, signal]])).details[0];
  return !detail || detail.noSignal ? 'UNKNOWN' : detail.isHit ? 'WIN' : 'LOSS';
}

/**
 * Independent, read-only metric. No Adaptive engine, votes, weights or checkpoint writes.
 * T3 uses the original sequence/scorer only where its ordinal is established.
 * T9 uses the exact frozen predictor and private CPL-3 context on available history.
 */
export async function calculateVerifiedMaxLoss(records, signals, {
  baselineId = null, scopeStartPeriod = null,
  onProgress = () => {}, yieldEvery = 50, cplCache = new Map(),
} = {}) {
  const sorted = [...records].sort((a, b) => compareIssuesAsc(a.issueNumber, b.issueNumber));
  scopeStartPeriod ??= sorted[0]?.issueNumber ?? null;
  if (sorted.length && scopeStartPeriod && sorted[0].issueNumber !== scopeStartPeriod) {
    throw new Error('Max Loss scope starting history row is missing; chronological position is unverified.');
  }
  for (let index = 0; index < sorted.length; index++) {
    const record = sorted[index];
    if (!record.issueNumber || !Number.isInteger(record.winningNumber) || record.winningNumber < 0 || record.winningNumber > 9) {
      throw new Error('Invalid durable history input for verified Max Loss.');
    }
    if (index && record.issueNumber === sorted[index - 1].issueNumber) throw new Error('Duplicate Max Loss history input.');
  }
  const signalMap = new Map(signals.map((signal) => [signal.period_id, signal]));
  const gaps = [];
  for (let index = 1; index < sorted.length; index++) {
    const gap = historyGap(sorted[index - 1].issueNumber, sorted[index].issueNumber);
    if (gap) gaps.push(gap);
  }
  const t3Details = computeTest3(sorted
    .map((record) => ({ period: record.issueNumber, number: record.winningNumber }))).details;
  const tests = { test3: freshStreak(), test7: freshStreak(), test9: freshStreak() };
  let cplState = { stats: [], previous: null, priorLossStreak: 0, previousActual: null };
  let sameDateRecords = [];
  let lastDate = null;
  let sameDateDigest = '';
  let t9ContextEstablished = true;
  let processedThrough = null;

  const snapshot = (calculationStatus) => {
    const unknown = Object.values(tests).some((test) => test.unknownPeriods > 0);
    const reasons = [gaps.length ? 'historical_gap' : null, unknown ? 'unknown_predictions' : null,
      baselineId ? 'baseline_scoped' : null, calculationStatus === 'calculating' ? 'calculating' : null].filter(Boolean);
    const through = Object.values(tests).map((test) => test.knownThrough);
    const knownThrough = through.every(Boolean) ? through.sort(compareIssuesAsc)[0] : null;
    return {
      test3: tests.test3.longestLossStreak, test7: tests.test7.longestLossStreak, test9: tests.test9.longestLossStreak,
      tests: structuredClone(tests),
      coverage: reasons.length ? 'partial' : 'complete', coverageReason: reasons[0] ?? null, coverageReasons: reasons,
      firstMissingHistoryPeriod: gaps[0]?.firstMissingHistoryPeriod ?? null,
      lastMissingHistoryPeriod: gaps[0]?.lastMissingHistoryPeriod ?? null,
      historyGaps: gaps, knownThrough, processedThrough,
      availableThrough: sorted.at(-1)?.issueNumber ?? null,
      scopeStartPeriod, baselineId, calculationStatus, calculatedAt: new Date().toISOString(),
    };
  };

  for (const [index, record] of sorted.entries()) {
    const date = dateFromIssue(record.issueNumber);
    if (date !== lastDate) {
      sameDateRecords = [];
      sameDateDigest = '';
      // The approved starting scope establishes initial context. Subsequent
      // dates can re-establish context only when their first round is present.
      t9ContextEstablished = index === 0 || record.issueNumber.endsWith('0001');
      cplState = { stats: [], previous: null, priorLossStreak: 0, previousActual: null };
    }
    sameDateDigest = createHash('sha256').update(sameDateDigest + JSON.stringify(record)).digest('hex');
    const cached = cplCache.get(record.issueNumber);
    let cpl;
    if (t9ContextEstablished && cached?.digest === sameDateDigest) cpl = cached.value;
    else if (t9ContextEstablished) {
      const cpl1 = predictExperimentalPeriod(record, sameDateRecords);
      const actualSize = sizeOfNumber(record.winningNumber);
      const cplRow = { ...cpl1, date: date ?? 'UNKNOWN', actualNumber: record.winningNumber, actualSize,
        outcome: cpl1.prediction === null ? 'NO_SIGNAL' : cpl1.prediction === actualSize ? 'WIN' : 'LOSS' };
      cpl = advanceCpl3([cplRow], cplState, CONFIG);
      cplCache.set(record.issueNumber, { digest: sameDateDigest, value: cpl });
    }
    if (cpl) cplState = cpl.state;
    // T9 prediction context retains its algorithm-defined date behavior;
    // streak accounting below ignores unknown rows and historical gaps.
    const outcomes = {
      test3: t3Details[index].isHit ? 'WIN' : 'LOSS',
      test7: scoreVerifiedT7(record, signalMap.get(record.issueNumber)),
      test9: !cpl || cpl.rows[0].outcome === 'NO_SIGNAL' ? 'UNKNOWN' : cpl.rows[0].outcome,
    };
    for (const [name, outcome] of Object.entries(outcomes)) {
      const test = tests[name];
      const previousMax = test.longestLossStreak;
      if (outcome === 'LOSS' && test.currentLossStreak === 0) test.currentLossStartPeriod = record.issueNumber;
      advanceVerifiedStreak(test, outcome);
      if (test.longestLossStreak > previousMax) {
        test.recordStartPeriod = test.currentLossStartPeriod;
        test.recordEndPeriod = record.issueNumber;
      }
      if (outcome === 'UNKNOWN') test.unknownPeriods++;
      else { test.scoredPeriods++; test.knownThrough = record.issueNumber; }
    }
    sameDateRecords.push(record);
    lastDate = date;
    processedThrough = record.issueNumber;
    if (yieldEvery && (index + 1) % yieldEvery === 0) {
      onProgress(snapshot('calculating'));
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  return snapshot('ready');
}
