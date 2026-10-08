import { createHash } from 'node:crypto';
import {
  SOURCE_FINGERPRINT, SIGNAL_LABELS, compareIssuesAsc, test3Prediction, computeTest7,
  predictExperimentalPeriod, sizeOfNumber, dateFromIssue, CPL3_CONFIGS,
  advanceCpl3, advanceAdaptive, freshWeights, computeVote, rowPredictions, rollingWindow,
} from './adaptive-algorithms.generated.js';
import { ADAPTIVE_INPUT_POLICY, LEGACY_T7_REQUIRED_POLICY } from './adaptive-input-policy.js';

const CONFIG = CPL3_CONFIGS.find((config) => config.name === 'context-8-cap-3');
const emptyCplState = () => ({ stats: [], previous: null, priorLossStreak: 0, previousActual: null });
// Explicit one-time migration from the retired pair-mapping implementation.
export const PREVIOUS_T3_FINGERPRINT = '4410623ba977e29313b5a8cfe696cbfd5c02f0e37e6e47d287f45ed7932395ea';

export class InputRevisionError extends Error {}

/** Stateful execution of the browser's exact calculations, in chronological order. */
export class AdaptiveLearningEngine {
  constructor({ log = () => {}, clock = () => new Date().toISOString(), inputPolicy = LEGACY_T7_REQUIRED_POLICY } = {}) {
    this.log = log;
    this.clock = clock;
    this.inputPolicy = inputPolicy;
    this.history = [];
    this.records = [];
    this.sameDateRecords = [];
    this.t7Signals = new Map();
    this.weights = freshWeights();
    this.cplState = emptyCplState();
    this.totalHits = 0;
    this.currentHitStreak = 0;
    this.currentMissStreak = 0;
    this.longestHitStreak = 0;
    this.longestMissStreak = 0;
    this.predictionIndex = 0;
    this.test3MissStreak = 0;
    this.test7MissStreak = 0;
    this.test3MaxLoss = 0;
    this.test7MaxLoss = 0;
    this.test9MaxLoss = 0;
    this.lastProcessedPeriod = null;
    this.lastEvaluatedAt = null;
    this.activePrediction = null;
    this.activeSignals = null;
    this.predictedAt = null;
    this.activeCacheKey = null;
    this.inputDigest = '';
    this.firstPredictions = new Map();
  }

  setSignals(signals) {
    let changed = false;
    for (const signal of signals) {
      const period = String(signal.period_id || '').trim();
      if (!period || !['BIG', 'SMALL'].includes(signal.signal)) continue;
      const previous = this.t7Signals.get(period);
      if (previous?.signal === signal.signal) continue;
      if (this.inputPolicy.includeOptionalT7 && this.lastProcessedPeriod && compareIssuesAsc(period, this.lastProcessedPeriod) <= 0) {
        const evaluated = this.history.find((row) => row.period === period);
        if (evaluated && evaluated.t7pred !== (signal.signal === 'BIG' ? 'Big' : 'Small')) {
          throw new InputRevisionError(`T7 input changed after evaluation at ${period}; browser replay would differ. Recovery required.`);
        }
      }
      this.t7Signals.set(period, { ...signal, period_id: period });
      changed = true;
    }
    if (changed) this.activeCacheKey = null;
    return changed;
  }

