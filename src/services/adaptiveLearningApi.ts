import type { ActiveInputRow, AdaptiveResult, AdaptiveHistoryRow, ActivePrediction } from '../hooks/useAdaptiveLearning';

export const ADAPTIVE_LEARNING_URL = import.meta.env?.VITE_ADAPTIVE_LEARNING_URL?.trim()
  || 'https://adaptive.random9111.sbs/api/adaptive-learning/current';
export const ADAPTIVE_STALE_AFTER_MS = 90_000;

export interface AdaptiveSnapshot extends Omit<AdaptiveResult, 'history' | 'resetLearning'> {
  success: true;
  version: string;
  signalLabels: [string, string, string];
  signals: ActiveInputRow | null;
  latestEvaluation: AdaptiveHistoryRow | null;
  status: 'ready';
  checkpointAt: string;
  adaptiveInputMode: string;
  adaptiveRequiredSignals: ['T3', 'T9'];
  adaptiveOptionalSignals: ['T7'];
  t7AvailableForAdaptive: boolean;
  adaptiveBlocked: boolean;
  adaptiveWeights: [number, number];
  adaptiveDominantSignalIndex: 0 | 1;
  /** Adaptive replay checkpoint counters; never the independent Verified Max Loss metric. */
  test3MaxLoss: number;
  test7MaxLoss: number;
  test9MaxLoss: number;
}

export interface AdaptiveApiState {
  data: AdaptiveSnapshot | null;
  status: 'loading' | 'ready' | 'stale' | 'error' | 'waiting_for_t7' | 'waiting_for_history';
  stale: boolean;
  error: string | null;
  receivedAt: number | null;
  maxLoss: VerifiedMaxLoss | null;
  pendingPeriod: string | null;
}

export interface VerifiedMaxLoss {
  test3: number;
  test7: number;
  test9: number;
  coverage: 'partial' | 'complete';
  coverageReason: string | null;
  firstMissingHistoryPeriod: string | null;
  lastMissingHistoryPeriod: string | null;
  knownThrough: string | null;
  scopeStartPeriod: string | null;
  calculatedAt: string;
  calculationStatus: 'calculating' | 'ready';
}

export const INITIAL_ADAPTIVE_API_STATE: AdaptiveApiState = {
  data: null, status: 'loading', stale: false, error: null, receivedAt: null, maxLoss: null, pendingPeriod: null,
};

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function size(value: unknown): boolean { return value === 'Big' || value === 'Small'; }
function optionalSize(value: unknown): boolean { return value === null || size(value); }
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function numberIn(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
}
function count(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return numberIn(value, max) && Number.isInteger(value);
}
function weights(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((v) => numberIn(v, 1))
    && Math.abs(value.reduce((sum, v) => sum + v, 0) - 1) < 0.000001;
}
function prediction(value: unknown): value is ActivePrediction {
  return object(value) && text(value.period) && size(value.decision)
    && numberIn(value.probBig, 100) && numberIn(value.probSmall, 100)
    && Math.abs(value.probBig + value.probSmall - 100) < 0.11
    && count(value.signalsAvailable, 3) && weights(value.weights);
}
function evaluation(value: unknown): value is AdaptiveHistoryRow {
  return object(value) && prediction({ ...value, decision: value.adaptiveDecision })
    && size(value.actual) && value.t4pred === value.adaptiveDecision && typeof value.isHit === 'boolean'
    && ['t3pred', 't7pred', 't9pred'].every((key) => optionalSize(value[key]));
}
function adaptiveWeights(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every((v) => numberIn(v, 1))
    && Math.abs(value.reduce((sum, v) => sum + v, 0) - 1) < 0.000001;
}

/** Independent metric validation; a waiting Adaptive response is not a model snapshot. */
export function parseVerifiedMaxLoss(value: unknown): VerifiedMaxLoss {
  if (!object(value) || !['test3', 'test7', 'test9'].every((field) => count(value[field]))
    || !['partial', 'complete'].includes(String(value.coverage))
    || !['calculating', 'ready'].includes(String(value.calculationStatus))
    || !text(value.calculatedAt) || !Number.isFinite(Date.parse(value.calculatedAt))
    || !['coverageReason', 'firstMissingHistoryPeriod', 'lastMissingHistoryPeriod', 'knownThrough', 'scopeStartPeriod']
      .every((field) => value[field] === null || text(value[field]))) {
    throw new Error('Malformed verified Max Loss response.');
  }
  return {
    test3: value.test3 as number, test7: value.test7 as number, test9: value.test9 as number,
    coverage: value.coverage as VerifiedMaxLoss['coverage'], coverageReason: value.coverageReason as string | null,
    firstMissingHistoryPeriod: value.firstMissingHistoryPeriod as string | null,
    lastMissingHistoryPeriod: value.lastMissingHistoryPeriod as string | null,
    knownThrough: value.knownThrough as string | null, scopeStartPeriod: value.scopeStartPeriod as string | null,
    calculatedAt: value.calculatedAt, calculationStatus: value.calculationStatus as VerifiedMaxLoss['calculationStatus'],
  };
}

