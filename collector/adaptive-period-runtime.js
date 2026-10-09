import { createHash } from 'node:crypto';
import { AdaptiveLearningEngine, InputRevisionError } from './adaptive-learning.js';
import { ADAPTIVE_INPUT_POLICY, LEGACY_T7_REQUIRED_POLICY, MINIMUM_SIGNAL_POLICY } from './adaptive-input-policy.js';
import { isLateT7Checkpoint, recoverLateT7Checkpoint, replayCheckpoint } from './adaptive-recovery.js';
import { finalizedT7, nextPeriod } from './adaptive-runtime.js';
import { compareIssuesAsc, SOURCE_FINGERPRINT } from './adaptive-algorithms.generated.js';

export const PERIOD_STATUS = Object.freeze({
  PENDING_RESULT: 'PENDING_RESULT', PERMANENTLY_SKIPPED: 'PERMANENTLY_SKIPPED',
  ELIGIBLE: 'ELIGIBLE', EVALUATED: 'EVALUATED',
});
const terminal = (state) => [PERIOD_STATUS.EVALUATED, PERIOD_STATUS.PERMANENTLY_SKIPPED].includes(state?.status);
const validNumber = (value) => Number.isInteger(value) && value >= 0 && value <= 9;
const validSize = (value) => value === 'Big' || value === 'Small';
const ordered = (rows) => [...rows].sort((a, b) => compareIssuesAsc(a.period, b.period));
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => value[key] !== undefined).map((key) => [key, canonical(value[key])]));
  return value;
}
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

// The adapter reads the completed-history table. A missing/invalid row is never
// final, and an explicitly pending result cannot override that contract.
export function finalizedActual(period, { record, actualResult } = {}) {
  return actualResult?.finalized !== false && record?.issueNumber === period
    && validNumber(record.winningNumber) && record.finalized !== false
    && !['pending', 'unknown', 'unfinalized'].includes(record.status);
}

export function classifyPeriod(period, inputs, signals = {}) {
  const contributingTests = ['T3', 'T7', 'T9'].filter((name) => validSize(signals[`${name.toLowerCase()}pred`]));
  const finalized = finalizedActual(period, inputs);
  return {
    period, contributingTests, validSignalCount: contributingTests.length,
    validRecordCount: finalized ? 1 : 0,
    status: !finalized ? PERIOD_STATUS.PENDING_RESULT : contributingTests.length < 2
      ? PERIOD_STATUS.PERMANENTLY_SKIPPED : PERIOD_STATUS.ELIGIBLE,
    reason: !finalized ? 'Actual result not finalized; retry later.' : contributingTests.length < 2
      ? 'Finalized actual result has fewer than two valid exact-period signals.'
      : 'Finalized actual result and at least two valid exact-period signals.',
  };
}

/**
 * Per-period admission around the existing chronological ensemble. The ledger
 * and model checkpoint share one JSONB upsert, so a lost ACK cannot double-learn.
 * Late eligible results replay the post-migration suffix from the same anchor,
 * in issue order, rather than applying a second incremental weight update.
 */
export class AdaptivePeriodRuntime {
  constructor(store, { currentIssue, log = () => {}, now = Date.now } = {}) {
    this.store = store;
    this.currentIssue = currentIssue;
    this.log = log;
    this.now = now;
    this.state = null;
    this.engine = null;
    this.records = new Map();
    this.signals = new Map();
    this.signalCursor = null;
    this.flight = null;
    this.pendingCommit = null;
    this.useBaseline = false;
    this.anchorEngine = null;
    this.predictorCache = null;
    this.body = { success: false, status: 'initializing', checkpointStatus: 'loading' };
  }

