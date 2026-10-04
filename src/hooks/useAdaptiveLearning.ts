/**
 * useAdaptiveLearning — Adaptive Learning Main Decision Engine
 *
 * Learns from the active input signals: Tests 3, 7, 9.
 * Generates the MAIN ADAPTIVE DECISION (BIG / SMALL).
 *
 * Optimization (this session):
 * ── Top-level guard: the expensive full deterministic replay is only ever
 *     computed when something that actually influences the result changed.
 *     Inputs, the active period, the processed-period set and the persisted
 *     streak records are the only things that change the output, so every
 *     other re-render short-circuits the memo body.  For a real feed
 *     (~2,800+ history rows) that keeps the main thread free on every 5s tick.
 * ── Stable dependencies: the memo dep array holds only the values the output
 *     derives from (instead of the entire weights array).  The array reference
 *     is stable between mutations, so a render that only changed e.g. a weight
 *     display value does not force a full replay.
 * • Deterministic replay from scratch: unchanged.
 * • Persistence: unchanged.
 * • Anti-leakage / coverage: unchanged.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { compareIssuesAsc } from '../context/RealHistoryContext';

// ─── Constants ────────────────────────────────────────────────────────────────

const LEARNING_RATE = 0.05;
const N_SIGNALS = 3;
const INITIAL_WEIGHT = 1 / N_SIGNALS;
const MIN_WEIGHT = 0.01;
const STORAGE_KEY = 'wingo_adaptive_model_v6';
const LEGACY_STORAGE_KEY = 'wingo_test4_model_v4';
/** v5 stored the retired seven-slot signal layout; retired slots are not reused. */
const PREV_SIGNAL_STORAGE_KEY = 'wingo_adaptive_model_v5';
/** Preserve T3/T7 weights; the new T9 slot starts at its equal weight. */
const PREV_SIGNAL_INDICES = [2, 5];
/** Active-period predictions persisted by exact period ID (audit / settlement record). */
const ACTIVE_PREDICTION_KEY = 'wingo_adaptive_next_v1';
const ACTIVE_PREDICTION_MAX = 500;

// ─── Types ────────────────────────────────────────────────────────────────────

export type BigSmall = 'Big' | 'Small';

export interface SignalPredictions {
  t3pred?: BigSmall | null;
  t7pred?: BigSmall | null;
  t9pred?: BigSmall | null;
}

export interface AdaptiveInputRow extends SignalPredictions {
  period: string;
  actual: BigSmall;
}

/** Active (not-yet-settled) round inputs — predictions only, no actual result yet. */
export interface ActiveInputRow extends SignalPredictions {
  period: string;
}

/** Forward-looking decision for the active (unsettled) period. Never learns/scored. */
export interface ActivePrediction {
  period: string;
  decision: BigSmall;
  probBig: number;
  probSmall: number;
  signalsAvailable: number;
  weights: number[];
}

// Backwards compatibility alias
export type Test4InputRow = AdaptiveInputRow;

export interface AdaptiveHistoryRow {
  period: string;
  t3pred: BigSmall | null;
  t7pred: BigSmall | null;
  t9pred: BigSmall | null;
  adaptiveDecision: BigSmall; // main decision generated BEFORE seeing actual
  t4pred: BigSmall; // backwards compatibility alias for adaptiveDecision
  actual: BigSmall;
  isHit: boolean;
  probBig: number; // 0–100 %
  probSmall: number;
  /** Snapshot of weights at prediction time */
  weights: number[]; // [w3,w7,w9]
  /** How many signals were available for this round */
  signalsAvailable: number;
}

// Backwards compatibility alias
export type Test4HistoryRow = AdaptiveHistoryRow;

export interface ModelState {
  weights: number[]; // 3 weights [w3,w7,w9]
  processedPeriods: string[];
  allTimeLongestHitStreak?: number;
  allTimeLongestMissStreak?: number;
}

export interface SignalAgreement {
  bigVotes: number;
  smallVotes: number;
  total: number;
  majority: BigSmall | null;
}

export interface AdaptiveResult {
  history: AdaptiveHistoryRow[];
  finalDecision: BigSmall | null;

  totalPredictions: number;
  totalHits: number;
  totalMisses: number;
  accuracyPct: number;

  currentHitStreak: number;
  currentMissStreak: number;
  longestHitStreak: number;
  longestMissStreak: number;

  /** Live weights after full replay [w3,w7,w9] */
  weights: number[];
  dominantSignalIndex: number; // 0-based index into weights array

  last20: { hits: number; total: number };
  last50: { hits: number; total: number };
  last100: { hits: number; total: number };
  last250: { hits: number; total: number };

  /** Latest signal agreement (from last row) */
  lastSignalAgreement: SignalAgreement;