  settle(record, { quiet = false } = {}) {
    const period = record.issueNumber;
    if (this.lastProcessedPeriod && compareIssuesAsc(period, this.lastProcessedPeriod) <= 0) {
      const existing = this.records.find((row) => row.issueNumber === period);
      if (JSON.stringify(existing) === JSON.stringify(record)) return false;
      throw new InputRevisionError(`History changed or arrived out of order at ${period}.`);
    }
    if (!period || !Number.isInteger(record.winningNumber) || record.winningNumber < 0 || record.winningNumber > 9) {
      throw new Error('Invalid settled history record.');
    }
    const t3 = test3Prediction(this.predictionIndex);
    const t7Metric = computeTest7([{ period, number: record.winningNumber }], this.t7Signals).details[0]?.predictedSize ?? null;
    const t7 = this.inputPolicy.includeOptionalT7 ? t7Metric : null;
    if (dateFromIssue(this.lastProcessedPeriod || '') !== dateFromIssue(period)) this.sameDateRecords = [];
    const cpl1 = predictExperimentalPeriod(record, this.sameDateRecords);
    const actualSize = sizeOfNumber(record.winningNumber);
    const cplRow = {
      ...cpl1, date: dateFromIssue(period) ?? 'UNKNOWN', actualNumber: record.winningNumber, actualSize,
      outcome: cpl1.prediction === null ? 'NO_SIGNAL' : cpl1.prediction === actualSize ? 'WIN' : 'LOSS',
    };
    const cpl = advanceCpl3([cplRow], this.cplState, CONFIG);
    const t9Row = cpl.rows[0];
    const input = {
      period, t3pred: t3, t7pred: t7,
      t9pred: t9Row.prediction === 'BIG' ? 'Big' : t9Row.prediction === 'SMALL' ? 'Small' : null,
      actual: record.winningNumber >= 5 ? 'Big' : 'Small',
    };
    const learned = advanceAdaptive([input], this.weights);
    const evaluated = learned.history[0];
    this.weights = learned.weights;
    this.cplState = cpl.state;
    this.predictionIndex++;
    this.test3MissStreak = t3 === input.actual ? 0 : this.test3MissStreak + 1;
    // T7's existing streak calculation excludes absent signals entirely.
    if (t7 !== null) this.test7MissStreak = t7 === input.actual ? 0 : this.test7MissStreak + 1;
    this.test3MaxLoss = Math.max(this.test3MaxLoss, this.test3MissStreak);
    this.test7MaxLoss = Math.max(this.test7MaxLoss, this.test7MissStreak);
    // CPL-3 already resets this at gaps, date changes and NO_SIGNAL rows.
    this.test9MaxLoss = Math.max(this.test9MaxLoss, this.cplState.priorLossStreak);
    this.history.push(evaluated);
    this.records.push(record);
    this.sameDateRecords.push(record);
    this.totalHits += Number(evaluated.isHit);
    this.currentHitStreak = evaluated.isHit ? this.currentHitStreak + 1 : 0;
    this.currentMissStreak = evaluated.isHit ? 0 : this.currentMissStreak + 1;
    this.longestHitStreak = Math.max(this.longestHitStreak, this.currentHitStreak);
    this.longestMissStreak = Math.max(this.longestMissStreak, this.currentMissStreak);
    this.lastProcessedPeriod = period;
    this.lastEvaluatedAt = this.clock();
    this.inputDigest = createHash('sha256').update(this.inputDigest + JSON.stringify({ record, input })).digest('hex');
    this.activeCacheKey = null;
    this.activePrediction = null;
    this.activeSignals = null;
    if (!quiet) {
      this.log(`newly processed period=${period} T3=${t3} T7=${t7} T9=${input.t9pred}`);
      this.log(`settlement period=${period} decision=${evaluated.adaptiveDecision} actual=${input.actual} result=${evaluated.isHit ? 'HIT' : 'MISS'}`);
    }
    return { evaluated, test3: { prediction: t3, sequencePosition: (this.predictionIndex - 1) % 14 + 1, outcome: t3 === input.actual ? 'HIT' : 'MISS' }, cpl1: cplRow, cpl3: t9Row };
  }