  async initialize() {
    const baseline = process.env.ADAPTIVE_BASELINE_AFTER_PERIOD === 'disabled' ? null
      : await this.store.loadBaselineCheckpointRecord?.();
    const baselineStartPeriod = process.env.ADAPTIVE_BASELINE_AFTER_PERIOD && process.env.ADAPTIVE_BASELINE_AFTER_PERIOD !== 'disabled'
      ? process.env.ADAPTIVE_BASELINE_AFTER_PERIOD.trim() : null;
    const saved = baseline ?? await this.store.loadCheckpointRecord();
    this.useBaseline = Boolean(baseline) || Boolean(baselineStartPeriod && !baseline);
    const cp = saved?.state;
    if (baselineStartPeriod && !baseline) {
      const baselineId = `adaptive-baseline-v2-${baselineStartPeriod}`;
      this.state = {
        version: SOURCE_FINGERPRINT, adaptiveInputMode: MINIMUM_SIGNAL_POLICY.id,
        anchor: null, baseline: {
          baselineId, baselineStartPeriod,
          reason: 'Adaptive T3+T9 mode; T7 is optional and independent',
          pendingAfter: null,
        }, period: null, scanThrough: null, periods: [], checkpointAt: null,
      };
    } else if (cp?.adaptiveInputMode === MINIMUM_SIGNAL_POLICY.id
      || cp?.adaptiveInputMode === ADAPTIVE_INPUT_POLICY.id) {
      const { ledgerDigest, ...rest } = cp;
      if (digest(rest) !== ledgerDigest || cp.version !== SOURCE_FINGERPRINT) {
        throw new InputRevisionError('Period ledger checkpoint integrity/version mismatch.');
      }
      this.state = structuredClone(cp);
    } else {
      this.state = {
        version: SOURCE_FINGERPRINT, adaptiveInputMode: MINIMUM_SIGNAL_POLICY.id,
        anchor: cp ?? null, baseline: cp?.baseline ?? null,
        period: cp?.period ?? null, scanThrough: cp?.period ?? null,
        periods: [], checkpointAt: saved?.updatedAt ?? null,
      };
    }
    const start = this.state.baseline?.baselineStartPeriod ?? null;
    const [batch, stored] = await Promise.all([
      start ? this.store.historyFrom(start) : this.store.historyAfter(), this.store.signalsSince(),
    ]);
    if (batch.records.length !== batch.count) throw new Error('Incomplete history snapshot; retrying.');
    this.records = new Map(batch.records.map((record) => [record.issueNumber, record]));
    this.signals = new Map(stored.signals.map((signal) => [signal.period_id, signal]));
    this.signalCursor = stored.through;
    if (this.useBaseline && this.state.baseline && batch.records[0]) {
      this.state.baseline.baselineStartPeriod = batch.records[0].issueNumber;
      this.state.baseline.baselineId = `adaptive-baseline-v2-${batch.records[0].issueNumber}`;
    }
    let anchor = this.state.anchor;
    const legacyAnchor = anchor && (anchor.adaptiveInputMode === LEGACY_T7_REQUIRED_POLICY.id || !anchor.adaptiveInputMode);
    if (anchor) {
      const policy = anchor.adaptiveInputMode === ADAPTIVE_INPUT_POLICY.id ? ADAPTIVE_INPUT_POLICY
        : anchor.adaptiveInputMode === LEGACY_T7_REQUIRED_POLICY.id || !anchor.adaptiveInputMode
          ? LEGACY_T7_REQUIRED_POLICY : null;
      if (!policy) throw new InputRevisionError('Unsupported migration checkpoint; existing state preserved.');
      // Validate the original checkpoint under its original policy, retaining
      // its weights, history, audit predictions and baseline scope verbatim.
      // A legacy checkpoint may predate a T7 finalization that was durably
      // written afterward; use the existing proof-based recovery path rather
      // than treating that expected late input as corruption.
      const checkpointRecords = batch.records.filter((record) =>
        !anchor.period || compareIssuesAsc(record.issueNumber, anchor.period) <= 0);
      try {
        this.anchorEngine = replayCheckpoint(checkpointRecords, stored.signals, anchor, this.log, policy).candidate;
      } catch (error) {
        if (!saved?.updatedAt || !isLateT7Checkpoint(anchor, saved.updatedAt, stored.signals)) throw error;
        this.anchorEngine = recoverLateT7Checkpoint(batch.records, stored.signals, anchor, saved.updatedAt, this.log).candidate;
      }
    } else this.anchorEngine = new AdaptiveLearningEngine({ inputPolicy: MINIMUM_SIGNAL_POLICY });
    if (legacyAnchor) {
      // The old checkpoint was trained with T7 as a required feature. It is
      // validated above for integrity, then rebuilt under the T3+T9 contract;
      // carrying its weights forward would make the policy migration order
      // dependent and would retain T7-only admissions.
      this.state = {
        version: SOURCE_FINGERPRINT, adaptiveInputMode: MINIMUM_SIGNAL_POLICY.id,
        anchor: null, baseline: this.state.baseline ?? null,
        period: null, scanThrough: null, periods: [], checkpointAt: null,
      };
      anchor = null;
      this.anchorEngine = new AdaptiveLearningEngine({ inputPolicy: MINIMUM_SIGNAL_POLICY });
    }
    for (const entry of this.state.periods) {
      if (terminal(entry) && digest(this.records.get(entry.period)) !== entry.recordDigest) {
        throw new InputRevisionError(`Finalized history changed at ${entry.period}.`);
      }
    }
    this.engine = this.replay(this.state.periods);
    if (cp?.adaptiveInputMode === MINIMUM_SIGNAL_POLICY.id
      && digest(this.modelSummary(this.engine)) !== digest(cp.model)) {
      throw new InputRevisionError('Period ledger model recovery mismatch.');
    }
    this.publish();
  }