  /** Decision generated for the active (unsettled) period, if one was supplied */
  activePrediction: ActivePrediction | null;

  resetLearning: (fullCleanSlate?: boolean) => void;
}

// Backwards compatibility alias
export type Test4Result = AdaptiveResult;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SIGNAL_LABELS = ['Test 3', 'Test 7', 'Test 9'];

function normaliseWeights(ws: number[]): number[] {
  const sum = ws.reduce((a, b) => a + b, 0);
  if (sum <= 0) return ws.map(() => INITIAL_WEIGHT);
  return ws.map((w) => w / sum);
}

function clamp(v: number): number {
  return Math.max(MIN_WEIGHT, v);
}

function freshWeights(): number[] {
  return Array(N_SIGNALS).fill(INITIAL_WEIGHT);
}

function loadModel(): ModelState {
  try {
    let raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    let remapFromPrev = false;
    if (!raw) {
      raw = localStorage.getItem(PREV_SIGNAL_STORAGE_KEY);
      remapFromPrev = raw !== null;
    }
    if (!raw) throw new Error('no data');
    const parsed = JSON.parse(raw) as Partial<ModelState>;
    let rawWeights: number[] = Array.isArray(parsed.weights) ? parsed.weights : [];
    if (remapFromPrev) {
        // Preserve surviving signal weights while introducing the Test 9 slot.
      rawWeights = PREV_SIGNAL_INDICES.map((i) => rawWeights[i]).filter((w) => typeof w === 'number');
    }
    if (rawWeights.length === 0) rawWeights = freshWeights();
    const clamped = rawWeights.slice(0, N_SIGNALS).map((w) =>
      typeof w === 'number' && isFinite(w) ? clamp(w) : INITIAL_WEIGHT
    );
    // Pad if shorter (migration from old model)
    while (clamped.length < N_SIGNALS) clamped.push(INITIAL_WEIGHT);
    const normalised = normaliseWeights(clamped);
    return {
      weights: normalised,
      processedPeriods: Array.isArray(parsed.processedPeriods) ? parsed.processedPeriods : [],
      allTimeLongestHitStreak: typeof parsed.allTimeLongestHitStreak === 'number' ? parsed.allTimeLongestHitStreak : 0,
      allTimeLongestMissStreak: typeof parsed.allTimeLongestMissStreak === 'number' ? parsed.allTimeLongestMissStreak : 0,
    };
  } catch {
    return { weights: freshWeights(), processedPeriods: [], allTimeLongestHitStreak: 0, allTimeLongestMissStreak: 0 };
  }
}

function saveModel(state: ModelState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    // Clean up legacy key
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // ignore quota errors
  }
}

/** Persist the active-period prediction keyed by its EXACT period ID. */
function persistActivePrediction(pred: ActivePrediction): void {
  try {
    const raw = localStorage.getItem(ACTIVE_PREDICTION_KEY);
    const store = raw ? (JSON.parse(raw) as Record<string, ActivePrediction>) : {};
    if (!store[pred.period]) {
      store[pred.period] = pred;
      const keys = Object.keys(store).sort();
      if (keys.length > ACTIVE_PREDICTION_MAX) {
        for (const k of keys.slice(0, keys.length - ACTIVE_PREDICTION_MAX)) delete store[k];
      }
      localStorage.setItem(ACTIVE_PREDICTION_KEY, JSON.stringify(store));
    }
  } catch {
    // ignore quota / parse errors
  }
}

function computeStreaks(outcomes: boolean[]) {
  if (outcomes.length === 0) {
    return { currentHitStreak: 0, currentMissStreak: 0, longestHitStreak: 0, longestMissStreak: 0 };
  }
  let longestHit = 0, longestMiss = 0, runLen = 1;
  for (let i = 1; i < outcomes.length; i++) {
    if (outcomes[i] === outcomes[i - 1]) {
      runLen++;
    } else {
      if (outcomes[i - 1]) longestHit = Math.max(longestHit, runLen);
      else longestMiss = Math.max(longestMiss, runLen);
      runLen = 1;
    }
  }
  if (outcomes[outcomes.length - 1]) longestHit = Math.max(longestHit, runLen);
  else longestMiss = Math.max(longestMiss, runLen);
  const last = outcomes[outcomes.length - 1];
  return {
    currentHitStreak: last ? runLen : 0,
    currentMissStreak: !last ? runLen : 0,
    longestHitStreak: longestHit,
    longestMissStreak: longestMiss,
  };
}

function rollingWindow(history: Test4HistoryRow[], n: number) {
  const slice = history.slice(-n);
  return { hits: slice.filter((r) => r.isHit).length, total: slice.length };
}

/** Extract the 3 optional predictions from a row as an array. */
function rowPredictions(row: SignalPredictions): Array<BigSmall | null> {
  return [
    row.t3pred ?? null,
    row.t7pred ?? null,
    row.t9pred ?? null,
  ];
}