  predict(period) {
    if (!period || (this.lastProcessedPeriod && compareIssuesAsc(period, this.lastProcessedPeriod) <= 0)) {
      throw new Error(`Active issue ${period} is not newer than settled history.`);
    }
    const key = `${period}:${this.lastProcessedPeriod}`;
    if (key === this.activeCacheKey) return false;
    const rounds = this.records.slice(-1).map((row) => ({ period: row.issueNumber, number: row.winningNumber }));
    const test7 = computeTest7(rounds.slice(-1), this.t7Signals);
    // AlgorithmAnalyzer receives realHistory newest-first for the active prediction.
    // Retain that floating-point training order, unlike its ascending historical replay.
    const previousHistory = this.sameDateRecords.filter((row) => compareIssuesAsc(row.issueNumber, period) < 0).slice().reverse();
    const cpl1 = predictExperimentalPeriod({ issueNumber: period, winningNumber: 0, sourceTime: null, createdAt: null }, previousHistory);
    const targetRow = {
      ...cpl1, date: period.slice(0, 8), actualNumber: 0, actualSize: sizeOfNumber(0),
      outcome: cpl1.prediction === null ? 'NO_SIGNAL' : cpl1.prediction === sizeOfNumber(0) ? 'WIN' : 'LOSS',
    };
    // advanceCpl3 clones state; scoring the browser's synthetic target never learns.
    const t9 = advanceCpl3([targetRow], this.cplState, CONFIG).rows[0];
    const input = {
      period, t3pred: test3Prediction(this.predictionIndex),
      t7pred: this.inputPolicy.includeOptionalT7 ? test7.latestPrediction : null,
      t9pred: t9.prediction === 'BIG' ? 'Big' : t9.prediction === 'SMALL' ? 'Small' : null,
    };
    const vote = computeVote(rowPredictions(input), this.weights);
    this.activePrediction = {
      period, decision: vote.decision, probBig: vote.probBig, probSmall: vote.probSmall,
      signalsAvailable: vote.available.length, weights: [...this.weights],
    };
    this.activeSignals = {
      ...input, t3Reason: `Repeating 14-round sequence · position ${this.predictionIndex % 14 + 1}/14`, t9Reason: cpl1.reason ?? null,
      t9ProbabilityBig: cpl1.probabilityBig, t9TrainingCount: cpl1.trainingCount,
    };
    this.predictedAt = this.clock();
    if (!this.firstPredictions.has(period)) {
      this.firstPredictions.set(period, { ...this.activePrediction, predictedAt: this.predictedAt });
      while (this.firstPredictions.size > 500) this.firstPredictions.delete(this.firstPredictions.keys().next().value);
    }
    this.activeCacheKey = key;
    this.log(`prediction period=${period} decision=${vote.decision} T3=${input.t3pred} T7=${input.t7pred} T9=${input.t9pred}`);
    return true;
  }

  current() {
    const last = this.history.at(-1) ?? null;
    const available = last ? [last.t3pred, last.t7pred, last.t9pred].filter((p) => p !== null) : [];
    const bigVotes = available.filter((p) => p === 'Big').length;
    const smallVotes = available.filter((p) => p === 'Small').length;
    const requiredWeightTotal = this.weights[0] + this.weights[2];
    const adaptiveWeights = requiredWeightTotal > 0
      ? [this.weights[0] / requiredWeightTotal, this.weights[2] / requiredWeightTotal]
      : [0.5, 0.5];
    const adaptiveDominantSignalIndex = adaptiveWeights[0] >= adaptiveWeights[1] ? 0 : 1;
    return {
      success: true, version: SOURCE_FINGERPRINT, signalLabels: SIGNAL_LABELS,
      adaptiveInputMode: this.inputPolicy.id,
      adaptiveRequiredSignals: [...this.inputPolicy.requiredSignals],
      adaptiveOptionalSignals: [...this.inputPolicy.optionalSignals],
      finalDecision: last?.adaptiveDecision ?? null, activePrediction: this.activePrediction,
      signals: this.activeSignals, latestEvaluation: last,
      latestEvaluatedPeriod: this.lastProcessedPeriod, evaluatedAt: this.lastEvaluatedAt, predictedAt: this.predictedAt,
      totalPredictions: this.history.length, totalHits: this.totalHits, totalMisses: this.history.length - this.totalHits,
      accuracyPct: this.history.length ? Math.round(this.totalHits / this.history.length * 100) : 0,
      currentHitStreak: this.currentHitStreak, currentMissStreak: this.currentMissStreak,
      longestHitStreak: this.longestHitStreak, longestMissStreak: this.longestMissStreak,
      test3MaxLoss: this.test3MaxLoss, test7MaxLoss: this.test7MaxLoss, test9MaxLoss: this.test9MaxLoss,
      weights: [...this.weights], dominantSignalIndex: this.weights.indexOf(Math.max(...this.weights)),
      adaptiveWeights, adaptiveDominantSignalIndex,
      last20: rollingWindow(this.history, 20), last50: rollingWindow(this.history, 50),
      last100: rollingWindow(this.history, 100), last250: rollingWindow(this.history, 250),
      lastSignalAgreement: { bigVotes, smallVotes, total: available.length, majority: bigVotes > smallVotes ? 'Big' : smallVotes > bigVotes ? 'Small' : null },
    };
  }