  replay(entries) {
    const engine = new AdaptiveLearningEngine({ inputPolicy: MINIMUM_SIGNAL_POLICY });
    for (const [key, value] of Object.entries(this.anchorEngine)) {
      if (!['clock', 'log', 'inputPolicy'].includes(key)) engine[key] = structuredClone(value);
    }
    for (const entry of ordered(entries)) {
      if (![PERIOD_STATUS.ELIGIBLE, PERIOD_STATUS.EVALUATED].includes(entry.status)) continue;
      if (!finalizedActual(entry.period, { record: this.records.get(entry.period) })
        || entry.validSignalCount < 2) throw new InputRevisionError(`Invalid admitted input at ${entry.period}.`);
      engine.evaluateInput(entry.input);
      engine.lastEvaluatedAt = entry.evaluatedAt;
    }
    // A decision from the old policy must not be advertised for a new period.
    engine.activePrediction = null;
    engine.activeSignals = null;
    return engine;
  }

  modelSummary(engine) {
    return {
      weights: engine.weights, totalPredictions: engine.history.length, totalHits: engine.totalHits,
      currentHitStreak: engine.currentHitStreak, currentMissStreak: engine.currentMissStreak,
      longestHitStreak: engine.longestHitStreak, longestMissStreak: engine.longestMissStreak,
      historyDigest: digest(engine.history),
    };
  }

  adaptiveMetrics(entries, engine) {
    const history = new Map(engine.history.map((row) => [row.period, row]));
    let currentLossStreak = 0;
    let longestLossStreak = 0;
    let currentHitStreak = 0;
    let longestHitStreak = 0;
    let totalHits = 0;
    let totalMisses = 0;
    let latestEvaluatedPeriod = null;
    for (const entry of ordered(entries)) {
      const row = entry.status === PERIOD_STATUS.EVALUATED ? history.get(entry.period) : null;
      if (!row || typeof row.isHit !== 'boolean') {
        currentLossStreak = 0;
        currentHitStreak = 0;
        continue;
      }
      latestEvaluatedPeriod = entry.period;
      if (row.isHit) {
        totalHits++;
        totalMisses += 0;
        currentHitStreak++;
        currentLossStreak = 0;
        longestHitStreak = Math.max(longestHitStreak, currentHitStreak);
      } else {
        totalMisses++;
        currentLossStreak++;
        currentHitStreak = 0;
        longestLossStreak = Math.max(longestLossStreak, currentLossStreak);
      }
    }
    const totalPredictions = totalHits + totalMisses;
    return {
      totalPredictions, totalHits, totalMisses,
      accuracyPct: totalPredictions ? Math.round(totalHits / totalPredictions * 100) : 0,
      currentHitStreak, currentMissStreak: currentLossStreak,
      longestHitStreak, longestMissStreak: longestLossStreak,
      latestEvaluatedPeriod,
    };
  }

  prepareNextPrediction(engine, targetPeriod) {
    if (!targetPeriod || (engine.lastProcessedPeriod
      && compareIssuesAsc(targetPeriod, engine.lastProcessedPeriod) <= 0)) {
      engine.activePrediction = null;
      engine.activeSignals = null;
      return;
    }
    const signal = this.signals.get(targetPeriod);
    if (signal) engine.setSignals([signal]);
    engine.predict(targetPeriod);
    if (engine.activePrediction && engine.activePrediction.signalsAvailable < 2) {
      // The engine can calculate a mathematical vote with zero/one inputs, but
      // the period-ledger contract reports that as WAITING rather than a real
      // next-period prediction.
      engine.activePrediction = null;
    }
  }