/** Validate the compact contract; never fill missing predictions/stats with local calculations. */
export function parseAdaptiveSnapshot(value: unknown): AdaptiveSnapshot {
  const malformed = () => { throw new Error('Malformed Adaptive Learning response.'); };
  if (!object(value)) return malformed();
  if (value.success === false) throw new Error('Adaptive Learning server is not ready.');
  if (value.success !== true || value.status !== 'ready' || !text(value.version)
    || !text(value.checkpointAt) || !Number.isFinite(Date.parse(value.checkpointAt))
    || !Array.isArray(value.signalLabels) || value.signalLabels.join('|') !== 'Test 3|Test 7|Test 9'
    || value.adaptiveInputMode !== 'adaptive-t3-t9-v1'
    || !Array.isArray(value.adaptiveRequiredSignals) || value.adaptiveRequiredSignals.join('|') !== 'T3|T9'
    || !Array.isArray(value.adaptiveOptionalSignals) || value.adaptiveOptionalSignals.join('|') !== 'T7'
    || typeof value.t7AvailableForAdaptive !== 'boolean' || typeof value.adaptiveBlocked !== 'boolean'
    || !adaptiveWeights(value.adaptiveWeights) || !count(value.adaptiveDominantSignalIndex, 1)
    || !optionalSize(value.finalDecision) || !weights(value.weights)) return malformed();

  if (value.activePrediction !== null && !prediction(value.activePrediction)) return malformed();
  if (value.latestEvaluation !== null && !evaluation(value.latestEvaluation)) return malformed();
  if (value.signals !== null && (!object(value.signals) || !text(value.signals.period)
    || !['t3pred', 't7pred', 't9pred'].every((key) => optionalSize((value.signals as Record<string, unknown>)[key])))) return malformed();
  if (value.activePrediction && (!object(value.signals) || value.signals.period !== (value.activePrediction as ActivePrediction).period)) return malformed();

  const counts = ['totalPredictions', 'totalHits', 'totalMisses', 'currentHitStreak', 'currentMissStreak', 'longestHitStreak', 'longestMissStreak', 'test3MaxLoss', 'test7MaxLoss', 'test9MaxLoss'];
  if (!counts.every((key) => count(value[key])) || !numberIn(value.accuracyPct, 100)
    || (value.totalHits as number) + (value.totalMisses as number) !== value.totalPredictions) return malformed();
  for (const [key, max] of [['last20', 20], ['last50', 50], ['last100', 100], ['last250', 250]] as const) {
    const window = value[key];
    if (!object(window) || !count(window.total, max) || !count(window.hits, window.total)) return malformed();
  }
  const agreement = value.lastSignalAgreement;
  if (!object(agreement) || !count(agreement.bigVotes, 3) || !count(agreement.smallVotes, 3)
    || !count(agreement.total, 3) || agreement.bigVotes + agreement.smallVotes !== agreement.total
    || !optionalSize(agreement.majority)) return malformed();
  if (value.dominantSignalIndex !== undefined && !count(value.dominantSignalIndex, 2)) return malformed();

  // The index is presentation-only; some deployed responses omit it.
  const dominantSignalIndex = value.dominantSignalIndex ?? value.weights.indexOf(Math.max(...value.weights));
  // Select fields explicitly: even an accidental history field must not enter React state.
  return {
    success: true, status: 'ready', version: value.version, checkpointAt: value.checkpointAt,
    signalLabels: value.signalLabels as AdaptiveSnapshot['signalLabels'],
    finalDecision: value.finalDecision as AdaptiveSnapshot['finalDecision'],
    activePrediction: value.activePrediction as AdaptiveSnapshot['activePrediction'],
    signals: value.signals as AdaptiveSnapshot['signals'],
    latestEvaluation: value.latestEvaluation as AdaptiveSnapshot['latestEvaluation'],
    adaptiveInputMode: value.adaptiveInputMode,
    adaptiveRequiredSignals: ['T3', 'T9'], adaptiveOptionalSignals: ['T7'],
    t7AvailableForAdaptive: value.t7AvailableForAdaptive, adaptiveBlocked: value.adaptiveBlocked,
    adaptiveWeights: value.adaptiveWeights, adaptiveDominantSignalIndex: value.adaptiveDominantSignalIndex as 0 | 1,
    weights: value.weights, dominantSignalIndex: dominantSignalIndex as number,
    totalPredictions: value.totalPredictions as number, totalHits: value.totalHits as number,
    totalMisses: value.totalMisses as number, accuracyPct: value.accuracyPct,
    currentHitStreak: value.currentHitStreak as number, currentMissStreak: value.currentMissStreak as number,
    longestHitStreak: value.longestHitStreak as number, longestMissStreak: value.longestMissStreak as number,
    test3MaxLoss: value.test3MaxLoss as number, test7MaxLoss: value.test7MaxLoss as number, test9MaxLoss: value.test9MaxLoss as number,
    last20: value.last20 as AdaptiveSnapshot['last20'], last50: value.last50 as AdaptiveSnapshot['last50'],
    last100: value.last100 as AdaptiveSnapshot['last100'], last250: value.last250 as AdaptiveSnapshot['last250'],
    lastSignalAgreement: agreement as unknown as AdaptiveSnapshot['lastSignalAgreement'],
  };
}