  checkpoint() {
    // Raw history/T7 already exist in Supabase. Recover those once on startup;
    // do not duplicate thousands of rows in every checkpoint write.
    return {
      version: SOURCE_FINGERPRINT, period: this.lastProcessedPeriod, inputDigest: this.inputDigest,
      adaptiveInputMode: this.inputPolicy.id,
      predictionIndex: this.predictionIndex,
      test3MissStreak: this.test3MissStreak, test7MissStreak: this.test7MissStreak,
      test3MaxLoss: this.test3MaxLoss, test7MaxLoss: this.test7MaxLoss, test9MaxLoss: this.test9MaxLoss,
      weights: [...this.weights], totalPredictions: this.history.length, totalHits: this.totalHits,
      currentHitStreak: this.currentHitStreak, currentMissStreak: this.currentMissStreak,
      longestHitStreak: this.longestHitStreak, longestMissStreak: this.longestMissStreak,
      evaluatedAt: this.lastEvaluatedAt, predictedAt: this.predictedAt,
      activePrediction: this.activePrediction, activeSignals: this.activeSignals,
      firstPredictions: [...this.firstPredictions],
    };
  }

  verifyRecovery(checkpoint) {
    if (checkpoint.version === PREVIOUS_T3_FINGERPRINT) {
      // Weights/digest/ensemble maxima from the pair algorithm are obsolete.
      // Keep the newly reconstructed sequence and model; verify durable coverage.
      if (checkpoint.period !== this.lastProcessedPeriod || checkpoint.totalPredictions !== this.history.length) {
        throw new InputRevisionError('Previous Test 3 checkpoint coverage differs from settled history.');
      }
      this.firstPredictions = new Map(checkpoint.firstPredictions ?? []);
      this.lastEvaluatedAt = checkpoint.evaluatedAt;
      this.log(`checkpoint migrated to 14-round Test 3 sequence position=${this.predictionIndex % 14 + 1}`);
      return;
    }
    if (checkpoint.version !== SOURCE_FINGERPRINT) throw new InputRevisionError('Checkpoint algorithm version differs from browser sources.');
    for (const field of ['period', 'inputDigest', 'weights', 'totalPredictions', 'totalHits', 'currentHitStreak', 'currentMissStreak', 'predictionIndex', 'test3MissStreak', 'test7MissStreak', 'test3MaxLoss', 'test7MaxLoss', 'test9MaxLoss']) {
      if (JSON.stringify(checkpoint[field]) !== JSON.stringify(this.checkpoint()[field])) {
        throw new InputRevisionError(`Checkpoint recovery mismatch: ${field} at ${checkpoint.period}.`);
      }
    }
    this.longestHitStreak = Math.max(this.longestHitStreak, checkpoint.longestHitStreak);
    this.longestMissStreak = Math.max(this.longestMissStreak, checkpoint.longestMissStreak);
    this.lastEvaluatedAt = checkpoint.evaluatedAt;
    this.predictedAt = checkpoint.predictedAt;
    this.activePrediction = checkpoint.activePrediction;
    this.activeSignals = checkpoint.activeSignals;
    this.firstPredictions = new Map(checkpoint.firstPredictions);
    // Restore the prediction cache key so predict() does not rerun on the same
    // period and overwrite predictedAt with the current clock after recovery.
    if (this.activePrediction?.period && this.lastProcessedPeriod) {
      this.activeCacheKey = this.activePrediction.period + ':' + this.lastProcessedPeriod;
    }
  }
}