  predictorInputs() {
    const records = [...this.records.values()].filter((record) => finalizedActual(record.issueNumber, { record }))
      .sort((a, b) => compareIssuesAsc(a.issueNumber, b.issueNumber));
    const signals = [...this.signals.values()].sort((a, b) => {
      const periodOrder = compareIssuesAsc(String(a.period_id), String(b.period_id));
      return periodOrder || String(a.stored_at ?? '').localeCompare(String(b.stored_at ?? ''));
    });
    const key = digest({ records, signals });
    if (this.predictorCache?.key === key) return this.predictorCache.inputs;
    const predictor = new AdaptiveLearningEngine({ inputPolicy: LEGACY_T7_REQUIRED_POLICY });
    const inputs = new Map();
    for (const record of records) {
      const signal = this.signals.get(record.issueNumber);
      if (signal) predictor.setSignals([signal]);
      const step = predictor.settle(record, { quiet: true, learn: false });
      inputs.set(record.issueNumber, step.input);
    }
    this.predictorCache = { key, inputs };
    return inputs;
  }

  async commit() {
    const { state, engine } = this.pendingCommit;
    // Retain this exact candidate until ACK; a retry never evaluates again.
    if (this.useBaseline) await this.store.saveBaselineCheckpoint(state);
    else await this.store.saveCheckpoint(state);
    this.state = state;
    this.engine = engine;
    this.pendingCommit = null;
    this.publish();
  }

  publish() {
    if (!this.engine) return;
    const pending = ordered(this.state.periods.filter((entry) => entry.status === PERIOD_STATUS.PENDING_RESULT));
    const skipped = this.state.periods.filter((entry) => entry.status === PERIOD_STATUS.PERMANENTLY_SKIPPED);
    const last = this.engine.history.at(-1);
    const latestState = ordered(this.state.periods).at(-1);
    const metrics = this.adaptiveMetrics(this.state.periods, this.engine);
    this.body = {
      ...this.engine.current(), ...metrics, status: 'ready', adaptiveState: 'ready',
      adaptiveInputMode: MINIMUM_SIGNAL_POLICY.id, adaptiveRequiredSignals: [],
      adaptiveOptionalSignals: ['T3', 'T7', 'T9'], minimumSignals: 2,
      adaptiveWeights: [...this.engine.weights],
      adaptiveDominantSignalIndex: this.engine.weights.indexOf(Math.max(...this.engine.weights)),
      t7AvailableForAdaptive: Boolean(latestState?.input?.t7pred), adaptiveBlocked: false,
      latestEvaluatedPeriod: metrics.latestEvaluatedPeriod ?? last?.period ?? null, adaptiveCursor: this.state.period,
      scanThrough: this.state.scanThrough, checkpointAt: this.state.checkpointAt,
      checkpointStatus: 'saved', databaseConnected: true,
      pendingResultCount: pending.length, permanentlySkippedCount: skipped.length,
      pendingPeriod: pending[0]?.period ?? null,
      t7Coverage: this.state.baseline ? 'independent' : 'not_required',
      adaptiveCoverage: {
        status: pending.length || skipped.length ? 'partial' : 'complete',
        reason: pending.length ? 'pending_results' : skipped.length ? 'low_signal_periods_skipped' : null,
        knownThrough: this.state.scanThrough, pendingPeriods: pending.length, skippedPeriods: skipped.length,
      },
      // Keep the browser contract bounded; the full audit remains durable.
      recentPeriodStates: ordered(this.state.periods).slice(-20).map(({ input, recordDigest, ...entry }) => entry),
      baselineId: this.state.baseline?.baselineId ?? null,
      baselineStartPeriod: this.state.baseline?.baselineStartPeriod ?? null,
      baselineReason: this.state.baseline?.reason ?? null,
      baselinePendingAfter: this.state.baseline?.pendingAfter ?? null,
      baselinePeriodsIncluded: this.engine.history.length,
    };
  }

  advance(inputs = {}) {
    if (this.flight) return this.flight;
    this.flight = this.advanceOnce(inputs).catch((error) => {
      this.log(`[ADAPTIVE] status=error detail=${error.message}`);
      return { success: false, status: 'error', error: error.message,
        adaptiveState: 'error', adaptiveBlocked: true,
        checkpointStatus: this.pendingCommit ? 'pending_retry' : 'error', databaseConnected: false };
    }).finally(() => { this.flight = null; });
    return this.flight;
  }

