import { createHash } from 'node:crypto';
import { AdaptiveLearningEngine, InputRevisionError, PREVIOUS_T3_FINGERPRINT } from './adaptive-learning.js';
import { compareIssuesAsc, SOURCE_FINGERPRINT } from './adaptive-algorithms.generated.js';
import { replayCheckpoint } from './adaptive-recovery.js';
import { ADAPTIVE_INPUT_POLICY } from './adaptive-input-policy.js';

const hash = (value) => createHash('sha256').update(value).digest('hex');
// PostgreSQL JSONB reorders object keys. Integrity hashes must be order-independent
// for objects, while preserving every array/training-row order and numeric value.
function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJSON(item) ?? 'null').join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
const normalizeRecord = (row) => ({ issueNumber: row.issueNumber, winningNumber: row.winningNumber, sourceTime: row.sourceTime, createdAt: row.createdAt });
const inputHash = ({ record }) => hash(JSON.stringify({ record }));
const runtimeFields = [
  'history', 'records', 'sameDateRecords', 'weights', 'cplState', 'totalHits',
  'currentHitStreak', 'currentMissStreak', 'longestHitStreak', 'longestMissStreak',
  'predictionIndex', 'test3MissStreak', 'test7MissStreak', 'test3MaxLoss',
  'test7MaxLoss', 'test9MaxLoss', 'lastProcessedPeriod', 'lastEvaluatedAt',
  'activePrediction', 'activeSignals', 'predictedAt', 'activeCacheKey', 'inputDigest',
];
const PERMANENT_MISSING_T7_PERIOD = '20261002100050850';
const BASELINE_REASON = 'Adaptive T3+T9 mode; T7 is optional and independent';

export function finalizedT7(signal, record) {
  if (!signal || signal.period_id !== record.issueNumber || !['BIG', 'SMALL'].includes(signal.signal)) return false;
  // NULL metadata belongs to the retired source. Never reinterpret its historical inputs.
  if (signal.status == null && !signal.source && !signal.prediction_created_at && signal.algorithm_version == null) return true;
  return ['win', 'loss'].includes(signal.status) && Boolean(signal.settled_at)
    && signal.actual_number === record.winningNumber;
}