export function isAdaptiveSnapshotStale(data: AdaptiveSnapshot, now = Date.now()): boolean {
  const age = now - Date.parse(data.checkpointAt);
  return age > ADAPTIVE_STALE_AFTER_MS || age < -30_000;
}

/** One request at a time. Polling and in-flight work are both cancelled on disposal. */
export function startAdaptiveLearningPolling(
  onUpdate: (state: AdaptiveApiState) => void,
  { url = ADAPTIVE_LEARNING_URL, fetcher = fetch, now = Date.now }:
    { url?: string; fetcher?: typeof fetch; now?: () => number } = {},
): () => void {
  let disposed = false;
  let state = { ...INITIAL_ADAPTIVE_API_STATE };
  let nextPoll: ReturnType<typeof setTimeout> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;

  function publish() {
    if (disposed) return;
    const stale = state.data ? isAdaptiveSnapshotStale(state.data, now()) : false;
    const waiting = state.status === 'waiting_for_t7' || state.status === 'waiting_for_history';
    state = { ...state, stale, status: state.error ? 'error' : waiting ? state.status : state.data ? (stale ? 'stale' : 'ready') : 'loading' };
    onUpdate(state);
  }

  async function poll() {
    controller = new AbortController();
    let timedOut = false;
    timeout = setTimeout(() => { timedOut = true; controller?.abort(); }, 4000);
    try {
      const response = await fetcher(url, {
        method: 'GET', headers: { Accept: 'application/json' }, credentials: 'omit',
        cache: 'no-store', signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Adaptive Learning API unavailable (HTTP ${response.status}).`);
      let payload: unknown;
      try { payload = await response.json(); }
      catch { throw new Error('Malformed Adaptive Learning response: invalid JSON.'); }
      if (disposed) return;
      if (timedOut) throw new Error('Adaptive Learning request timed out.');
      const maxLoss = object(payload) && payload.maxLoss != null ? parseVerifiedMaxLoss(payload.maxLoss) : state.maxLoss;
      if (object(payload) && payload.success === false
        && (payload.status === 'waiting_for_t7' || payload.status === 'waiting_for_history')) {
        if (!text(payload.pendingPeriod)) throw new Error('Malformed Adaptive Learning waiting response.');
        state = { ...state, status: payload.status, maxLoss, pendingPeriod: payload.pendingPeriod, receivedAt: now(), error: null };
        return;
      }
      const data = parseAdaptiveSnapshot(payload);
      if (state.data && Date.parse(data.checkpointAt) < Date.parse(state.data.checkpointAt)) {
        throw new Error('Outdated Adaptive Learning response: checkpoint moved backwards.');
      }
      state = { ...state, status: 'ready', data, maxLoss, pendingPeriod: null, receivedAt: now(), error: null };
    } catch (error) {
      if (disposed) return;
      state = { ...state, error: timedOut ? 'Adaptive Learning request timed out.'
        : error instanceof Error ? error.message : 'Adaptive Learning API unavailable.' };
    } finally {
      clearTimeout(timeout);
      if (!disposed) {
        publish();
        nextPoll = setTimeout(() => { void poll(); }, 5000);
      }
    }
  }

  publish();
  void poll();
  // Age the last good snapshot even during outages or a slow response.
  const freshnessTimer = setInterval(() => {
    if (state.data && isAdaptiveSnapshotStale(state.data, now()) !== state.stale) publish();
  }, 1000);
  return () => {
    disposed = true;
    clearTimeout(nextPoll);
    clearTimeout(timeout);
    clearInterval(freshnessTimer);
    controller?.abort();
  };
}