  async advanceOnce({ periods = [] } = {}) {
    if (this.pendingCommit) await this.commit();
    if (!this.engine) {
      try { await this.initialize(); }
      catch (error) { this.state = null; this.engine = null; throw error; }
    }
    const now = this.now();
    const states = new Map(this.state.periods.map((entry) => [entry.period, structuredClone(entry)]));
    const anchorPeriod = this.state.anchor?.period;
    const inScope = (period) => period && (!anchorPeriod || compareIssuesAsc(period, anchorPeriod) > 0);
    const batch = await this.store.historyAfter(this.state.scanThrough);
    for (const record of batch.records) if (inScope(record.issueNumber)) this.records.set(record.issueNumber, record);
    const due = [...states.values()].filter((entry) => entry.status === PERIOD_STATUS.PENDING_RESULT && entry.nextRetryAt <= now);
    const stored = await this.store.signalsSince(this.signalCursor);
    for (const signal of stored.signals) this.signals.set(signal.period_id, signal);
    this.signalCursor = stored.through;
    const candidates = new Set([
      ...this.records.keys(), ...this.signals.keys(), ...periods, ...due.map((entry) => entry.period),
    ].filter(inScope));
    const active = await this.currentIssue();
    if (inScope(active)) candidates.add(active);
    // Missing issue IDs carry no invented outcomes. Persist them as pending,
    // including historical holes; scanThrough is not the finalized checkpoint.
    const observed = [...new Set([anchorPeriod, ...candidates].filter(Boolean))].sort(compareIssuesAsc);
    for (let i = 1; i < observed.length; i++) {
      let period;
      try { period = nextPeriod(observed[i - 1]); } catch { continue; }
      let count = 0;
      while (period && compareIssuesAsc(period, observed[i]) < 0) {
        if (++count > 1_000_000) throw new Error('History gap exceeds ledger scan limit.');
        if (inScope(period)) candidates.add(period);
        period = nextPeriod(period);
      }
    }
    const fetched = new Map();
    for (const period of [...candidates].sort(compareIssuesAsc)) {
      const previous = states.get(period);
      if (terminal(previous)) continue;
      const newlyFinalized = batch.records.some((record) => record.issueNumber === period);
      if (previous?.nextRetryAt > now && !newlyFinalized) continue;
      const inputs = await this.store.periodInputs(period);
      fetched.set(period, inputs);
      if (finalizedActual(period, inputs)) this.records.set(period, inputs.record);
      else this.records.delete(period);
    }
    const predictions = this.predictorInputs();
    for (const [period, inputs] of fetched) {
      const signal = finalizedActual(period, inputs) && finalizedT7(inputs.signal, inputs.record) ? inputs.signal.signal : null;
      const input = { ...predictions.get(period), period, t7pred: signal === 'BIG' ? 'Big' : signal === 'SMALL' ? 'Small' : null };
      const entry = classifyPeriod(period, inputs, input);
      if (entry.status === PERIOD_STATUS.PENDING_RESULT) {
        const attempts = (states.get(period)?.attempts ?? 0) + 1;
        Object.assign(entry, { attempts, nextRetryAt: now + Math.min(300_000, 5000 * 2 ** Math.min(attempts - 1, 6)) });
      } else {
        Object.assign(entry, { recordDigest: digest(inputs.record), input, evaluatedAt: new Date(now).toISOString() });
      }
      states.set(period, entry);
      this.log(`[ADAPTIVE] period=${period} tests=${entry.contributingTests.join(',')} records=${entry.validRecordCount} status=${entry.status} reason=${entry.reason}`);
    }
    const entries = ordered(states.values());
    if (this.state.ledgerDigest && digest(entries) === digest(this.state.periods)) {
      this.prepareNextPrediction(this.engine, active);
      this.publish();
      return this.body;
    }
    const engine = this.replay(entries);
    for (const entry of entries) if (entry.status === PERIOD_STATUS.ELIGIBLE) {
      entry.status = PERIOD_STATUS.EVALUATED;
      entry.reason = 'Eligible period evaluated; model and status persisted together.';
    }
    this.prepareNextPrediction(engine, active);
    let safePeriod = anchorPeriod ?? null;
    for (const entry of entries) {
      if (!terminal(entry)) break;
      safePeriod = entry.period;
    }
    const state = { ...this.state, periods: entries, period: safePeriod,
      scanThrough: [...this.records.keys()].sort(compareIssuesAsc).at(-1) ?? this.state.scanThrough,
      model: this.modelSummary(engine), checkpointAt: new Date(now).toISOString() };
    delete state.ledgerDigest;
    state.ledgerDigest = digest(state);
    this.pendingCommit = { state, engine };
    await this.commit();
    return this.body;
  }
}