export function nextPeriod(period) {
  if (!/^\d{8}10005\d{4}$/.test(period || '')) return period ? String(BigInt(period) + 1n) : null;
  if (Number(period.slice(-4)) < 2880) return String(BigInt(period) + 1n);
  const date = new Date(`${period.slice(0, 4)}-${period.slice(4, 6)}-${period.slice(6, 8)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return `${date.toISOString().slice(0, 10).replaceAll('-', '')}100050001`;
}

function snapshot(engine) {
  const state = Object.fromEntries(runtimeFields.map((field) => [field, engine[field]]));
  state.t7Signals = [...engine.t7Signals];
  state.firstPredictions = [...engine.firstPredictions];
  return state;
}

function restore(checkpoint, log, inputPolicy = ADAPTIVE_INPUT_POLICY) {
  if (hash(canonicalJSON(checkpoint.runtime)) !== checkpoint.runtimeDigest) throw new InputRevisionError('Checkpoint runtime digest mismatch.');
  const engine = new AdaptiveLearningEngine({ log, inputPolicy });
  for (const field of runtimeFields) engine[field] = checkpoint.runtime[field];
  // The existing engine's chained digest uses the durable adapter's explicit
  // record key order, rather than JSONB's order. Restore that exact representation.
  engine.records = engine.records.map(normalizeRecord);
  engine.sameDateRecords = engine.sameDateRecords.map(normalizeRecord);
  engine.t7Signals = new Map(checkpoint.runtime.t7Signals);
  engine.firstPredictions = new Map(checkpoint.runtime.firstPredictions);
  engine.verifyRecovery(checkpoint);
  return engine;
}

/**
 * Verify durable inputs without rerunning any historical CPL/model fitting.
 * In the T3+T9 input mode T7 is optional and independent, so it never enters
 * the chained input digest and a late, pending, or changed T7 row cannot make a
 * valid checkpoint unrecoverable.
 */
function verifyInputs(engine, records, signals) {
  const prefix = records.filter((r) => !engine.lastProcessedPeriod || compareIssuesAsc(r.issueNumber, engine.lastProcessedPeriod) <= 0);
  if (!engine.lastProcessedPeriod) return;
  if (canonicalJSON(prefix) !== canonicalJSON(engine.records)) throw new InputRevisionError('Durable history differs from checkpoint inputs.');
  const map = new Map(signals.map((s) => [s.period_id, s]));
  let digest = '';
  for (const [i, record] of prefix.entries()) {
    const row = engine.history[i];
    const t7 = engine.inputPolicy.includeOptionalT7 ? map.get(record.issueNumber)?.signal : null;
    const t7pred = t7 === 'BIG' ? 'Big' : t7 === 'SMALL' ? 'Small' : null;
    if (engine.inputPolicy.includeOptionalT7 && t7pred !== row.t7pred) {
      throw new InputRevisionError(`T7 input changed after evaluation at ${record.issueNumber}; recovery required.`);
    }
    const input = { period: record.issueNumber, t3pred: row.t3pred, t7pred, t9pred: row.t9pred, actual: row.actual };
    digest = hash(digest + JSON.stringify({ record, input }));
  }
  if (digest !== engine.inputDigest) throw new InputRevisionError('Durable input digest differs from checkpoint.');
}

function checkpointState(engine) {
  const state = engine.checkpoint();
  state.adaptiveInputMode = engine.inputPolicy.id;
  state.adaptiveRequiredSignals = [...engine.inputPolicy.requiredSignals];
  state.adaptiveOptionalSignals = [...engine.inputPolicy.optionalSignals];
  state.runtime = snapshot(engine);
  state.runtimeDigest = hash(canonicalJSON(state.runtime));
  return structuredClone(state);
}

function updateSignals(engine, signals) {
  engine.setSignals(signals); // InputRevisionError remains the immutable-value guard.
  for (const signal of signals) {
    if (['BIG', 'SMALL'].includes(signal.signal)) engine.t7Signals.set(signal.period_id, signal);
  }
}

function boundaryDigest(batch) {
  // T7 is optional and independent. It must not make an Adaptive recovery
  // boundary change when a late, pending, or expired T7 row is written.
  return hash(canonicalJSON({ records: batch.records, count: batch.count }));
}

export class AdaptiveRuntime {
  constructor(store, { currentIssue, log = () => {}, replayYield = () => new Promise((resolve) => setImmediate(resolve)), inputPolicy = ADAPTIVE_INPUT_POLICY } = {}) {
    this.store = store;
    this.currentIssue = currentIssue;
    this.log = log;
    this.inputPolicy = inputPolicy;
    this.engine = null;
    this.dirty = false;
    this.checkpointAt = null;
    this.lastCheckpointPeriod = null;
    this.signalsThrough = null;
    this.recovery = false;
    this.bootstrapThrough = null;
    this.pendingEvaluation = null;
    this.phase = 'normal';
    this.recoverySession = null;
    this.recoveryPromise = null;
    this.replayYield = replayYield;
    this.advancePromise = null;
    this.recoverySequence = 0;
    this.commitPromise = null;
    this.baseline = null;
    this.baselineStartPeriod = null;
    this.pendingT7Periods = new Set();
    this.baselinePendingAfter = PERMANENT_MISSING_T7_PERIOD;
    this.baselineAfterPeriod = process.env.ADAPTIVE_BASELINE_AFTER_PERIOD === 'disabled'
      ? null : (process.env.ADAPTIVE_BASELINE_AFTER_PERIOD || PERMANENT_MISSING_T7_PERIOD);
    this.body = { success: false, status: 'initializing', checkpointStatus: 'loading' };
    this.t7AvailableForAdaptive = false;
  }

  async persist() {
    if (this.pendingEvaluation) {
      const { record, digest } = this.pendingEvaluation;
      const verified = await this.store.periodInputs(record.issueNumber);
      if (inputHash(verified) !== digest || !verified.record) {
        this.pendingEvaluation = null;
        this.dirty = false;
        this.recovery = true;
        throw new InputRevisionError(`Input digest changed during evaluation at ${record.issueNumber}.`);
      }
    }
    const state = checkpointState(this.engine);
    if (this.baseline) {
      state.baseline = { ...this.baseline, periodsIncluded: this.engine.history.length };
      this.baseline.periodsIncluded = this.engine.history.length;
      await this.store.saveBaselineCheckpoint(state);
      this.log(`[ADAPTIVE] baseline checkpoint persisted baseline_id=${this.baseline.baselineId} periods=${this.engine.history.length}`);
    } else {
      await this.store.saveCheckpoint(state);
    }
    this.checkpointAt = new Date().toISOString();
    this.lastCheckpointPeriod = state.period;
    this.dirty = false;
    this.log(`[CHECKPOINT] period=${state.period} status=saved`);
    if (this.pendingEvaluation) {
      const { record, step } = this.pendingEvaluation;
      this.log(`[ADAPTIVE] period=${record.issueNumber} status=evaluated prediction=${step.evaluated.adaptiveDecision}`);
      this.pendingEvaluation = null;
    }
  }

  setSignals(signals) {
    updateSignals(this.engine, signals);
  }

  async initialize() {
    this.log('[ADAPTIVE] baseline initialization started');
    if (this.store.loadBaselineCheckpointRecord && this.baselineAfterPeriod) {
      this.log('[ADAPTIVE] baseline checkpoint lookup key=WinGo_30S:baseline');
      const activeBaseline = await this.store.loadBaselineCheckpointRecord();
      if (activeBaseline?.state?.adaptiveInputMode === this.inputPolicy.id
        && activeBaseline?.state?.baseline?.baselineStartPeriod) {
        this.log(`[ADAPTIVE] baseline checkpoint found baseline_id=${activeBaseline.state.baseline.baselineId}`);
        await this.initializeActiveBaseline(activeBaseline);
        this.log(`[ADAPTIVE] baseline initialization completed baseline_id=${this.baseline.baselineId}`);
        return;
      }
      if (activeBaseline?.state?.baseline?.baselineStartPeriod) {
        this.log(`[ADAPTIVE] baseline checkpoint incompatible mode=${activeBaseline.state.adaptiveInputMode ?? 'legacy'}; rebuilding ${this.inputPolicy.id}`);
      }
      this.log('[ADAPTIVE] baseline checkpoint not_found');
      const legacy = await this.store.loadCheckpointRecord();
      await this.initializeNewBaseline(legacy);
      if (this.baseline) this.log(`[ADAPTIVE] baseline initialization completed baseline_id=${this.baseline.baselineId}`);
      if (this.baseline || this.baselinePendingAfter) return;
    }
    const rawSaved = await this.store.loadCheckpointRecord();
    const saved = rawSaved?.state?.adaptiveInputMode === this.inputPolicy.id ? rawSaved : null;
    if (rawSaved && !saved) this.log(`[ADAPTIVE] checkpoint incompatible mode=${rawSaved.state?.adaptiveInputMode ?? 'legacy'}; rebuilding ${this.inputPolicy.id}`);
    this.checkpointAt = saved?.updatedAt ?? null;
    this.lastCheckpointPeriod = saved?.state.period ?? null;
    const checkpoint = saved?.state;
    if (checkpoint) {
      await this.prepareRecovery(saved, 'startup');
      return;
    }
    const [batch, stored] = await Promise.all([this.store.historyAfter(), this.store.signalsSince()]);
    this.store.assertCoverage(new AdaptiveLearningEngine({ inputPolicy: this.inputPolicy }), batch);
    this.bootstrapThrough = batch.records.at(-1)?.issueNumber ?? null;
    this.engine = new AdaptiveLearningEngine({ log: this.log, inputPolicy: this.inputPolicy });
    this.setSignals(stored.signals);
    this.signalsThrough = stored.through;
    this.dirty = true;
    this.recovery = false;
  }

  async initializeActiveBaseline(saved) {
    const metadata = saved.state.baseline;
    this.log(`[ADAPTIVE] baseline validation started baseline_id=${metadata.baselineId} start=${metadata.baselineStartPeriod}`);
    const batch = await this.store.historyFrom(metadata.baselineStartPeriod);
    // since=null already reads the complete durable T7 set. Passing every
    // baseline period as pending IDs would issue redundant .in() page reads
    // and can leave startup apparently stuck for many minutes.
    const stored = await this.store.signalsSince(null);
    this.store.assertCoverage(new AdaptiveLearningEngine({ inputPolicy: this.inputPolicy }), batch);
    const candidate = restore(saved.state, this.log, this.inputPolicy);
    verifyInputs(candidate, batch.records, stored.signals);
    this.baseline = metadata;
    this.baselineStartPeriod = metadata.baselineStartPeriod;
    this.engine = candidate;
    this.setSignals(stored.signals.filter((signal) => compareIssuesAsc(signal.period_id, this.baselineStartPeriod) >= 0));
    this.signalsThrough = stored.through;
    this.checkpointAt = saved.updatedAt ?? null;
    this.lastCheckpointPeriod = candidate.lastProcessedPeriod;
    this.bootstrapThrough = this.baselineStartPeriod;
    this.pendingT7Periods.clear();
    this.phase = 'ready';
    this.recovery = false;
    this.dirty = false;
    this.log(`[BASELINE] status=loaded baseline_id=${metadata.baselineId} start=${metadata.baselineStartPeriod} periods=${metadata.periodsIncluded}`);
    this.log(`[ADAPTIVE] baseline finalized prefix periods=${candidate.history.length} cursor=${candidate.lastProcessedPeriod}`);
  }

  async initializeNewBaseline(legacyCheckpoint) {
    this.log(`[ADAPTIVE] baseline candidate scan after=${this.baselineAfterPeriod}`);
    const batch = await this.store.historyFrom(this.baselineAfterPeriod);
    const startIndex = batch.records.findIndex((record) => !this.baselineAfterPeriod
      || compareIssuesAsc(record.issueNumber, this.baselineAfterPeriod) > 0);
    if (startIndex < 0) {
      this.baselinePendingAfter = this.baselineAfterPeriod;
      this.body = { success: false, status: 'waiting_for_history', adaptiveState: 'waiting_for_history',
        pendingPeriod: batch.records[0]?.issueNumber ?? null, baselinePendingAfter: this.baselinePendingAfter,
        checkpointStatus: 'baseline_pending', databaseConnected: true, ...this.baselineState() };
      this.log(`[BASELINE] status=waiting_for_history after=${this.baselineAfterPeriod}`);
      return;
    }
    const startPeriod = batch.records[startIndex].issueNumber;
    this.log(`[ADAPTIVE] baseline candidate selected start=${startPeriod}`);
    const sourceCheckpoint = legacyCheckpoint?.state ? {
      checkpointKey: 'WinGo_30S', period: legacyCheckpoint.state.period ?? null,
      inputDigest: legacyCheckpoint.state.inputDigest ?? null,
      version: legacyCheckpoint.state.version ?? null,
    } : { checkpointKey: 'WinGo_30S', period: null, inputDigest: null, version: null };
    this.baseline = {
      baselineId: `adaptive-baseline-v2-${startPeriod}`,
      baselineVersion: 2,
      baselineStartPeriod: startPeriod,
      excludedThroughPeriod: this.baselineAfterPeriod,
      reason: BASELINE_REASON,
      createdAt: new Date().toISOString(),
      sourceCheckpoint,
      periodsIncluded: 0,
    };
    this.baselineStartPeriod = startPeriod;
    this.baselinePendingAfter = null;
    this.engine = new AdaptiveLearningEngine({ log: this.log, inputPolicy: this.inputPolicy });
    const stored = await this.store.signalsSince(null);
    this.setSignals(stored.signals.filter((signal) => compareIssuesAsc(signal.period_id, startPeriod) >= 0));
    this.signalsThrough = stored.through;
    this.bootstrapThrough = startPeriod;
    this.dirty = true;
    this.phase = 'ready';
    this.recovery = false;
    this.log(`[BASELINE] status=created baseline_id=${this.baseline.baselineId} start=${startPeriod} reason=${this.baseline.reason}`);
  }

  async historyBatch(cursor = null) {
    if (this.baseline && this.store.historyFrom) return this.store.historyFrom(this.baselineStartPeriod, cursor);
    return this.store.historyAfter(cursor);
  }

  baselineState() {
    const included = this.engine?.history.length ?? 0;
    const pending = [...this.pendingT7Periods].sort(compareIssuesAsc);
    return {
      adaptiveInputMode: this.inputPolicy.id,
      adaptiveRequiredSignals: [...this.inputPolicy.requiredSignals],
      adaptiveOptionalSignals: [...this.inputPolicy.optionalSignals],
      t7AvailableForAdaptive: this.t7AvailableForAdaptive,
      baselineId: this.baseline?.baselineId ?? null,
      baselineStartPeriod: this.baseline?.baselineStartPeriod ?? null,
      baselineReason: this.baseline?.reason ?? null,
      baselinePeriodsIncluded: included,
      adaptiveCursor: this.engine?.lastProcessedPeriod ?? null,
      pendingT7Count: pending.length,
      oldestPendingT7: pending[0] ?? null,
      t7Coverage: this.baseline ? 'independent' : 'not_required',
      adaptiveBlocked: this.phase !== 'ready',
    };
  }

  currentBody() {
    return { ...this.engine.current(), status: 'ready', checkpointAt: this.checkpointAt,
      checkpointStatus: 'saved', databaseConnected: true, adaptiveState: 'ready', ...this.baselineState() };
  }

  /** Called only while server.js holds the ingestion lock. No replay runs here. */
  async captureBoundary() {
    const read = async () => {
      const batch = await this.store.historyAfter();
      this.store.assertCoverage(new AdaptiveLearningEngine({ inputPolicy: this.inputPolicy }), batch);
      const stored = await this.store.signalsSince(null, batch.records.map((record) => record.issueNumber));
      return { batch, stored };
    };
    const first = await read();
    const second = await read();
    if (boundaryDigest(first.batch) !== boundaryDigest(second.batch)) {
      throw new Error('Recovery snapshot changed during capture; awaiting a stable durable boundary.');
    }
    return structuredClone({ ...second, digest: boundaryDigest(second.batch),
      highWater: second.batch.records.at(-1)?.issueNumber ?? null });
  }

  async prepareRecovery(saved, reason) {
    if (this.recoverySession) return;
    const checkpoint = saved?.state;
    if (checkpoint && ![SOURCE_FINGERPRINT, PREVIOUS_T3_FINGERPRINT].includes(checkpoint.version)) {
      throw new InputRevisionError('Checkpoint algorithm version differs from browser sources.');
    }
    // Integrity failures are terminal, not a reason to replace a corrupt checkpoint.
    const original = checkpoint?.runtime ? restore(checkpoint, this.log, this.inputPolicy) : null;
    const boundary = await this.captureBoundary();
    if (original && canonicalJSON(boundary.batch.records.filter((r) => compareIssuesAsc(r.issueNumber, checkpoint.period) <= 0))
      !== canonicalJSON(original.records)) throw new InputRevisionError('History revision cannot be recovered as a T7 revision.');
    if (checkpoint?.period && !boundary.batch.records.some((r) => r.issueNumber === checkpoint.period)) {
      throw new InputRevisionError('Checkpoint period is missing from Supabase history.');
    }
    const earliestAffectedPeriod = original
      ? null
      : checkpoint?.period ? boundary.batch.records[0]?.issueNumber ?? null : null;
    this.recoverySession = { id: ++this.recoverySequence, reason, saved: structuredClone(saved), original,
      boundary, earliestAffectedPeriod, candidate: null, index: 0, preparedState: null, pendingPeriod: null,
      replayCursor: boundary.batch.records[0]?.issueNumber ?? null, replayProcessed: 0,
      replayTotal: boundary.batch.records.length, replayHighWater: boundary.highWater,
      waitingStatus: null, lastProgressLog: -1 };
    this.recovery = true;
    this.phase = 'recovering';
    this.body = this.recoveryBody('recovering');
    this.log(`[RECOVERY] status=started reason=${reason} recovery_id=${this.recoverySequence} high_water=${boundary.highWater} earliest_affected=${earliestAffectedPeriod} snapshot_digest=${boundary.digest}`);
  }

  recoveryBody(status, error) {
    return { success: false, status, adaptiveState: this.phase, error,
      adaptiveInputMode: this.inputPolicy.id,
      adaptiveRequiredSignals: [...this.inputPolicy.requiredSignals],
      adaptiveOptionalSignals: [...this.inputPolicy.optionalSignals],
      t7AvailableForAdaptive: this.t7AvailableForAdaptive,
      adaptiveBlocked: true,
      latestEvaluatedPeriod: this.lastCheckpointPeriod, checkpointAt: this.checkpointAt,
      checkpointStatus: this.recoverySession?.preparedState ? 'pending_retry' : 'recovery_held',
      pendingPeriod: this.recoverySession?.pendingPeriod ?? null,
      recoveryId: this.recoverySession?.id, recoveryHighWater: this.recoverySession?.boundary.highWater,
      observedHighWater: this.recoverySession?.observedHighWater ?? this.recoverySession?.boundary.highWater,
      earliestAffectedPeriod: this.recoverySession?.earliestAffectedPeriod ?? null,
      replayCursor: this.recoverySession?.replayCursor ?? null,
      replayProcessed: this.recoverySession?.replayProcessed ?? 0,
      replayTotal: this.recoverySession?.replayTotal ?? 0,
      replayHighWater: this.recoverySession?.replayHighWater ?? null,
      recoveryPhase: this.phase, databaseConnected: true };
  }

  /** One retained replay promise. Operates only on private snapshot objects. */
  runRecovery() {
    if (this.recoveryPromise) return this.recoveryPromise;
    if (!this.recoverySession || this.phase === 'recovery_failed') return Promise.resolve(this.body);
    this.recoveryPromise = this.replayRecovery().catch((error) => {
      this.phase = 'recovery_failed';
      this.body = this.recoveryBody('recovery_required', error.message);
      this.log(`[RECOVERY] status=recovery_failed detail=${error.message}`);
      return this.body;
    }).finally(() => { this.recoveryPromise = null; });
    return this.recoveryPromise;
  }

  async replayRecovery() {
    const session = this.recoverySession;
    if (session.preparedState) return this.body;
    this.phase = 'recovering';
    const { batch, stored } = session.boundary;
    if (boundaryDigest(batch) !== session.boundary.digest) throw new InputRevisionError('Frozen recovery boundary digest changed.');
    const checkpoint = session.saved?.state;
    if (!session.candidate) {
      let candidate = session.original;
      if (candidate && !session.earliestAffectedPeriod) {
        verifyInputs(candidate, batch.records, stored.signals);
      } else if (!candidate && checkpoint) {
        // A valid legacy checkpoint preserves its validated historical NO_SIGNAL
        // prefix. A stale legacy checkpoint has no earlier resumable checkpoint:
        // rebuild from genesis using only finalized inputs, never timestamp guesses.
        try { ({ candidate } = replayCheckpoint(batch.records, stored.signals, checkpoint, this.log, this.inputPolicy)); }
        catch (error) {
          if (!(error instanceof InputRevisionError)) throw error;
          this.log(`[RECOVERY] status=revision_detected reason=legacy_digest_mismatch earliest_affected=${session.earliestAffectedPeriod} strategy=full_chronological_replay`);
        }
      } else if (session.earliestAffectedPeriod) candidate = null;
      session.candidate = candidate ?? new AdaptiveLearningEngine({ log: this.log, inputPolicy: this.inputPolicy });
      session.index = session.candidate.records.length;
      session.safePeriod = candidate?.lastProcessedPeriod ?? null;
      session.replayProcessed = session.index;
      session.replayCursor = batch.records[session.index]?.issueNumber ?? null;
      session.lastProgressLog = session.replayProcessed;
      this.log(`[RECOVERY] recovery_id=${session.id} strategy=${candidate ? 'verified_checkpoint' : 'full_chronological_replay'} safe_period=${session.safePeriod}`);
    }
    const candidate = session.candidate;
    updateSignals(candidate, stored.signals);
    session.pendingPeriod = null;
    while (session.index < batch.records.length) {
      const record = batch.records[session.index];
      session.replayCursor = record.issueNumber;
      this.log(`[RECOVERY] recovery_id=${session.id} phase=replay_input period=${record.issueNumber} input_policy=${this.inputPolicy.id}`);
      const expected = nextPeriod(candidate.lastProcessedPeriod);
      // Preserve known historical gaps, but never skip a newly missing predecessor.
      if (expected && (!checkpoint?.period || compareIssuesAsc(record.issueNumber, checkpoint.period) > 0)
        && record.issueNumber !== expected) {
        session.pendingPeriod = expected;
        session.waitingStatus = 'waiting_for_history';
        this.phase = 'waiting_for_history';
        this.logReplayProgress('waiting_for_history');
        break;
      }
      const before = inputHash({ record });
      candidate.settle(record, { quiet: true });
      if (before !== inputHash({ record })) throw new InputRevisionError(`Recovery snapshot digest changed at ${record.issueNumber}.`);
      session.index++;
      session.replayProcessed = session.index;
      session.replayCursor = batch.records[session.index]?.issueNumber ?? null;
      this.logReplayProgress('replaying');
      await this.replayYield({ recoveryId: session.id, period: record.issueNumber });
    }
    if (checkpoint?.period && (!candidate.lastProcessedPeriod || compareIssuesAsc(candidate.lastProcessedPeriod, checkpoint.period) < 0)) {
      this.phase = 'waiting_for_history';
      this.body = this.recoveryBody(session.waitingStatus ?? 'waiting_for_history');
      return this.body; // Keep the old checkpoint and the partial candidate intact.
    }
    if (checkpoint) candidate.firstPredictions = new Map(checkpoint.firstPredictions ?? []);
    verifyInputs(candidate, batch.records.slice(0, session.index), stored.signals);
    session.preparedState = checkpointState(candidate);
    session.replayProcessed = session.index;
    session.replayCursor = null;
    this.logReplayProgress('replay_complete');
    this.body = this.recoveryBody('recovering');
    return this.body;
  }

  /** Extend only a paused session's unevaluated suffix under the collector lock. */
  async refreshRecovery() {
    const session = this.recoverySession;
    if (!session || session.preparedState || this.phase !== 'waiting_for_history') return;
    if (session.pendingPeriod && !(await this.store.periodInputs(session.pendingPeriod)).record) return this.body;
    const pending = session.boundary.batch.records.slice(session.index).map((record) => record.issueNumber);
    const read = async () => {
      const [batch, stored] = await Promise.all([
        this.store.historyAfter(session.boundary.highWater),
        this.store.signalsSince(session.boundary.stored.through, pending),
      ]);
      this.store.assertCoverage({ history: session.boundary.batch.records }, batch);
      return { batch, stored };
    };
    const first = await read(); const second = await read();
    if (boundaryDigest(first.batch) !== boundaryDigest(second.batch)) {
      throw new Error('Recovery suffix changed during capture; retaining the same paused recovery.');
    }
    // The original high-water mark is fixed for the life of this recovery.
    // Complete only its unevaluated inputs; newly collected periods are catch-up.
    session.observedHighWater = second.batch.records.at(-1)?.issueNumber ?? session.boundary.highWater;
    session.boundary.stored = { signals: second.stored.signals, through: second.stored.through };
    session.boundary.digest = boundaryDigest(session.boundary.batch);
    this.phase = 'recovering';
    session.waitingStatus = null;
    this.body = this.recoveryBody('recovering');
    this.log(`[RECOVERY] status=resumed recovery_id=${session.id} high_water=${session.boundary.highWater} observed_high_water=${session.observedHighWater}`);
  }

  logReplayProgress(phase) {
    const session = this.recoverySession;
    if (!session || session.replayProcessed === session.lastProgressLog && phase === 'replaying') return;
    session.lastProgressLog = session.replayProcessed;
    this.log(`[RECOVERY] recovery_id=${session.id} phase=${phase} replayCursor=${session.replayCursor ?? 'none'} replayProcessed=${session.replayProcessed} replayTotal=${session.replayTotal} replayHighWater=${session.replayHighWater}`);
  }

  /** Checkpoint then atomically promote; never assign the active engine before ACK. */
  commitRecovery() {
    if (this.commitPromise) return this.commitPromise;
    this.commitPromise = this.commitRecoveryOnce().finally(() => { this.commitPromise = null; });
    return this.commitPromise;
  }

  async commitRecoveryOnce() {
    const session = this.recoverySession;
    if (!session?.preparedState || this.phase === 'recovery_failed') return this.body;
    try {
      if (boundaryDigest(session.boundary.batch) !== session.boundary.digest) {
        throw new InputRevisionError('Recovery boundary digest changed before promotion.');
      }
      const durable = await this.store.loadCheckpointRecord();
      if (durable?.state.runtimeDigest !== session.preparedState.runtimeDigest) {
        await this.store.saveCheckpoint(session.preparedState);
        this.log(`[CHECKPOINT] period=${session.preparedState.period} status=saved recovery_id=${session.id}`);
      }
      this.engine = session.candidate;
      this.checkpointAt = new Date().toISOString();
      this.lastCheckpointPeriod = this.engine.lastProcessedPeriod;
      this.signalsThrough = session.boundary.stored.through;
      this.bootstrapThrough = session.saved?.state.period ?? session.boundary.highWater;
      this.dirty = false;
      this.pendingEvaluation = null;
      this.recovery = false;
      this.phase = 'ready';
      this.recoverySession = null;
      this.body = { ...this.engine.current(), status: 'ready', adaptiveState: 'ready', checkpointAt: this.checkpointAt,
        checkpointStatus: 'saved', databaseConnected: true };
      this.log(`[RECOVERY] status=promoted recovery_id=${session.id} replayProcessed=${session.replayProcessed} replayTotal=${session.replayTotal}`);
      this.log(`[RECOVERY] status=completed recovery_id=${session.id} period=${this.engine.lastProcessedPeriod} checkpoint=verified`);
    } catch (error) {
      if (error instanceof InputRevisionError) this.phase = 'recovery_failed';
      this.body = this.recoveryBody(error instanceof InputRevisionError ? 'recovery_required' : 'recovering', error.message);
    }
    return this.body;
  }

  advance(inputs = {}) {
    if (this.advancePromise) return this.advancePromise;
    this.advancePromise = this.advanceOnce(inputs).finally(() => { this.advancePromise = null; });
    return this.advancePromise;
  }

  async advanceOnce({ periods = [] } = {}) {
    let stage = 'database';
    try {
      if (this.phase === 'recovery_failed') return this.body;
      if (this.recoverySession) {
        await this.refreshRecovery();
        return this.body;
      }
      // A failed/ambiguous checkpoint write is retried identically before more learning.
      if (this.dirty) await this.persist();
      if (!this.engine) { stage = 'recovery_capture'; await this.initialize(); }
      if (!this.engine) return this.body;
      if (this.recoverySession) return this.body;
      if (this.recovery) {
        stage = 'recovery_capture';
        await this.prepareRecovery(await this.store.loadCheckpointRecord(), 'input_revision');
        return this.body;
      }
      if (this.dirty) await this.persist();
      stage = 'database';
      const batch = await this.historyBatch(this.engine.lastProcessedPeriod);
      this.store.assertCoverage(this.engine, batch);
      const stored = await this.store.signalsSince(this.signalsThrough, [...periods, ...batch.records.map((r) => r.issueNumber)]);
      try { this.setSignals(stored.signals); }
      catch (error) {
        if (!(error instanceof InputRevisionError)) throw error;
        this.recovery = true;
        this.log(`[RECOVERY] status=revision_detected detail=${error.message}`);
        throw error;
      }
      this.signalsThrough = stored.through;
      for (const record of batch.records) {
        const expected = nextPeriod(this.engine.lastProcessedPeriod);
        // Historical date/sequence gaps in an existing prefix keep their original math.
        // New holes (including midnight) wait for the durable predecessor.
        if (expected && (!this.bootstrapThrough || compareIssuesAsc(record.issueNumber, this.bootstrapThrough) > 0)
          && record.issueNumber !== expected) return this.wait('waiting_for_history', expected);
        const inputs = await this.store.periodInputs(record.issueNumber);
        if (!inputs.record) return this.wait('waiting_for_history', record.issueNumber);
        if (JSON.stringify(inputs.record) !== JSON.stringify(record)) throw new InputRevisionError(`History input changed before evaluation at ${record.issueNumber}.`);
        if (inputs.signal) this.setSignals([inputs.signal]);
        this.t7AvailableForAdaptive = Boolean(inputs.signal?.signal && inputs.signal.status !== 'pending');
        const digest = inputHash(inputs);
        this.log(`[ADAPTIVE] period=${record.issueNumber} status=ready input_policy=${this.inputPolicy.id} t7_available=${this.t7AvailableForAdaptive} digest=${digest}`);
        const step = this.engine.settle(record);
        this.dirty = true;
        // Retain the computed row across a failed verification/write: retries
        // reverify and checkpoint it, never run its learning update a second time.
        this.pendingEvaluation = { record, digest, step };
        await this.persist();
      }
      stage = 'schedule';
      const active = await this.currentIssue();
      const activeT7 = this.engine.t7Signals.get(active);
      this.t7AvailableForAdaptive = Boolean(activeT7?.signal && activeT7.status !== 'pending');
      if (this.engine.predict(active)) {
        stage = 'database';
        this.dirty = true;
        await this.persist();
        this.log(`[ADAPTIVE] period=${active} status=prediction_generated prediction=${this.engine.activePrediction.decision}`);
      }
      this.phase = 'ready';
      this.body = this.currentBody();
      this.body.adaptiveState = this.phase;
    } catch (error) {
      const revision = error instanceof InputRevisionError;
      if (revision) this.recovery = true;
      if (revision && this.baseline) this.phase = 'recovery_failed';
      if (revision) this.phase = (stage === 'recovery_capture' || (!this.engine && !this.recoverySession) || this.recoverySession)
        ? 'recovery_failed' : this.baseline ? 'recovery_failed' : 'recovering';
      if (!revision && !this.engine) this.phase = 'error';
      this.body = { success: false, status: revision || this.recovery ? 'recovery_required' : 'error',
        error: error.message, latestEvaluatedPeriod: this.lastCheckpointPeriod,
        checkpointAt: this.checkpointAt, checkpointStatus: this.dirty ? 'pending_retry' : this.engine ? 'saved' : 'error',
        databaseConnected: stage === 'schedule' || revision, adaptiveState: this.phase, ...this.baselineState() };
      if (stage === 'recovery_capture') this.log(`[ADAPTIVE] baseline initialization failed detail=${error.message}`);
      this.log(`[${revision ? 'RECOVERY' : 'ADAPTIVE'}] status=${this.body.status} detail=${error.message}`);
    }
    return this.body;
  }

  wait(status, period) {
    this.phase = status;
    this.log(`[ADAPTIVE] period=${period} status=${status}`);
    this.body = { success: false, status, pendingPeriod: period, latestEvaluatedPeriod: this.engine.lastProcessedPeriod,
      checkpointAt: this.checkpointAt, checkpointStatus: 'saved', databaseConnected: true, adaptiveState: this.phase,
      ...this.baselineState() };
    return this.body;
  }
}