interface VoteComputation {
  decision: BigSmall;
  probBig: number;
  probSmall: number;
  available: Array<{ idx: number; pred: BigSmall; weight: number }>;
}

/** Weighted ensemble vote. Missing signals (null/undefined) are excluded. */
function computeVote(preds: Array<BigSmall | null>, weights: number[]): VoteComputation {
  const available: Array<{ idx: number; pred: BigSmall; weight: number }> = [];
  for (let k = 0; k < N_SIGNALS; k++) {
    if (preds[k] != null) {
      available.push({ idx: k, pred: preds[k]!, weight: weights[k] });
    }
  }

  const availableSum = available.reduce((s, a) => s + a.weight, 0);
  let bigScore = 0;
  let smallScore = 0;
  for (const sig of available) {
    const normW = availableSum > 0 ? sig.weight / availableSum : 1 / Math.max(1, available.length);
    if (sig.pred === 'Big') bigScore += normW;
    else smallScore += normW;
  }

  const totalScore = bigScore + smallScore;
  const rawProbBig = totalScore > 0 ? bigScore / totalScore : 0.5;
  return {
    decision: rawProbBig >= 0.5 ? 'Big' : 'Small',
    probBig: Math.round(rawProbBig * 1000) / 10,
    probSmall: Math.round((1 - rawProbBig) * 1000) / 10,
    available,
  };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useAdaptiveLearning(inputs: Test4InputRow[], activeInput?: ActiveInputRow | null): AdaptiveResult {
  const [modelState, setModelState] = useState<ModelState>(() => loadModel());

  const resetLearning = useCallback((fullCleanSlate = false) => {
    const fresh: ModelState = {
      weights: freshWeights(),
      processedPeriods: [],
      allTimeLongestHitStreak: 0,
      allTimeLongestMissStreak: 0,
    };
    if (fullCleanSlate) {
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      } catch {}
    } else {
      saveModel(fresh);
    }
    setModelState(fresh);
  }, []);

  // The replay memo's dep array holds exactly the values the output derives
  // from.  Arrays are compared by reference, primitives by value, so the memo
  // only re-runs when:
  //   • the input rows changed (adaptiveInputs ref in AlgorithmAnalyzer),
  //   • the active period input changed,
  //   • the persisted processed-period list changed,
  //   • the persisted all-time streaks changed.
  //  A render that changes only a *display* value (e.g. a weight bar width,
  //  a collapsed panel toggle) holds the same array references, so the memo
  //  short-circuits here before the O(n) replay runs.
  const result = useMemo(() => {
    // ── Deterministic replay from scratch ────────────────────────────────
    // Sort chronologically (ascending) so the replay is deterministic.
    const ascending = [...inputs].sort((a, b) => compareIssuesAsc(a.period, b.period));

    // We always replay ALL rows from INITIAL_WEIGHT so the history table
    // is self-consistent. Persisted weights are used only to detect whether
    // a save is needed.
    let ws = freshWeights(); // running weights for replay

    const history: Test4HistoryRow[] = [];

    for (const row of ascending) {
      const preds = rowPredictions(row);

      // ── Weighted vote for this round (same formula as the active prediction) ──
      const vote = computeVote(preds, ws);
      const t4pred = vote.decision;
      const isHit = t4pred === row.actual;

      history.push({
        period: row.period,
        t3pred: row.t3pred ?? null,
        t7pred: row.t7pred ?? null,
        t9pred: row.t9pred ?? null,
        adaptiveDecision: t4pred,
        t4pred,
        actual: row.actual,
        isHit,
        probBig: vote.probBig,
        probSmall: vote.probSmall,
        weights: [...ws],
        signalsAvailable: vote.available.length,
      });

      // ── Learn: update weights from each available signal ────────────
      for (const sig of vote.available) {
        const correct = sig.pred === row.actual;
        ws[sig.idx] = clamp(ws[sig.idx] + (correct ? LEARNING_RATE : -LEARNING_RATE));
      }
      ws = normaliseWeights(ws);
    }

    // Live weights after full replay
    const liveWeights = [...ws];

    // ── Active (unsettled) period prediction ────────────────────────────
    // Uses the SAME weighted-vote formula against the final live weights.
    // It is NOT added to history/stats and never learns (its actual is unknown).
    let activePrediction: ActivePrediction | null = null;
    if (activeInput) {
      const activeVote = computeVote(rowPredictions(activeInput), liveWeights);
      activePrediction = {
        period: activeInput.period,
        decision: activeVote.decision,
        probBig: activeVote.probBig,
        probSmall: activeVote.probSmall,
        signalsAvailable: activeVote.available.length,
        weights: [...liveWeights],
      };
      // Store by exact period ID (never overwrites an earlier prediction for the same period)
      persistActivePrediction(activePrediction);
    }

    // ── Stats ──────────────────────────────────────────────────────────
    const totalPredictions = history.length;
    const totalHits = history.filter((r) => r.isHit).length;
    const totalMisses = totalPredictions - totalHits;
    const accuracyPct = totalPredictions > 0 ? Math.round((totalHits / totalPredictions) * 100) : 0;
    const calculatedStreaks = computeStreaks(history.map((r) => r.isHit));

    // Monotonic all-time streak calculation:
    // Adding new results must never reduce the historical maximum record.
    const historicalMaxHit = modelState.allTimeLongestHitStreak ?? 0;
    const historicalMaxMiss = modelState.allTimeLongestMissStreak ?? 0;

    const longestHitStreak = Math.max(historicalMaxHit, calculatedStreaks.longestHitStreak);
    const longestMissStreak = Math.max(historicalMaxMiss, calculatedStreaks.longestMissStreak);

    const last20 = rollingWindow(history, 20);
    const last50 = rollingWindow(history, 50);
    const last100 = rollingWindow(history, 100);
    const last250 = rollingWindow(history, 250);

    const dominantSignalIndex = liveWeights.indexOf(Math.max(...liveWeights));

    // ── Last signal agreement ──────────────────────────────────────────
    let lastSignalAgreement: SignalAgreement = { bigVotes: 0, smallVotes: 0, total: 0, majority: null };
    if (history.length > 0) {
      const last = history[history.length - 1];
      const preds = [last.t3pred, last.t7pred, last.t9pred];
      const available = preds.filter((p): p is BigSmall => p !== null);
      const bv = available.filter((p) => p === 'Big').length;
      const sv = available.filter((p) => p === 'Small').length;
      lastSignalAgreement = {
        bigVotes: bv,
        smallVotes: sv,
        total: available.length,
        majority: bv > sv ? 'Big' : sv > bv ? 'Small' : null,
      };
    }

    // ── Persist if weights or streak records changed ────────────────────
    const allPeriods = ascending.map((r) => r.period);
    const updatedProcessedSet = new Set([...modelState.processedPeriods, ...allPeriods]);
    const prevWeights = modelState.weights;
    const weightsChanged =
      liveWeights.some((w, i) => Math.abs(w - (prevWeights[i] ?? INITIAL_WEIGHT)) > 0.0001) ||
      updatedProcessedSet.size !== modelState.processedPeriods.length;
    const persistedStreaksChanged =
      longestHitStreak !== (modelState.allTimeLongestHitStreak ?? 0) ||
      longestMissStreak !== (modelState.allTimeLongestMissStreak ?? 0);

    if (weightsChanged || persistedStreaksChanged) {
      saveModel({
        weights: liveWeights,
        processedPeriods: Array.from(updatedProcessedSet),
        allTimeLongestHitStreak: longestHitStreak,
        allTimeLongestMissStreak: longestMissStreak,
      });
    }

    const finalDecision = history.length > 0 ? history[history.length - 1].adaptiveDecision : null;

    return {
      history,
      finalDecision,
      totalPredictions,
      totalHits,
      totalMisses,
      accuracyPct,
      currentHitStreak: calculatedStreaks.currentHitStreak,
      currentMissStreak: calculatedStreaks.currentMissStreak,
      longestHitStreak,
      longestMissStreak,
      weights: liveWeights,
      dominantSignalIndex,
      last20,
      last50,
      last100,
      last250,
      lastSignalAgreement,
      activePrediction,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs, activeInput, modelState.processedPeriods, modelState.allTimeLongestHitStreak, modelState.allTimeLongestMissStreak]);

  // Sync persisted weights back into state when localStorage changes externally
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === LEGACY_STORAGE_KEY || e.key === PREV_SIGNAL_STORAGE_KEY) {
        setModelState(loadModel());
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Default empty result
  const empty: AdaptiveResult = {
    history: [],
    finalDecision: null,
    totalPredictions: 0,
    totalHits: 0,
    totalMisses: 0,
    accuracyPct: 0,
    currentHitStreak: 0,
    currentMissStreak: 0,
    longestHitStreak: 0,
    longestMissStreak: 0,
    weights: modelState.weights && modelState.weights.length === N_SIGNALS ? modelState.weights : freshWeights(),
    dominantSignalIndex: 0,
    last20: { hits: 0, total: 0 },
    last50: { hits: 0, total: 0 },
    last100: { hits: 0, total: 0 },
    last250: { hits: 0, total: 0 },
    lastSignalAgreement: { bigVotes: 0, smallVotes: 0, total: 0, majority: null },
    activePrediction: null,
    resetLearning,
  };

  if (!result) return empty;
  return { ...result, resetLearning };
}

export { SIGNAL_LABELS };
